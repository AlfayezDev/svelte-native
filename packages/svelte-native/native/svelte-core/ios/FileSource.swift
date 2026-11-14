import Foundation

/// A `file://` URL answered like a response: 200, a Content-Length, and the file's bytes read on a background queue in chunks, paused while the transfer's buffer is
/// full.
final class FileSource: TransferSource, @unchecked Sendable {
  private static let chunkSize = 256 * 1024

  private let queue: DispatchQueue
  private weak var transfer: Transfer?
  private let lock = NSLock()
  private var descriptor: Int32 = -1
  private var paused = false
  private var cancelled = false
  /// A read loop is running (it holds the descriptor until it stops).
  private var pumping = false

  init(transfer: Transfer, queue: DispatchQueue) {
    self.transfer = transfer
    self.queue = queue
  }

  /// Opens the file, answers the head, and starts reading. A file that is missing, a directory, or unreadable is ERR_FETCH_NETWORK.
  func begin(path: String, url: String) {
    queue.async {
      guard let transfer = self.transfer else { return }
      let descriptor = Foundation.open(path, O_RDONLY | O_CLOEXEC)
      guard descriptor >= 0 else {
        transfer.ended(FetchException.network("Cannot open \(path): \(String(cString: strerror(errno)))"))
        return
      }
      var info = stat()
      guard fstat(descriptor, &info) == 0, (info.st_mode & S_IFMT) != S_IFDIR else {
        Foundation.close(descriptor)
        transfer.ended(FetchException.network("Cannot read \(path): it is a directory"))
        return
      }
      self.lock.lock()
      if self.cancelled {
        self.lock.unlock()
        Foundation.close(descriptor)
        return
      }
      self.descriptor = descriptor
      self.lock.unlock()
      transfer.deliver(head: NativeResponseHead(status: 200, statusText: "OK", headers: [["Content-Length", String(info.st_size)]], url: url, redirected: false))
      self.pump()
    }
  }

  func suspend() {
    lock.lock()
    paused = true
    lock.unlock()
  }

  func resume() {
    lock.lock()
    paused = false
    lock.unlock()
    queue.async { self.pump() }
  }

  func cancel() {
    lock.lock()
    cancelled = true
    let idle = !pumping
    lock.unlock()
    if idle { closeFile() }
  }

  private func closeFile() {
    lock.lock()
    let held = descriptor
    descriptor = -1
    lock.unlock()
    if held >= 0 { Foundation.close(held) }
  }

  /// Reads chunks until the end of the file, a pause, or a cancel. At most one loop runs at a time; `paused` and `pumping` change together under the lock,
  /// so a `resume` that races with a loop stopping for a pause always starts another.
  private func pump() {
    lock.lock()
    if pumping || paused || cancelled || descriptor < 0 {
      lock.unlock()
      return
    }
    pumping = true
    let file = descriptor
    lock.unlock()

    while true {
      lock.lock()
      if paused || cancelled {
        pumping = false
        let release = cancelled
        lock.unlock()
        if release { closeFile() }
        return
      }
      lock.unlock()

      guard let transfer else {
        finishLoop()
        return
      }
      var chunk = Data(count: Self.chunkSize)
      let n = chunk.withUnsafeMutableBytes { Foundation.read(file, $0.baseAddress, Self.chunkSize) }
      if n < 0 && errno == EINTR { continue }
      if n <= 0 {
        let failure = n < 0 ? FetchException.network("Cannot read the file: \(String(cString: strerror(errno)))") : nil
        finishLoop()
        transfer.ended(failure)
        return
      }
      if n < Self.chunkSize { chunk.removeLast(Self.chunkSize - n) }
      transfer.received(data: chunk)
    }
  }

  private func finishLoop() {
    lock.lock()
    pumping = false
    lock.unlock()
    closeFile()
  }
}
