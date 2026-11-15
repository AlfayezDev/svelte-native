import ExpoModulesCore
import Foundation

/// The error every rejection of this module carries: `code` is one of the contract's codes (`src/fetch/native.ts`), and the JavaScript message is the reason
/// alone (the default message of an Expo exception also names the Swift file and line).
final class FetchException: Exception, @unchecked Sendable {
  private enum Code {
    static let aborted = "ERR_FETCH_ABORTED"
    static let redirect = "ERR_FETCH_REDIRECT"
    static let url = "ERR_FETCH_URL"
    static let network = "ERR_FETCH_NETWORK"
    static let bodyUsed = "ERR_FETCH_BODY_USED"
  }

  init(_ code: String, _ message: String) {
    super.init(name: code, description: message, code: code)
  }

  override var debugDescription: String { reason }

  static func aborted() -> FetchException {
    FetchException(Code.aborted, "The request was aborted")
  }

  static func bodyUsed() -> FetchException {
    FetchException(Code.bodyUsed, "The body of this request is being read, or has been read, by another consumer")
  }

  static func network(_ message: String) -> FetchException {
    FetchException(Code.network, message)
  }

  static func redirect(_ message: String) -> FetchException {
    FetchException(Code.redirect, message)
  }

  static func url(_ message: String) -> FetchException {
    FetchException(Code.url, message)
  }

  /// The contract's error for whatever URLSession (or this module) reported. A cancel that this module did not issue can only be the session shutting down
  /// with the module, so it reads as an abort.
  static func from(_ error: Error) -> FetchException {
    if let fetch = error as? FetchException { return fetch }
    guard let failure = error as? URLError else { return network(error.localizedDescription) }
    let detail = "\(failure.localizedDescription) (NSURLErrorDomain \(failure.code.rawValue))"
    switch failure.code {
    case .cancelled:
      return aborted()
    case .badURL, .unsupportedURL:
      return url(detail)
    case .httpTooManyRedirects:
      return redirect("Too many redirects: \(detail)")
    case .cannotFindHost, .dnsLookupFailed:
      return network("DNS lookup failed: \(detail)")
    case .cannotConnectToHost:
      return network("Connection refused: \(detail)")
    case .networkConnectionLost:
      return network("Connection lost: \(detail)")
    case .timedOut:
      return network("Timed out: \(detail)")
    case .notConnectedToInternet, .dataNotAllowed, .internationalRoamingOff:
      return network("No network connection: \(detail)")
    case .appTransportSecurityRequiresSecureConnection:
      return network("Cleartext HTTP is blocked by App Transport Security: \(detail)")
    case .secureConnectionFailed, .serverCertificateUntrusted, .serverCertificateHasBadDate, .serverCertificateHasUnknownRoot,
      .serverCertificateNotYetValid, .clientCertificateRejected, .clientCertificateRequired:
      return network("TLS failure: \(detail)")
    case .badServerResponse, .cannotParseResponse, .cannotDecodeRawData, .cannotDecodeContentData:
      return network("Bad response: \(detail)")
    default:
      return network(detail)
    }
  }
}
