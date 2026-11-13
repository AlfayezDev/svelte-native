import ExpoModulesCore
import Foundation

/// The bytes a request sends, prepared for URLSession.
enum RequestBody {
  case none
  /// In memory, sent whole (URLSession adds the Content-Length).
  case data(Data)
  /// Read from segments as they are sent; `length` is the Content-Length. The closure makes a new stream: URLSession asks for one again when a 307 or 308
  /// redirect sends the body a second time.
  case stream(length: Int, make: () -> InputStream)

  /// An in-memory body at or below this many bytes is joined into one `Data`; a larger join is streamed from its segments.
  static let joinLimit = 8 * 1024 * 1024

  init(_ body: EitherOfThree<NativeBlob, Data, String>?) {
    guard let body else {
      self = .none
      return
    }
    if let blob: NativeBlob = body.get() {
      self = blob.requestBody()
    } else if let data: Data = body.get() {
      self = .data(data)
    } else if let text: String = body.get() {
      self = .data(Data(text.utf8))
    } else {
      self = .none
    }
  }
}

/// A request body that reads its Blob segments as URLSession pulls it, so a file segment is never held in memory whole.
///
/// URLSession needs a stream it can read synchronously: a custom `InputStream` that is always ready, as AFNetworking's multipart body is. CFNetwork also
/// sends a toll-free bridged stream three private messages (run loop scheduling and client flags) that a subclass answers with nothing, because this stream
/// never signals: it has bytes available until the end.
final class SegmentInputStream: InputStream {
  private let segments: [BlobSegment]
  private let lock = NSLock()
  private var index = 0
  /// How much of `segments[index]` has been read.
  private var position = 0
  private var descriptor: Int32 = -1
  private var state = Stream.Status.notOpen
  private var failure: Error?
  private weak var streamDelegate: StreamDelegate?

  init(segments: [BlobSegment]) {
    self.segments = segments
    super.init(data: Data())
  }

  deinit {
    closeFile()
  }

  private func closeFile() {
    if descriptor >= 0 {
      Foundation.close(descriptor)
      descriptor = -1
    }
  }

  override var streamStatus: Stream.Status {
    lock.lock()
    defer { lock.unlock() }
    if state == .open && index >= segments.count { return .atEnd }
    return state
  }

  override var streamError: Error? {
    lock.lock()
    defer { lock.unlock() }
    return failure
  }

  override var delegate: StreamDelegate? {
    get { streamDelegate }
    set { streamDelegate = newValue }
  }

  override var hasBytesAvailable: Bool {
    streamStatus == .open
  }

  override func open() {
    lock.lock()
    defer { lock.unlock() }
    if state == .notOpen { state = .open }
  }

  override func close() {
    lock.lock()
    defer { lock.unlock() }
    closeFile()
    state = .closed
  }

  override func read(_ buffer: UnsafeMutablePointer<UInt8>, maxLength length: Int) -> Int {
    lock.lock()
    defer { lock.unlock() }
    guard state == .open else { return state == .atEnd ? 0 : -1 }
    var written = 0
    while written < length && index < segments.count {
      let segment = segments[index]
      let count = min(segment.length - position, length - written)
      if count > 0 {
        do {
          switch segment {
          case .bytes(let data):
            data.withUnsafeBytes { source in _ = memcpy(buffer + written, source.baseAddress! + position, count) }
          case .file(let path, let offset, _):
            if descriptor < 0 {
              descriptor = Foundation.open(path, O_RDONLY | O_CLOEXEC)
              if descriptor < 0 { throw FetchException.network("Cannot open \(path): \(String(cString: strerror(errno)))") }
            }
            try FileBytes.read(descriptor: descriptor, path: path, offset: offset + position, count: count, into: buffer + written)
          }
        } catch {
          failure = error
          state = .error
          return written > 0 ? written : -1
        }
        written += count
        position += count
      }
      if position >= segment.length {
        closeFile()
        index += 1
        position = 0
      }
    }
    return written
  }

  override func getBuffer(_ buffer: UnsafeMutablePointer<UnsafeMutablePointer<UInt8>?>, length: UnsafeMutablePointer<Int>) -> Bool {
    false
  }

  override func property(forKey key: Stream.PropertyKey) -> Any? {
    nil
  }

  override func setProperty(_ property: Any?, forKey key: Stream.PropertyKey) -> Bool {
    false
  }

  override func schedule(in aRunLoop: RunLoop, forMode mode: RunLoop.Mode) {}

  override func remove(from aRunLoop: RunLoop, forMode mode: RunLoop.Mode) {}

  @objc(_scheduleInCFRunLoop:forMode:)
  func scheduleInCFRunLoop(_ runLoop: AnyObject, forMode mode: AnyObject) {}

  @objc(_unscheduleFromCFRunLoop:forMode:)
  func unscheduleFromCFRunLoop(_ runLoop: AnyObject, forMode mode: AnyObject) {}

  @objc(_setCFClientFlags:callback:context:)
  func setCFClientFlags(_ flags: UInt, callback: UnsafeMutableRawPointer?, context: UnsafeMutableRawPointer?) -> Bool {
    false
  }
}
