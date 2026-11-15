import ExpoModulesCore
import Foundation

/// The ArrayBuffers this module returns: memory that native code allocated, which JavaScript gets as an ArrayBuffer over the same memory (Expo's
/// `NativeArrayBuffer`: no copy on the way in, freed when JavaScript's garbage collector drops the ArrayBuffer).
enum ByteBuffers {
  /// A buffer of `count` bytes that `fill` writes. An allocation of its own, so JavaScript can write to the ArrayBuffer without touching any Blob or response.
  static func make(count: Int, fill: (UnsafeMutableRawPointer) throws -> Void) throws -> NativeArrayBuffer {
    // A zero-length buffer still needs an address: `NativeArrayBuffer.wrap` rejects a nil base address.
    let memory = UnsafeMutableRawPointer.allocate(byteCount: max(count, 1), alignment: 16)
    do {
      try fill(memory)
      return try NativeArrayBuffer.wrap(dataWithoutCopy: UnsafeMutableRawBufferPointer(start: memory, count: count)) { memory.deallocate() }
    } catch {
      memory.deallocate()
      throw error
    }
  }

  /// The concatenation of `parts`. One part is wrapped as it is (the parts of a response body belong to this module alone: nothing else can see JavaScript's
  /// writes to it); several are copied once into one allocation.
  static func make(joining parts: [Data]) -> NativeArrayBuffer {
    let count = parts.reduce(0) { $0 + $1.count }
    if parts.count == 1, count > 0 { return NativeArrayBuffer.wrap(dataWithoutCopy: parts[0]) }
    do {
      return try make(count: count) { destination in
        var position = 0
        for part in parts where !part.isEmpty {
          part.withUnsafeBytes { source in _ = memcpy(destination + position, source.baseAddress!, part.count) }
          position += part.count
        }
      }
    } catch {
      return NativeArrayBuffer.allocate(size: 0)
    }
  }
}

/// A String from UTF-8 bytes the way the Encoding standard's "UTF-8 decode" reads them: a leading byte order mark is dropped, and each ill-formed sequence
/// (Swift repairs by the maximal subpart, as the standard does) becomes U+FFFD.
func decodeUTF8(_ bytes: Data) -> String {
  let mark: [UInt8] = [0xEF, 0xBB, 0xBF]
  if bytes.starts(with: mark) { return String(decoding: bytes.dropFirst(3), as: UTF8.self) }
  return String(decoding: bytes, as: UTF8.self)
}
