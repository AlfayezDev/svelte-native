import ExpoModulesCore
import Foundation

/// One fetch: `start` sends the request, then one consumer takes the body (`Transfer` holds everything that happens in between). JavaScript's garbage collector
/// releasing the object, like `cancel`, stops the transfer.
final class NativeRequest: SharedObject, @unchecked Sendable {
  let transfer = Transfer()

  override func sharedObjectWillRelease() {
    transfer.abort()
  }

  deinit {
    transfer.abort()
  }

  func start(client: FetchClient, url: String, requestInit: NativeRequestInit, body: EitherOfThree<NativeBlob, Data, String>?, promise: Promise) {
    guard transfer.begin(promise) else { return }
    guard let target = FetchURL.parse(url), let scheme = target.scheme?.lowercased() else {
      transfer.ended(FetchException.url("Not a URL: \(url)"))
      return
    }
    switch scheme {
    case "file":
      let source = FileSource(transfer: transfer, queue: client.files)
      transfer.attach(source)
      source.begin(path: target.path, url: target.absoluteString)
    case "http", "https":
      send(client: client, target: target, requestInit: requestInit, body: RequestBody(body))
    default:
      transfer.ended(FetchException.url("Unsupported URL scheme \"\(scheme)\""))
    }
  }

  private func send(client: FetchClient, target: URL, requestInit: NativeRequestInit, body: RequestBody) {
    let include = requestInit.credentials == .include
    var request = URLRequest(url: target)
    request.httpMethod = requestInit.method
    request.timeoutInterval = FetchClient.timeout
    request.httpShouldHandleCookies = include
    if include { request.mainDocumentURL = target }
    // Headers go as given: no Content-Type is added here. (A repeated name becomes one header with the values joined by ", ", as URLRequest has no other way.)
    // Measured on iOS 26: CFNetwork gives a POST body that has no Content-Type the type "application/x-www-form-urlencoded", for a Data body, an httpBody and
    // a stream alike, and nothing in URLSession turns that off (an empty value is sent as an empty header; only POST is affected, a PUT body goes out untyped).
    // A form parser on the server would then read binary bytes as fields. Such a body (bytes, or a Blob without a type: JavaScript types every other kind) is
    // sent as "application/octet-stream" instead, the type URLSession itself gives an upload from a file. The Fetch standard sends none; this is the nearest.
    for pair in requestInit.headers where pair.count >= 2 {
      request.addValue(pair[1], forHTTPHeaderField: pair[0])
    }
    if requestInit.method.uppercased() == "POST", request.value(forHTTPHeaderField: "Content-Type") == nil {
      if case .none = body {} else { request.setValue("application/octet-stream", forHTTPHeaderField: "Content-Type") }
    }
    if case .stream(let length, _) = body {
      // Without a length URLSession sends a stream chunked.
      request.setValue(String(length), forHTTPHeaderField: "Content-Length")
    }
    transfer.redirectMode = requestInit.redirect
    transfer.method = requestInit.method
    client.session(includingCookies: include).launch(request, body: body, transfer: transfer)
  }
}
