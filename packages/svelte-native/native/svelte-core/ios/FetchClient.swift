import Foundation

/// Where the heavy work of this module runs: copying, decoding and file reads, whatever the size, so that no request waits behind another's 100 MB body. Not the
/// JavaScript thread, and not a serial queue (the session's delegate queue and the module's call queue must stay free for the callbacks and calls of other requests).
enum FetchWork {
  static let queue = DispatchQueue(label: "svelte.fetch.workers", qos: .userInitiated, attributes: .concurrent)
}

/// One URLSession and the table of its transfers. The session's delegate queue is serial, so the callbacks of every request arrive in order; each hands its
/// work to the request's `Transfer`.
final class FetchSession: NSObject, URLSessionDataDelegate, @unchecked Sendable {
  private var session: URLSession?
  private let lock = NSLock()
  private var transfers: [Int: Transfer] = [:]

  init(configuration: URLSessionConfiguration) {
    super.init()
    let queue = OperationQueue()
    queue.name = "svelte.fetch.session"
    queue.maxConcurrentOperationCount = 1
    queue.qualityOfService = .userInitiated
    session = URLSession(configuration: configuration, delegate: self, delegateQueue: queue)
  }

  /// Starts `request`. The task is in the table before it runs, so no callback can arrive for a transfer the session does not know.
  func launch(_ request: URLRequest, body: RequestBody, transfer: Transfer) {
    guard let session else {
      transfer.ended(FetchException.aborted())
      return
    }
    let task: URLSessionTask
    switch body {
    case .none:
      task = session.dataTask(with: request)
    case .data(let data):
      task = session.uploadTask(with: request, from: data)
    case .stream(_, let make):
      transfer.bodyStream = make
      task = session.uploadTask(withStreamedRequest: request)
    }
    lock.lock()
    transfers[task.taskIdentifier] = transfer
    lock.unlock()
    transfer.attach(task)
    task.resume()
  }

  /// Ends the session and every transfer in it (the tasks fail with a cancel, which reads as an abort).
  func shutdown() {
    session?.invalidateAndCancel()
  }

  private func transfer(for task: URLSessionTask) -> Transfer? {
    lock.lock()
    defer { lock.unlock() }
    return transfers[task.taskIdentifier]
  }

  // MARK: URLSessionDataDelegate

  func urlSession(
    _ session: URLSession,
    task: URLSessionTask,
    willPerformHTTPRedirection response: HTTPURLResponse,
    newRequest request: URLRequest,
    completionHandler: @escaping (URLRequest?) -> Void
  ) {
    completionHandler(transfer(for: task)?.willRedirect(task: task, to: request, from: response))
  }

  func urlSession(_ session: URLSession, task: URLSessionTask, needNewBodyStream completionHandler: @escaping (InputStream?) -> Void) {
    completionHandler(transfer(for: task)?.bodyStream?())
  }

  func urlSession(
    _ session: URLSession,
    dataTask: URLSessionDataTask,
    didReceive response: URLResponse,
    completionHandler: @escaping (URLSession.ResponseDisposition) -> Void
  ) {
    guard let transfer = transfer(for: dataTask) else {
      completionHandler(.cancel)
      return
    }
    transfer.received(head: response)
    completionHandler(.allow)
  }

  func urlSession(_ session: URLSession, dataTask: URLSessionDataTask, didReceive data: Data) {
    transfer(for: dataTask)?.received(data: data)
  }

  func urlSession(_ session: URLSession, task: URLSessionTask, didCompleteWithError error: Error?) {
    lock.lock()
    let transfer = transfers.removeValue(forKey: task.taskIdentifier)
    lock.unlock()
    transfer?.ended(error)
  }
}

/// The sessions and queues of one module instance. Cookies are a property of the session, not only of the request, so `credentials: "omit"` has a session of
/// its own that is anonymous: no Cookie is sent and no Set-Cookie is kept, whatever URLSession does with a request's own cookie flag.
final class FetchClient {
  /// The longest a request may be idle (React Native's own networking sets no timeout; URLSession's 60 seconds would end a quiet stream).
  static let timeout: TimeInterval = 600

  private let lock = NSLock()
  private var withCookies: FetchSession?
  private var withoutCookies: FetchSession?

  /// File reads of `file://` requests.
  let files = DispatchQueue(label: "svelte.fetch.files", qos: .userInitiated, attributes: .concurrent)

  func session(includingCookies: Bool) -> FetchSession {
    lock.lock()
    defer { lock.unlock() }
    if includingCookies {
      if let withCookies { return withCookies }
      let created = FetchSession(configuration: Self.configuration(includingCookies: true))
      withCookies = created
      return created
    }
    if let withoutCookies { return withoutCookies }
    let created = FetchSession(configuration: Self.configuration(includingCookies: false))
    withoutCookies = created
    return created
  }

  func shutdown() {
    lock.lock()
    let sessions = [withCookies, withoutCookies]
    withCookies = nil
    withoutCookies = nil
    lock.unlock()
    for session in sessions { session?.shutdown() }
  }

  private static func configuration(includingCookies: Bool) -> URLSessionConfiguration {
    let configuration = URLSessionConfiguration.default
    configuration.timeoutIntervalForRequest = timeout
    if includingCookies {
      // The store React Native's own networking reads and writes.
      configuration.httpCookieStorage = HTTPCookieStorage.shared
      configuration.httpShouldSetCookies = true
      configuration.httpCookieAcceptPolicy = .always
    } else {
      // Anonymous: no cookies, no stored credentials, and no cache (a cached response could carry what an earlier credentialed request fetched).
      configuration.httpCookieStorage = nil
      configuration.httpShouldSetCookies = false
      configuration.httpCookieAcceptPolicy = .never
      configuration.urlCredentialStorage = nil
      configuration.urlCache = nil
      configuration.requestCachePolicy = .reloadIgnoringLocalCacheData
    }
    // The same switch React Native's networking and expo/fetch honor.
    if Bundle.main.infoDictionary?["ReactNetworkForceWifiOnly"] as? Bool == true {
      configuration.allowsCellularAccess = false
    }
    return configuration
  }
}
