package expo.modules.sveltecore

import java.net.ProtocolException
import java.net.SocketTimeoutException
import java.net.UnknownHostException
import javax.net.ssl.SSLException

/** The error codes of the contract (`src/fetch/native.ts`), which JavaScript reads from the `code` of the Error a promise rejects with. */
internal object FetchCodes {
  const val ABORTED = "ERR_FETCH_ABORTED"
  const val REDIRECT = "ERR_FETCH_REDIRECT"
  const val URL = "ERR_FETCH_URL"
  const val NETWORK = "ERR_FETCH_NETWORK"
  const val BODY_USED = "ERR_FETCH_BODY_USED"
}

/** A failure the contract names. Plain Kotlin, so the logic behind it runs without the Expo runtime; the module turns it into a `CodedException`. */
internal class FetchError(val code: String, message: String, cause: Throwable? = null) : Exception(message, cause) {
  companion object {
    fun aborted() = FetchError(FetchCodes.ABORTED, "The fetch was aborted")

    fun bodyUsed() = FetchError(FetchCodes.BODY_USED, "The response body was already taken")

    /** `ERR_FETCH_NETWORK` whose message says what went wrong between the app and the server. */
    fun network(error: Throwable): FetchError = FetchError(FetchCodes.NETWORK, describe(error), error)

    private fun describe(error: Throwable): String {
      val detail = error.message?.takeIf { it.isNotEmpty() }?.let { ": $it" } ?: ""
      val what = when (error) {
        is UnknownHostException -> "DNS lookup failed"
        is SSLException -> "TLS error"
        is SocketTimeoutException -> "Timed out"
        is ProtocolException -> "Malformed or cut short response"
        else -> error.javaClass.simpleName
      }
      return what + detail
    }
  }
}

/** How an operation answers: exactly one of the two calls, from any thread. */
internal interface Reply<in T> {
  fun resolve(value: T)

  fun reject(error: FetchError)
}

internal enum class RedirectMode { FOLLOW, ERROR, MANUAL }

/** What `NativeRequestInit` of the contract says about one request. */
internal class RequestSpec(
  val method: String,
  val headers: List<Pair<String, String>>,
  val includeCredentials: Boolean,
  val redirect: RedirectMode
)

/** `NativeResponseHead` of the contract. */
internal class ResponseHead(
  val status: Int,
  val statusText: String,
  val headers: List<Pair<String, String>>,
  val url: String,
  val redirected: Boolean
)
