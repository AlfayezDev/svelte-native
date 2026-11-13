package expo.modules.sveltecore

import okhttp3.Call
import okhttp3.Callback
import okhttp3.CookieJar
import okhttp3.Headers
import okhttp3.HttpUrl.Companion.toHttpUrlOrNull
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody
import okhttp3.RequestBody.Companion.toRequestBody
import okhttp3.Response
import okio.buffer
import java.io.IOException
import java.net.ProtocolException
import java.nio.ByteBuffer
import java.util.Collections
import java.util.WeakHashMap
import java.util.concurrent.Executor

/** What every fetch shares: where the HTTP client comes from, how local files open, the threads that do the work, and how buffers handed to JavaScript are made. */
internal class Fetcher(
  /** React Native's own client in the module: its cookie jar and interceptors are the app's. Asked per request, so a client the app replaces is picked up. */
  val client: () -> OkHttpClient,
  val files: FileAccess,
  val executor: Executor,
  val alloc: Alloc
) {
  private val live: MutableSet<FetchCall> = Collections.synchronizedSet(Collections.newSetFromMap(WeakHashMap<FetchCall, Boolean>()))

  fun newCall(): FetchCall = FetchCall(this).also { live.add(it) }

  /** For when the module goes away: no transfer outlives the runtime that asked for it. */
  fun cancelAll() {
    val calls = synchronized(live) { live.toList() }
    for (call in calls) call.cancel()
  }
}

/**
 * One fetch, the plain-Kotlin half of `NativeRequest` in the contract: `start`, then exactly one way of taking the body. Network work happens on OkHttp's
 * dispatcher and on the executor, the caller's thread only starts it.
 */
internal class FetchCall(private val env: Fetcher) {
  private val lock = Any()
  private var started = false
  private var canceled = false
  private var headReply: Reply<ResponseHead>? = null
  @Volatile
  private var call: Call? = null
  private var body: BodyBuffer? = null

  /** Sends the request; `reply` gets the head once the status and headers are in. */
  fun start(url: String, spec: RequestSpec, requestBody: BlobData?, reply: Reply<ResponseHead>) {
    val refusal = synchronized(lock) {
      when {
        canceled -> FetchError.aborted()
        started -> FetchError(FetchCodes.NETWORK, "The request was already started")
        else -> {
          started = true
          headReply = reply
          null
        }
      }
    }
    if (refusal != null) return reply.reject(refusal)
    val scheme = url.substringBefore(':', "").lowercase()
    when (scheme) {
      "http", "https" -> startHttp(url, spec, requestBody)
      "file", "content" -> env.executor.execute { startLocal(url) }
      else -> failHead(FetchError(FetchCodes.URL, "Not a URL this module fetches: $url"))
    }
  }

  private fun startHttp(url: String, spec: RequestSpec, requestBody: BlobData?) {
    val httpUrl = url.toHttpUrlOrNull() ?: return failHead(FetchError(FetchCodes.URL, "Not a valid URL: $url"))
    val newCall = try {
      val headers = Headers.Builder()
      for ((name, value) in spec.headers) {
        if (value.any { it == '\u0000' || it == '\r' || it == '\n' }) {
          return failHead(FetchError(FetchCodes.NETWORK, "Invalid value for the header $name"))
        }
        // Values arrive as JavaScript strings; the strict `add` would refuse a non-ASCII one that a server may well accept.
        headers.addUnsafeNonAscii(name, value)
      }
      val request = Request.Builder().url(httpUrl).headers(headers.build()).method(spec.method, bodyFor(spec.method, requestBody)).build()
      derive(env.client(), spec).newCall(request)
    } catch (e: IllegalArgumentException) {
      return failHead(FetchError(FetchCodes.NETWORK, "Invalid request: ${e.message}", e))
    } catch (e: RuntimeException) {
      return failHead(FetchError.network(e))
    }
    synchronized(lock) {
      if (canceled) return
      call = newCall
    }
    newCall.enqueue(object : Callback {
      override fun onFailure(call: Call, e: IOException) {
        val tooManyRedirects = e is ProtocolException && e.message?.startsWith("Too many follow-up requests") == true
        failHead(if (tooManyRedirects) FetchError(FetchCodes.REDIRECT, "More than 20 redirects", e) else FetchError.network(e))
      }

      override fun onResponse(call: Call, response: Response) = onHttpResponse(response, spec)
    })
  }

  /** The shared client, changed only where this request differs: no cookies for "omit", no following for "error" and "manual". */
  private fun derive(base: OkHttpClient, spec: RequestSpec): OkHttpClient {
    if (spec.includeCredentials && spec.redirect == RedirectMode.FOLLOW) return base
    val builder = base.newBuilder()
    if (!spec.includeCredentials) builder.cookieJar(CookieJar.NO_COOKIES)
    if (spec.redirect != RedirectMode.FOLLOW) builder.followRedirects(false).followSslRedirects(false)
    return builder.build()
  }

  /** OkHttp insists on a body for these methods and on none for GET and HEAD; the Fetch standard has no such rule, so an absent body becomes an empty one. */
  private fun bodyFor(method: String, data: BlobData?): RequestBody? = when {
    data != null -> BlobRequestBody(data)
    method in BODY_REQUIRED -> ByteArray(0).toRequestBody(null)
    else -> null
  }

  private fun onHttpResponse(response: Response, spec: RequestSpec) {
    if (spec.redirect == RedirectMode.ERROR && response.code in REDIRECT_STATUSES) {
      response.close()
      failHead(FetchError(FetchCodes.REDIRECT, "The server answered ${response.code}, a redirect, and redirects are not allowed"))
      return
    }
    val head = ResponseHead(
      status = response.code,
      statusText = response.message,
      headers = response.headers.map { it.first to it.second },
      url = response.request.url.toString(),
      redirected = generateSequence(response.priorResponse) { it.priorResponse }.any { it.isRedirect }
    )
    val source = response.body?.source()
    if (source == null) {
      response.close()
      failHead(FetchError(FetchCodes.NETWORK, "The response has no body"))
      return
    }
    attach(BodyBuffer(source, { response.close() }, env.executor, env.alloc), head)
  }

  /** `file://` and `content://`: a 200 with the file's bytes and its length, read through the same buffer as a network body. */
  private fun startLocal(url: String) {
    val handle = try {
      env.files.open(url)
    } catch (e: IOException) {
      failHead(FetchError(FetchCodes.NETWORK, "Cannot open $url: ${e.message}", e))
      return
    }
    val size = try {
      handle.size
    } catch (e: IOException) {
      handle.close()
      failHead(FetchError(FetchCodes.NETWORK, "Cannot read $url: ${e.message}", e))
      return
    }
    val headers = if (size >= 0) listOf("Content-Length" to size.toString()) else emptyList()
    attach(BodyBuffer(HandleSource(handle).buffer(), { handle.close() }, env.executor, env.alloc), ResponseHead(200, "", headers, url, false))
  }

  /** The head is in: from now on the body is read ahead, and the caller learns the head. */
  private fun attach(buffer: BodyBuffer, head: ResponseHead) {
    var reply: Reply<ResponseHead>? = null
    synchronized(lock) {
      if (!canceled) {
        body = buffer
        reply = headReply
        headReply = null
      }
    }
    if (reply == null) {
      // Canceled while the head was on its way: the caller was already told, only the transfer is left to close.
      buffer.abort()
      return
    }
    buffer.start()
    reply?.resolve(head)
  }

  private fun failHead(error: FetchError) {
    val reply = synchronized(lock) {
      if (canceled) return
      headReply.also { headReply = null }
    }
    reply?.reject(error)
  }

  /** Stops the request or the body transfer; every pending promise rejects with ERR_FETCH_ABORTED. No effect once the body has been read to its end. */
  fun cancel() {
    var reply: Reply<ResponseHead>? = null
    val buffer: BodyBuffer?
    synchronized(lock) {
      if (canceled) return
      buffer = body
      if (buffer == null) {
        canceled = true
        reply = headReply
        headReply = null
      }
    }
    if (buffer != null) {
      if (!buffer.abort()) return
      synchronized(lock) { canceled = true }
    }
    reply?.reject(FetchError.aborted())
    // Closing a socket is quick, but not something the caller's thread (JavaScript's, or the garbage collector's) should be asked to do.
    call?.let { running -> env.executor.execute { running.cancel() } }
  }

  /** The garbage collector let go of the request. */
  fun release() = cancel()

  /** The most body bytes that were ever buffered unread, for the host checks of backpressure. */
  val peakUnread: Long get() = synchronized(lock) { body }?.peakUnread ?: 0

  fun read(maxBytes: Int, reply: Reply<ByteBuffer?>) {
    bodyOrReject(reply)?.read(maxBytes, reply)
  }

  fun arrayBuffer(reply: Reply<ByteBuffer>) {
    consumeAll(reply) { chunks -> chunks.assemble(env.alloc) }
  }

  fun text(reply: Reply<String>) {
    consumeAll(reply) { chunks ->
      val bytes = chunks.assemble { ByteBuffer.wrap(ByteArray(it)) }
      Utf8.decode(bytes.array(), 0, bytes.limit())
    }
  }

  fun blob(reply: Reply<BlobData>) {
    consumeAll(reply) { chunks -> BlobData.ofChunks(chunks) }
  }

  private fun <T> consumeAll(reply: Reply<T>, convert: (List<Chunk>) -> T) {
    bodyOrReject(reply)?.readAll(object : Reply<List<Chunk>> {
      override fun resolve(value: List<Chunk>) {
        val converted = try {
          convert(value)
        } catch (e: OutOfMemoryError) {
          return reply.reject(FetchError(FetchCodes.NETWORK, "Not enough memory for the body", e))
        }
        reply.resolve(converted)
      }

      override fun reject(error: FetchError) = reply.reject(error)
    })
  }

  private fun bodyOrReject(reply: Reply<*>): BodyBuffer? {
    val buffer = synchronized(lock) { body }
    if (buffer == null) {
      reply.reject(
        if (synchronized(lock) { canceled }) FetchError.aborted() else FetchError(FetchCodes.NETWORK, "The request has not received a response")
      )
    }
    return buffer
  }

  private companion object {
    val BODY_REQUIRED = setOf("POST", "PUT", "PATCH", "PROPPATCH", "REPORT")
    val REDIRECT_STATUSES = setOf(301, 302, 303, 307, 308)
  }
}
