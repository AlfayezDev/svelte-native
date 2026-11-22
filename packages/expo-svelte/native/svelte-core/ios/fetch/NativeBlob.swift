import ExpoModulesCore
import Foundation

/// A Blob's bytes: an ordered list of immutable segments. Constructing one from Blobs and `slice` share the segments, so no bytes are copied until something
/// reads them; a read allocates its own buffer and never hands JavaScript memory that another Blob can see.
final class NativeBlob: SharedObject, @unchecked Sendable {
  let segments: [BlobSegment]
  let size: Int
  let type: String
  /// The offset of each segment in the Blob, so a slice or a read finds its first segment by binary search.
  private let starts: [Int]
  private let lock = NSLock()
  private var objectFile: URL?

  init(segments: [BlobSegment], type: String) {
    var kept: [BlobSegment] = []
    var starts: [Int] = []
    var total = 0
    for segment in segments where segment.length > 0 {
      kept.append(segment)
      starts.append(total)
      total += segment.length
    }
    self.segments = kept
    self.starts = starts
    self.size = total
    self.type = type
    super.init()
  }

  /// The Blob of a constructor call: Blobs contribute their segments, bytes and strings (UTF-8; JavaScript's lone surrogates reach Swift as U+FFFD already)
  /// become one segment each.
  convenience init(parts: [EitherOfThree<NativeBlob, Data, String>], type: String) {
    var segments: [BlobSegment] = []
    for part in parts {
      if let blob: NativeBlob = part.get() {
        segments.append(contentsOf: blob.segments)
      } else if let data: Data = part.get() {
        segments.append(.bytes(data))
      } else if let text: String = part.get() {
        segments.append(.bytes(Data(text.utf8)))
      }
    }
    self.init(segments: segments, type: type)
  }

  /// The memory JavaScript's garbage collector cannot see: the in-memory bytes this Blob keeps alive.
  override func getAdditionalMemoryPressure() -> Int {
    segments.reduce(0) { total, segment in
      if case .bytes(let data) = segment { return total + data.count }
      return total
    }
  }

  /// A Blob over a local file, read when its bytes are needed: a `file://` URL or an absolute path. Its size is the file's now.
  static func fromURI(_ uri: String, type: String) throws -> NativeBlob {
    let path: String
    if uri.hasPrefix("/") {
      path = uri
    } else if let url = FetchURL.parse(uri), url.scheme?.lowercased() == "file" {
      path = url.path
    } else {
      throw FetchException.url("Not a file: URL: \(uri)")
    }
    guard let size = FileBytes.size(of: path) else { throw FetchException.network("Cannot open \(path)") }
    return NativeBlob(segments: [.file(path: path, offset: 0, length: size)], type: type)
  }

  // MARK: Slices

  /// The index of the segment that holds `offset` (0 <= offset < size).
  private func segmentIndex(containing offset: Int) -> Int {
    var low = 0
    var high = starts.count - 1
    while low < high {
      let middle = (low + high + 1) / 2
      if starts[middle] <= offset { low = middle } else { high = middle - 1 }
    }
    return low
  }

  func slice(from start: Int, to end: Int, type: String) -> NativeBlob {
    let lower = max(0, min(start, size))
    let upper = max(lower, min(end, size))
    if lower == upper { return NativeBlob(segments: [], type: type) }
    var parts: [BlobSegment] = []
    var index = segmentIndex(containing: lower)
    while index < segments.count && starts[index] < upper {
      let base = starts[index]
      let segment = segments[index]
      parts.append(segment.slice(max(lower, base) - base, min(upper, base + segment.length) - base))
      index += 1
    }
    return NativeBlob(segments: parts, type: type)
  }

  // MARK: Reading

  /// Copies bytes [from, to) of the Blob to `destination`.
  private func copy(_ from: Int, _ to: Int, into destination: UnsafeMutableRawPointer) throws {
    guard from < to else { return }
    var written = 0
    var index = segmentIndex(containing: from)
    while index < segments.count && starts[index] < to {
      let base = starts[index]
      let segment = segments[index]
      let low = max(from, base) - base
      let high = min(to, base + segment.length) - base
      try segment.copy(low, high, to: destination + written)
      written += high - low
      index += 1
    }
  }

  /// Bytes [from, to) as a new ArrayBuffer.
  func read(from: Int, to: Int) throws -> NativeArrayBuffer {
    let lower = max(0, min(from, size))
    let upper = max(lower, min(to, size))
    return try ByteBuffers.make(count: upper - lower) { try copy(lower, upper, into: $0) }
  }

  /// All bytes as `Data`: shared when they are one in-memory segment, else gathered into one allocation.
  func contiguousBytes() throws -> Data {
    if segments.count == 1, case .bytes(let data) = segments[0] { return data }
    var data = Data(count: size)
    try data.withUnsafeMutableBytes { raw in
      if let base = raw.baseAddress { try copy(0, size, into: base) }
    }
    return data
  }

  // MARK: Sending

  /// How a request carries these bytes. In memory and small (or one segment): one `Data`, which URLSession sends with a Content-Length. Anything else, a
  /// file segment or a large join: a stream over the segments, so file bytes are read as they are sent and a join is not copied.
  func requestBody() -> RequestBody {
    var memoryOnly = true
    for segment in segments {
      if case .file = segment { memoryOnly = false }
    }
    if segments.isEmpty { return .data(Data()) }
    if memoryOnly && (segments.count == 1 || size <= RequestBody.joinLimit) {
      if let data = try? contiguousBytes() {
        // A slice keeps its parent's indices; the body is sent from a Data that starts at zero.
        return .data(data.startIndex == 0 ? data : Data(data))
      }
    }
    let segments = self.segments
    return .stream(length: size) { SegmentInputStream(segments: segments) }
  }

  // MARK: Object URLs

  /// A `file://` URL of a file holding the bytes, written on the first call and reused. If the file was revoked since, it is written again at the same URL.
  func objectURL() throws -> String {
    lock.lock()
    defer { lock.unlock() }
    let url = objectFile ?? BlobFiles.newFileURL()
    if objectFile == nil || !FileManager.default.fileExists(atPath: url.path) {
      try write(to: url)
    }
    objectFile = url
    return url.absoluteString
  }

  private func write(to url: URL) throws {
    BlobFiles.ensureDirectory()
    let path = url.path
    let descriptor = open(path, O_WRONLY | O_CREAT | O_TRUNC | O_CLOEXEC, 0o644)
    guard descriptor >= 0 else { throw FetchException.network("Cannot create \(path): \(String(cString: strerror(errno)))") }
    defer { close(descriptor) }
    do {
      let chunk = 256 * 1024
      let buffer = UnsafeMutableRawPointer.allocate(byteCount: chunk, alignment: 16)
      defer { buffer.deallocate() }
      var position = 0
      while position < size {
        let end = min(position + chunk, size)
        try copy(position, end, into: buffer)
        try FileBytes.write(descriptor, buffer, count: end - position, to: path)
        position = end
      }
    } catch {
      unlink(path)
      throw error
    }
  }
}

/// The files behind object URLs: `Caches/expo-svelte-blobs/<uuid>`, written once and deleted only by `revokeObjectURL`.
enum BlobFiles {
  static let directory: URL = FileManager.default.urls(for: .cachesDirectory, in: .userDomainMask)[0].appendingPathComponent("expo-svelte-blobs", isDirectory: true)

  private static let lock = NSLock()
  /// The names of the files this process has made: the sweep leaves them alone.
  private static var made = Set<String>()
  private static var swept = false

  /// The system may purge Caches while the app runs, so every write makes sure the directory is there.
  static func ensureDirectory() {
    try? FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
  }

  /// Once per process, at module load and off the JavaScript thread: deletes the files an earlier run left (their URLs no longer exist). A file made in this
  /// process is in `made` before it exists, so a sweep that races with a first write cannot delete it.
  static func sweepLeftovers(on queue: DispatchQueue) {
    lock.lock()
    let first = !swept
    swept = true
    lock.unlock()
    guard first else { return }
    queue.async {
      let manager = FileManager.default
      guard let leftovers = try? manager.contentsOfDirectory(at: directory, includingPropertiesForKeys: nil) else { return }
      for file in leftovers {
        lock.lock()
        let mine = made.contains(file.lastPathComponent)
        lock.unlock()
        if !mine { try? manager.removeItem(at: file) }
      }
    }
  }

  static func newFileURL() -> URL {
    let name = UUID().uuidString.lowercased()
    lock.lock()
    made.insert(name)
    lock.unlock()
    return directory.appendingPathComponent(name, isDirectory: false)
  }

  /// Deletes the file behind `url` when it is a file in the blobs directory; anything else is left alone.
  static func revoke(_ url: String) {
    guard let target = FetchURL.parse(url), target.isFileURL else { return }
    let file = target.standardizedFileURL.resolvingSymlinksInPath()
    guard file.deletingLastPathComponent().path == directory.resolvingSymlinksInPath().path else { return }
    try? FileManager.default.removeItem(at: file)
  }
}
