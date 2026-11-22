import ExpoModulesCore
import Foundation

enum RequestCredentials: String, Enumerable {
  case include
  case omit
}

enum RedirectMode: String, Enumerable {
  case follow
  case error
  case manual
}

/// `NativeRequestInit` of the contract (`src/fetch/native.ts`).
struct NativeRequestInit: Record {
  @Field var method: String = "GET"
  @Field var headers: [[String]] = []
  @Field var credentials: RequestCredentials = .include
  @Field var redirect: RedirectMode = .follow
}

/// `NativeResponseHead` of the contract.
struct NativeResponseHead: Record {
  @Field var status: Int = 0
  @Field var statusText: String = ""
  @Field var headers: [[String]] = []
  @Field var url: String = ""
  @Field var redirected: Bool = false

  init() {}

  init(status: Int, statusText: String, headers: [[String]], url: String, redirected: Bool) {
    self.status = status
    self.statusText = statusText
    self.headers = headers
    self.url = url
    self.redirected = redirected
  }

  /// URLSession gives neither the reason phrase nor the order of the headers, and merges a repeated header into one value joined by ", ". The headers are
  /// sorted by name so that they read the same on every run.
  init(of response: URLResponse, redirected: Bool) {
    guard let http = response as? HTTPURLResponse else {
      self.init(status: 200, statusText: "OK", headers: [], url: response.url?.absoluteString ?? "", redirected: redirected)
      return
    }
    var pairs: [[String]] = []
    for (name, value) in http.allHeaderFields {
      if let name = name as? String { pairs.append([name, "\(value)"]) }
    }
    pairs.sort { $0[0].lowercased() < $1[0].lowercased() }
    self.init(
      status: http.statusCode, statusText: Self.reasonPhrase(http.statusCode), headers: pairs, url: http.url?.absoluteString ?? "", redirected: redirected)
  }

  /// The standard phrase of a status code (the ones Node's `http.STATUS_CODES` has), "" for a code without one. URLSession does not expose the phrase the
  /// server sent, so a custom phrase reads as the standard one, and an HTTP/2 response (which has no phrase) reads like HTTP/1.1.
  static func reasonPhrase(_ status: Int) -> String {
    phrases[status] ?? ""
  }

  private static let phrases: [Int: String] = [
    100: "Continue", 101: "Switching Protocols", 102: "Processing", 103: "Early Hints",
    200: "OK", 201: "Created", 202: "Accepted", 203: "Non-Authoritative Information", 204: "No Content", 205: "Reset Content",
    206: "Partial Content", 207: "Multi-Status", 208: "Already Reported", 226: "IM Used",
    300: "Multiple Choices", 301: "Moved Permanently", 302: "Found", 303: "See Other", 304: "Not Modified", 305: "Use Proxy",
    307: "Temporary Redirect", 308: "Permanent Redirect",
    400: "Bad Request", 401: "Unauthorized", 402: "Payment Required", 403: "Forbidden", 404: "Not Found", 405: "Method Not Allowed",
    406: "Not Acceptable", 407: "Proxy Authentication Required", 408: "Request Timeout", 409: "Conflict", 410: "Gone",
    411: "Length Required", 412: "Precondition Failed", 413: "Payload Too Large", 414: "URI Too Long", 415: "Unsupported Media Type",
    416: "Range Not Satisfiable", 417: "Expectation Failed", 418: "I'm a Teapot", 421: "Misdirected Request",
    422: "Unprocessable Entity", 423: "Locked", 424: "Failed Dependency", 425: "Too Early", 426: "Upgrade Required",
    428: "Precondition Required", 429: "Too Many Requests", 431: "Request Header Fields Too Large", 451: "Unavailable For Legal Reasons",
    500: "Internal Server Error", 501: "Not Implemented", 502: "Bad Gateway", 503: "Service Unavailable", 504: "Gateway Timeout",
    505: "HTTP Version Not Supported", 506: "Variant Also Negotiates", 507: "Insufficient Storage", 508: "Loop Detected",
    510: "Not Extended", 511: "Network Authentication Required",
  ]
}
