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
      if requestInit.method == "POST" { ContentTypeProbe.runOnce(for: target) }
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
    for pair in requestInit.headers where pair.count >= 2 {
      request.addValue(pair[1], forHTTPHeaderField: pair[0])
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
