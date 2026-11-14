import Foundation

/// One immutable run of a Blob's bytes. Blobs share segments (a slice or a join makes no copy of them); nothing here changes a byte after it is made.
enum BlobSegment {
  /// Bytes in memory. A slice of a `Data` shares its storage.
  case bytes(Data)
  /// A range of a file, read when the bytes are needed (so the file is not held open, and a file that has gone fails the read with ERR_FETCH_NETWORK).
  case file(path: String, offset: Int, length: Int)

  var length: Int {
    switch self {
    case .bytes(let data): return data.count
    case .file(_, _, let length): return length
    }
  }

  /// Bytes [from, to) of this segment, as a segment.
  func slice(_ from: Int, _ to: Int) -> BlobSegment {
    if from == 0 && to == length { return self }
    switch self {
    case .bytes(let data):
      return .bytes(data[(data.startIndex + from)..<(data.startIndex + to)])
    case .file(let path, let offset, _):
      return .file(path: path, offset: offset + from, length: to - from)
    }
  }

  /// Copies bytes [from, to) of this segment to `destination`.
  func copy(_ from: Int, _ to: Int, to destination: UnsafeMutableRawPointer) throws {
    let count = to - from
    guard count > 0 else { return }
    switch self {
    case .bytes(let data):
      data.withUnsafeBytes { source in _ = memcpy(destination, source.baseAddress! + from, count) }
    case .file(let path, let offset, _):
      try FileBytes.read(path: path, offset: offset + from, count: count, into: destination)
    }
  }
}

/// Plain POSIX reads and writes: no FileHandle object to keep, and `pread` takes the offset, so a segment is read without any seek state.
enum FileBytes {
  static func read(path: String, offset: Int, count: Int, into destination: UnsafeMutableRawPointer) throws {
    let descriptor = open(path, O_RDONLY | O_CLOEXEC)
    guard descriptor >= 0 else { throw FetchException.network("Cannot open \(path): \(String(cString: strerror(errno)))") }
    defer { close(descriptor) }
    try read(descriptor: descriptor, path: path, offset: offset, count: count, into: destination)
  }

  /// Reads from a file that is already open (`path` only names it in the error).
  static func read(descriptor: Int32, path: String, offset: Int, count: Int, into destination: UnsafeMutableRawPointer) throws {
    var done = 0
    while done < count {
      let n = pread(descriptor, destination + done, count - done, off_t(offset + done))
      if n < 0 && errno == EINTR { continue }
      if n < 0 { throw FetchException.network("Cannot read \(path): \(String(cString: strerror(errno)))") }
      if n == 0 { throw FetchException.network("\(path) is shorter than the Blob that was made from it") }
      done += n
    }
  }

  static func write(_ descriptor: Int32, _ source: UnsafeRawPointer, count: Int, to path: String) throws {
    var done = 0
    while done < count {
      let n = Foundation.write(descriptor, source + done, count - done)
      if n < 0 && errno == EINTR { continue }
      if n <= 0 { throw FetchException.network("Cannot write \(path): \(String(cString: strerror(errno)))") }
      done += n
    }
  }

  /// The size of a regular file, or nil when `path` cannot be opened or is a directory.
  static func size(of path: String) -> Int? {
    let descriptor = open(path, O_RDONLY | O_CLOEXEC)
    guard descriptor >= 0 else { return nil }
    defer { close(descriptor) }
    var info = stat()
    guard fstat(descriptor, &info) == 0, (info.st_mode & S_IFMT) != S_IFDIR else { return nil }
    return Int(info.st_size)
  }
}
