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

/** What every fetch shares: where the HTTP client comes from, how local files open, the threads that do the work, how buffers handed to JavaScript are made. */
internal class Fetcher(
  /** In the module a client derived from React Native's own, so its interceptors are the app's. Asked per request, so a client the app replaces is picked up. */
  val client: () -> OkHttpClient,
  val files: FileAccess,
  val executor: Executor,
  val alloc: Alloc,
  /** Where bytes go that should not stay on the Java heap (a downloaded Blob too big to keep); without it, they stay. */
  val temps: TempFiles? = null
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

      override fun onResponse(call: Call, response: Response) {
        // This runs on OkHttp's dispatcher thread, where an exception that escapes ends the app.
        try {
          onHttpResponse(response, spec)
        } catch (e: Exception) {
          try {
            response.close()
          } catch (_: Exception) {
          }
          failHead(FetchError.network(e))
        }
      }
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
    // OkHttp follows every redirect it can resolve, so one that is still a redirect here points where it cannot go (not an http or https URL, or not a URL at
    // all). The Fetch standard makes that a network error, where OkHttp hands back the 3xx.
    val location = response.header("Location")
    if (spec.redirect == RedirectMode.FOLLOW && response.code in REDIRECT_STATUSES && location != null) {
      response.close()
      failHead(FetchError(FetchCodes.NETWORK, "The server redirected to $location, which is not an http or https URL"))
      return
    }
    val head = ResponseHead(
      status = response.code,
      statusText = response.message,
      headers = response.headers.map { it.first to it.second },
      url = response.request.url.toString(),
      redirected = generateSequence(response.priorResponse) { it.priorResponse }.any { it.isRedirect }
    )
    val responseBody = response.body
    if (responseBody == null) {
      response.close()
      failHead(FetchError(FetchCodes.NETWORK, "The response has no body"))
      return
    }
    // A HEAD answer reports the length of the body it does not have.
    val length = if (response.request.method == "HEAD") 0L else responseBody.contentLength()
    attach(BodyBuffer(responseBody.source(), { response.close() }, env.executor, env.alloc, length, env.temps), head)
  }

  /** `file://` and `content://`: a 200 with the file's bytes and its length, read through the same buffer as a network body. */
  private fun startLocal(url: String) {
    val opened = try {
      env.files.openChecked(url)
    } catch (e: IOException) {
      return failHead(FetchError(FetchCodes.NETWORK, "Cannot open $url: ${e.message}", e))
    }
    val size = try {
      opened.size
    } catch (e: Exception) {
      closeQuietly(opened)
      return failHead(FetchError(FetchCodes.NETWORK, "Cannot read $url: ${e.message}", e))
    }
    val headers = if (size >= 0) listOf("Content-Length" to size.toString()) else emptyList()
    attach(BodyBuffer(HandleSource(opened, size).buffer(), { opened.close() }, env.executor, env.alloc, size, env.temps), ResponseHead(200, "", headers, url, false))
  }

  private fun closeQuietly(handle: FileHandle) {
    try {
      handle.close()
    } catch (_: Exception) {
    }
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
    reply.resolve(head)
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
    bodyOrReject(reply)?.readAllBytes(env.alloc, reply)
  }

  fun text(reply: Reply<String>) {
    bodyOrReject(reply)?.readAllBytes({ ByteBuffer.wrap(ByteArray(it)) }, object : Reply<ByteBuffer> {
      override fun resolve(value: ByteBuffer) {
        val decoded = try {
          Utf8.decode(value.array(), 0, value.limit())
        } catch (e: OutOfMemoryError) {
          return reply.reject(FetchError(FetchCodes.NETWORK, "Not enough memory for the text", e))
        }
        reply.resolve(decoded)
      }

      override fun reject(error: FetchError) = reply.reject(error)
    })
  }

  fun blob(reply: Reply<BlobData>) {
    bodyOrReject(reply)?.readAllBlob(reply)
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
