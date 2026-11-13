import ExpoModulesCore
import Foundation

/// What a transfer asks of whatever produces its bytes: a URLSession task, or a file being read.
protocol TransferSource: AnyObject {
  func suspend()
  func resume()
  func cancel()
}

extension URLSessionTask: TransferSource {}

/// The state of one request from `start` to the end of its body: the head promise, the bytes that arrived and have not been read, and the reads waiting for
/// them. The producer (URLSession's delegate queue, or a file reader) calls `received` and `ended`; JavaScript's calls reach `read`, `take` and `abort` through
/// the module. One lock guards all of it. Under the lock a call only moves state, starts or stops the producer, and collects the promises to settle; it
/// settles them, and copies bytes for them, after the lock is released.
///
/// Body bytes buffer as the chunks they arrived in. While more than a MiB is unread (and nobody has asked for the whole body) the producer is suspended, and
/// it resumes as reads drain the buffer below half a MiB.
final class Transfer: @unchecked Sendable {
  static let bufferLimit = 1024 * 1024
  static let resumeLevel = 512 * 1024
  static let maxRedirects = 20

  /// What `take` makes of the whole body.
  enum Whole {
    case arrayBuffer
    case text
    case blob(type: String)
  }

  private enum Consumer {
    case none
    case stream
    case whole
  }

  /// How the producer ended.
  private enum Ending {
    case running
    case completed
    case failed(FetchException)
  }

  /// Set before the request launches, and read afterwards only on the session's delegate queue.
  var redirectMode: RedirectMode = .follow
  var bodyStream: (() -> InputStream)?
  private var redirects = 0

  private let lock = NSLock()
  private var begun = false
  private var aborted = false
  /// The body was handed over to its end (or failed to be): there is nothing left to stop.
  private var finished = false
  private var headPromise: Promise?
  private var source: TransferSource?
  private var consumer = Consumer.none
  private var ending = Ending.running
  private var chunks: [Data] = []
  private var firstChunk = 0
  private var buffered = 0
  private var suspended = false
  private var readers: [(maxBytes: Int, promise: Promise)] = []
  private var whole: (kind: Whole, promise: Promise)?

  /// Whether `take` has claimed the body: the buffer then grows to the whole body instead of pausing the producer.
  private var readsWholeBody: Bool {
    if case .whole = consumer { return true }
    return false
  }

  // MARK: Starting

  /// Takes the promise `start` answers. False, with the promise already rejected, when the request was cancelled before it started or started twice.
  func begin(_ promise: Promise) -> Bool {
    lock.lock()
    if aborted {
      lock.unlock()
      promise.reject(FetchException.aborted())
      return false
    }
    if begun {
      lock.unlock()
      promise.reject(FetchException.network("This request has already been started"))
      return false
    }
    begun = true
    headPromise = promise
    lock.unlock()
    return true
  }

  func attach(_ newSource: TransferSource) {
    lock.lock()
    if aborted {
      lock.unlock()
      newSource.cancel()
      return
    }
    source = newSource
    lock.unlock()
  }

  // MARK: The producer's side

  func received(head response: URLResponse) {
    deliver(head: NativeResponseHead(of: response, redirected: redirects > 0))
  }

  func deliver(head: NativeResponseHead) {
    lock.lock()
    let promise = headPromise
    headPromise = nil
    lock.unlock()
    promise?.resolve(head)
  }

  func received(data: Data) {
    guard !data.isEmpty else { return }
    lock.lock()
    guard !aborted, case .running = ending else {
      lock.unlock()
      return
    }
    chunks.append(data)
    buffered += data.count
    if !readsWholeBody && !suspended && buffered > Self.bufferLimit {
      suspended = true
      source?.suspend()
    }
    let actions = drain()
    lock.unlock()
    actions.forEach { $0() }
  }

  /// The producer is done: with the whole body (`error` nil) or with a failure. A failure before the head rejects `start`; one after it is delivered once the
  /// bytes that arrived before it have been read.
  func ended(_ error: Error?) {
    lock.lock()
    guard !aborted, case .running = ending else {
      lock.unlock()
      return
    }
    var actions: [() -> Void] = []
    let failure = error.map { FetchException.from($0) }
    if let failure {
      ending = .failed(failure)
    } else {
      ending = .completed
    }
    if let promise = headPromise {
      headPromise = nil
      let reason = failure ?? FetchException.network("The connection ended without a response")
      actions.append { promise.reject(reason) }
    }
    source = nil
    suspended = false
    actions += drain()
    lock.unlock()
    actions.forEach { $0() }
  }

  /// The redirect decision (on the delegate queue): the request to follow, or nil to stop here.
  func willRedirect(task: URLSessionTask, to request: URLRequest, from response: HTTPURLResponse) -> URLRequest? {
    switch redirectMode {
    case .manual:
      return nil
    case .error:
      ended(FetchException.redirect("The server redirected (\(response.statusCode)) and the redirect mode is \"error\""))
      task.cancel()
      return nil
    case .follow:
      redirects += 1
      if redirects > Self.maxRedirects {
        ended(FetchException.redirect("More than \(Self.maxRedirects) redirects"))
        task.cancel()
        return nil
      }
      return request
    }
  }

  // MARK: JavaScript's side

  /// `NativeRequest.read`: the next bytes, as soon as there are any.
  func read(_ maxBytes: Int, _ promise: Promise) {
    lock.lock()
    if readsWholeBody {
      lock.unlock()
      promise.reject(FetchException.bodyUsed())
      return
    }
    consumer = .stream
    readers.append((max(maxBytes, 1), promise))
    let actions = drain()
    lock.unlock()
    actions.forEach { $0() }
  }

  /// `arrayBuffer`, `text` and `blob`: the rest of the body, which switches the backpressure off.
  func take(_ kind: Whole, _ promise: Promise) {
    lock.lock()
    guard case .none = consumer else {
      lock.unlock()
      promise.reject(FetchException.bodyUsed())
      return
    }
    consumer = .whole
    whole = (kind, promise)
    if suspended {
      suspended = false
      source?.resume()
    }
    let actions = drain()
    lock.unlock()
    actions.forEach { $0() }
  }

  /// `cancel` and the release of the JavaScript object: stops the producer, frees the buffer, rejects whatever is waiting. Nothing to do once the body has
  /// been read to its end.
  func abort() {
    lock.lock()
    if finished || aborted {
      lock.unlock()
      return
    }
    aborted = true
    chunks.removeAll()
    firstChunk = 0
    buffered = 0
    suspended = false
    var actions: [() -> Void] = []
    if let promise = headPromise {
      headPromise = nil
      actions.append { promise.reject(FetchException.aborted()) }
    }
    actions += drain()
    let stopped = source
    source = nil
    lock.unlock()
    stopped?.cancel()
    actions.forEach { $0() }
  }

  // MARK: Settling (the lock is held)

  /// Hands the buffered bytes, the end, or the failure to whoever is waiting. Returns the work to do after the lock is released.
  private func drain() -> [() -> Void] {
    var actions: [() -> Void] = []
    if aborted {
      let reason = FetchException.aborted()
      for reader in readers {
        let promise = reader.promise
        actions.append { promise.reject(reason) }
      }
      readers.removeAll()
      if let waiting = whole {
        whole = nil
        actions.append { waiting.promise.reject(reason) }
      }
      return actions
    }

    reading: while let reader = readers.first {
      let promise = reader.promise
      if buffered > 0 {
        let parts = take(upTo: reader.maxBytes)
        readers.removeFirst()
        actions.append { promise.resolve(ByteBuffers.make(joining: parts)) }
        continue
      }
      switch ending {
      case .running:
        break reading
      case .completed:
        readers.removeFirst()
        finished = true
        actions.append { promise.resolve() }
      case .failed(let failure):
        readers.removeFirst()
        finished = true
        actions.append { promise.reject(failure) }
      }
    }

    if let waiting = whole {
      switch ending {
      case .running:
        break
      case .failed(let failure):
        whole = nil
        finished = true
        actions.append { waiting.promise.reject(failure) }
      case .completed:
        whole = nil
        finished = true
        let parts = take(upTo: buffered)
        switch waiting.kind {
        case .arrayBuffer:
          actions.append { waiting.promise.resolve(ByteBuffers.make(joining: parts)) }
        case .text:
          actions.append { waiting.promise.resolve(decodeUTF8(Self.join(parts))) }
        case .blob(let type):
          actions.append { waiting.promise.resolve(NativeBlob(segments: parts.map { BlobSegment.bytes($0) }, type: type)) }
        }
      }
    }
    return actions
  }

  /// Removes up to `limit` bytes from the front of the buffer, resuming the producer when that leaves the buffer drained enough.
  private func take(upTo limit: Int) -> [Data] {
    var remaining = min(limit, buffered)
    buffered -= remaining
    var parts: [Data] = []
    while remaining > 0 {
      let chunk = chunks[firstChunk]
      if chunk.count <= remaining {
        parts.append(chunk)
        remaining -= chunk.count
        chunks[firstChunk] = Data()
        firstChunk += 1
      } else {
        parts.append(chunk.prefix(remaining))
        chunks[firstChunk] = chunk.dropFirst(remaining)
        remaining = 0
      }
    }
    if firstChunk == chunks.count {
      chunks.removeAll(keepingCapacity: true)
      firstChunk = 0
    } else if firstChunk >= 64 && firstChunk * 2 >= chunks.count {
      chunks.removeFirst(firstChunk)
      firstChunk = 0
    }
    if suspended && buffered <= Self.resumeLevel {
      suspended = false
      source?.resume()
    }
    return parts
  }

  private static func join(_ parts: [Data]) -> Data {
    if parts.count == 1 { return parts[0] }
    var all = Data(capacity: parts.reduce(0) { $0 + $1.count })
    for part in parts { all.append(part) }
    return all
  }
}
