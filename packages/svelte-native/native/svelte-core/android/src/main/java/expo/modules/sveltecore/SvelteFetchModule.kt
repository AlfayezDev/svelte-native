package expo.modules.sveltecore

import android.content.Context
import android.os.Process
import android.os.SystemClock
import com.facebook.react.modules.network.CookieJarContainer
import com.facebook.react.modules.network.ForwardingCookieHandler
import com.facebook.react.modules.network.OkHttpClientProvider
import expo.modules.kotlin.Promise
import expo.modules.kotlin.exception.CodedException
import expo.modules.kotlin.exception.Exceptions
import expo.modules.kotlin.jni.NativeArrayBuffer
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import expo.modules.kotlin.records.Field
import expo.modules.kotlin.records.Record
import expo.modules.kotlin.sharedobjects.SharedObject
import expo.modules.kotlin.typedarray.TypedArray
import expo.modules.kotlin.types.EitherOfThree
import expo.modules.kotlin.types.Enumerable
import expo.modules.kotlin.types.OptimizedRecord
import okhttp3.JavaNetCookieJar
import okhttp3.OkHttpClient
import java.io.File
import java.io.IOException
import java.nio.ByteBuffer
import java.util.concurrent.SynchronousQueue
import java.util.concurrent.ThreadPoolExecutor
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicInteger

internal enum class NativeCredentials(val value: String) : Enumerable {
  INCLUDE("include"),
  OMIT("omit")
}

internal enum class NativeRedirect(val value: String) : Enumerable {
  FOLLOW("follow"),
  ERROR("error"),
  MANUAL("manual")
}

/** `NativeRequestInit` of the contract (`src/fetch/native.ts`). */
@OptimizedRecord
internal data class NativeRequestInit(
  @Field val method: String = "GET",
  @Field val headers: List<Pair<String, String>> = emptyList(),
  @Field val credentials: NativeCredentials = NativeCredentials.INCLUDE,
  @Field val redirect: NativeRedirect = NativeRedirect.FOLLOW
) : Record {
  fun toSpec() = RequestSpec(
    method,
    headers,
    credentials == NativeCredentials.INCLUDE,
    when (redirect) {
      NativeRedirect.FOLLOW -> RedirectMode.FOLLOW
      NativeRedirect.ERROR -> RedirectMode.ERROR
      NativeRedirect.MANUAL -> RedirectMode.MANUAL
    }
  )
}

/** A Blob's bytes, held natively as segments ([BlobData]); the JavaScript class is `NativeBlob`. */
internal class NativeBlob(val data: BlobData, val type: String) : SharedObject() {
  private var objectUrl: String? = null

  override fun getAdditionalMemoryPressure(): Int = data.memoryBytes

  /** The file URL of the bytes, written on the first call and reused while the file is there. */
  @Synchronized
  fun objectURL(urls: ObjectUrls): String {
    objectUrl?.takeIf { urls.exists(it) }?.let { return it }
    return urls.create(data).also { objectUrl = it }
  }
}

/** One fetch; the JavaScript class is `NativeRequest`. Released by JavaScript's garbage collector, it stops the transfer. */
internal class NativeRequest(val call: FetchCall) : SharedObject() {
  override fun sharedObjectDidRelease() {
    call.release()
  }
}

internal typealias BlobPart = EitherOfThree<String, NativeBlob, TypedArray>

internal typealias BodyPart = EitherOfThree<String, NativeBlob, ByteArray>

/** Settles a JavaScript promise from a [Reply]; `convert` turns the plain result into what Expo hands to JavaScript (an ArrayBuffer, a shared object, a map). */
private class PromiseReply<T>(private val promise: Promise, private val convert: (T) -> Any?) : Reply<T> {
  override fun resolve(value: T) {
    val converted = try {
      convert(value)
    } catch (e: Exception) {
      return reject(FetchError(FetchCodes.NETWORK, "Could not hand the bytes to JavaScript: ${e.message}", e))
    }
    promise.resolve(converted)
  }

  override fun reject(error: FetchError) = promise.reject(error.coded())
}

private fun FetchError.coded() = CodedException(code, message, cause)

private fun ResponseHead.toMap(): Map<String, Any?> = mapOf(
  "status" to status,
  "statusText" to statusText,
  "headers" to headers.map { listOf(it.first, it.second) },
  "url" to url,
  "redirected" to redirected
)

/**
 * `SvelteFetch`: the native half of Svelte Native's `fetch` and `Blob` (contract: `src/fetch/native.ts`; the iOS half is `native/svelte-core/ios`). The logic
 * is plain Kotlin ([Fetcher], [FetchCall], [BodyBuffer], [BlobData]) so the host checks (`src/test/run.sh`) run it without a device; this class only maps
 * it onto Expo's classes, promises and ArrayBuffers.
 */
class SvelteFetchModule : Module() {
  private val threadNumber = AtomicInteger()

  // Network reads block, so each takes a thread of its own while it is blocked; idle threads end after half a minute.
  private val executor = ThreadPoolExecutor(0, Int.MAX_VALUE, 30, TimeUnit.SECONDS, SynchronousQueue()) { task ->
    Thread(task, "svelte-fetch-${threadNumber.incrementAndGet()}").apply { isDaemon = true }
  }

  private val context: Context
    get() = appContext.reactContext?.applicationContext ?: throw Exceptions.ReactContextLost()

  private var sharedClient: OkHttpClient? = null
  private var fetchClient: OkHttpClient? = null

  /**
   * The client the fetches go through: React Native's shared one (so the app's interceptors and settings apply) with the system cookie store as its jar. React
   * Native's own networking builds a client of its own and puts that same store (Android's CookieManager) behind it, so cookies are shared with it through the
   * store, not through a jar object. The shared client itself is left as it is: other users of it (web sockets, the dev tools) get no cookies from us.
   * An app that gave the shared client a jar of its own, not React Native's container, keeps it.
   */
  @Synchronized
  private fun client(): OkHttpClient {
    val shared = OkHttpClientProvider.getOkHttpClient()
    if (shared !== sharedClient) {
      sharedClient = shared
      fetchClient = if (shared.cookieJar is CookieJarContainer) shared.newBuilder().cookieJar(JavaNetCookieJar(ForwardingCookieHandler())).build() else shared
    }
    return fetchClient!!
  }

  private val fetcherDelegate = lazy {
    Fetcher(client = { client() }, files = AndroidFiles(context), executor = executor, alloc = { ByteBuffer.allocateDirect(it) }, temps = temps)
  }
  private val fetcher by fetcherDelegate
  private val objectUrls by lazy { ObjectUrls(File(context.cacheDir, "svelte-native-blobs")) }
  private val temps by lazy { TempFiles(File(context.cacheDir, "svelte-native-spill")) }

  /** Runs `work` on the executor and settles the promise with what it returns, or with the contract's error for what it throws. */
  private fun background(promise: Promise, work: () -> Any?) {
    executor.execute {
      val result = try {
        work()
      } catch (e: FetchError) {
        return@execute promise.reject(e.coded())
      } catch (e: OutOfMemoryError) {
        return@execute promise.reject(FetchError(FetchCodes.NETWORK, "Not enough memory", e).coded())
      } catch (e: Exception) {
        return@execute promise.reject(FetchError.network(e).coded())
      }
      promise.resolve(result)
    }
  }

  private fun bodyData(body: BodyPart): BlobData = when {
    body.`is`(String::class) -> BlobData.ofBytes(Utf8.encode(body.get(String::class)))
    body.`is`(NativeBlob::class) -> body.get(NativeBlob::class).data
    else -> BlobData.ofBytes(body.get(ByteArray::class))
  }

  private fun partData(part: BlobPart): BlobData = when {
    part.`is`(String::class) -> BlobData.ofBytes(Utf8.encode(part.get(String::class)))
    part.`is`(NativeBlob::class) -> part.get(NativeBlob::class).data
    else -> {
      // The only copy of a Uint8Array's bytes: the constructor runs on JavaScript's thread, so the array cannot change under it.
      val array = part.get(TypedArray::class)
      val bytes = ByteArray(array.byteLength)
      if (bytes.isNotEmpty()) array.read(bytes, 0, bytes.size)
      BlobData.ofBytes(bytes)
    }
  }

  override fun definition() = ModuleDefinition {
    Name("SvelteFetch")

    OnCreate {
      // No Blob outlives the process that made it, so what an earlier run left (object URL files, spilled bodies) is garbage. Only what is older than this
      // process is deleted: the sweep runs on another thread, and a file made since the process began may be in use.
      val before = System.currentTimeMillis() - (SystemClock.elapsedRealtime() - Process.getStartElapsedRealtime())
      executor.execute {
        try {
          objectUrls.sweep(before)
          temps.sweep(before)
        } catch (_: Exception) {
          // Best effort: the files are cache.
        }
      }
    }

    OnDestroy {
      if (fetcherDelegate.isInitialized()) fetcher.cancelAll()
    }

    AsyncFunction("blobFromURI") { uri: String, type: String, promise: Promise ->
      background(promise) {
        try {
          NativeBlob(BlobData.ofFile(fetcher.files, uri, fetcher.temps), type)
        } catch (e: IOException) {
          throw FetchError(FetchCodes.NETWORK, "Cannot open $uri: ${e.message}", e)
        }
      }
    }

    Function("revokeObjectURL") { url: String ->
      objectUrls.revoke(url)
    }

    Class("NativeBlob", NativeBlob::class) {
      Constructor { parts: List<BlobPart>, type: String ->
        NativeBlob(BlobData.concat(parts.map { partData(it) }), type)
      }

      Property("size") { blob: NativeBlob -> blob.data.size.toDouble() }

      Property("type") { blob: NativeBlob -> blob.type }

      Function("slice") { blob: NativeBlob, start: Double, end: Double, type: String ->
        NativeBlob(blob.data.slice(start.toLong(), end.toLong()), type)
      }

      AsyncFunction("bytes") { blob: NativeBlob, promise: Promise ->
        background(promise) { NativeArrayBuffer.wrap(blob.data.read(0, blob.data.size) { ByteBuffer.allocateDirect(it) }) }
      }

      AsyncFunction("text") { blob: NativeBlob, promise: Promise ->
        background(promise) {
          val bytes = blob.data.read(0, blob.data.size) { ByteBuffer.wrap(ByteArray(it)) }
          Utf8.decode(bytes.array(), 0, bytes.limit())
        }
      }

      AsyncFunction("read") { blob: NativeBlob, offset: Double, length: Double, promise: Promise ->
        background(promise) { NativeArrayBuffer.wrap(blob.data.read(offset.toLong(), length.toLong()) { ByteBuffer.allocateDirect(it) }) }
      }

      Function("objectURL") { blob: NativeBlob ->
        try {
          blob.objectURL(objectUrls)
        } catch (e: Exception) {
          throw CodedException(FetchCodes.NETWORK, "Cannot write the Blob to a file: ${e.message}", e)
        }
      }
    }

    Class("NativeRequest", NativeRequest::class) {
      Constructor { NativeRequest(fetcher.newCall()) }

      AsyncFunction("start") { request: NativeRequest, url: String, options: NativeRequestInit, body: BodyPart?, promise: Promise ->
        request.call.start(url, options.toSpec(), body?.let { bodyData(it) }, PromiseReply(promise) { head: ResponseHead -> head.toMap() })
      }

      Function("cancel") { request: NativeRequest ->
        request.call.cancel()
      }

      AsyncFunction("read") { request: NativeRequest, maxBytes: Double, promise: Promise ->
        val max = maxBytes.coerceIn(1.0, Int.MAX_VALUE.toDouble()).toInt()
        request.call.read(max, PromiseReply(promise) { bytes: ByteBuffer? -> bytes?.let { NativeArrayBuffer.wrap(it) } })
      }

      AsyncFunction("arrayBuffer") { request: NativeRequest, promise: Promise ->
        request.call.arrayBuffer(PromiseReply(promise) { bytes: ByteBuffer -> NativeArrayBuffer.wrap(bytes) })
      }

      AsyncFunction("text") { request: NativeRequest, promise: Promise ->
        request.call.text(PromiseReply(promise) { text: String -> text })
      }

      AsyncFunction("blob") { request: NativeRequest, type: String, promise: Promise ->
        request.call.blob(PromiseReply(promise) { data: BlobData -> NativeBlob(data, type) })
      }
    }
  }
}
