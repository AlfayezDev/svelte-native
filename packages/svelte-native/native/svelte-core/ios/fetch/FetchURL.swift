import Foundation

/// URLs as the JavaScript side writes them. A WHATWG `href` leaves some characters raw that RFC 3986 does not allow outside the host (`[ ] | ^ { } \`` and spaces in
/// the path or query, as `fetch("https://h/x?filter[a]=1|2")` has), and `URL(string:)` before iOS 17 returns nil for them, where iOS 17 encodes them itself.
enum FetchURL {
  static func parse(_ string: String) -> URL? {
    if let url = URL(string: string) { return url }
    return URL(string: encodeInvalidCharacters(string))
  }

  /// `string` with every byte that a URL cannot carry after its authority percent-encoded: the host (an IPv6 literal has brackets) and the escapes that are
  /// already there (`%XX`, never encoded twice) are left alone.
  static func encodeInvalidCharacters(_ string: String) -> String {
    var restStart = string.startIndex
    if let colon = string.firstIndex(of: ":") {
      restStart = string.index(after: colon)
      if string[restStart...].hasPrefix("//") {
        let authority = string.index(restStart, offsetBy: 2)
        restStart = string[authority...].firstIndex(where: { $0 == "/" || $0 == "?" || $0 == "#" }) ?? string.endIndex
      }
    }
    var encoded = String(string[..<restStart])
    let bytes = Array(string[restStart...].utf8)
    let digits = Array("0123456789ABCDEF".utf8)
    var index = 0
    while index < bytes.count {
      let byte = bytes[index]
      let escape = byte == 0x25 && index + 2 < bytes.count && isHex(bytes[index + 1]) && isHex(bytes[index + 2])
      if escape || isAllowed(byte) {
        encoded.unicodeScalars.append(Unicode.Scalar(byte))
      } else {
        encoded.unicodeScalars.append("%")
        encoded.unicodeScalars.append(Unicode.Scalar(digits[Int(byte >> 4)]))
        encoded.unicodeScalars.append(Unicode.Scalar(digits[Int(byte & 15)]))
      }
      index += 1
    }
    return encoded
  }

  private static func isHex(_ byte: UInt8) -> Bool {
    (byte >= 0x30 && byte <= 0x39) || (byte >= 0x41 && byte <= 0x46) || (byte >= 0x61 && byte <= 0x66)
  }

  /// Unreserved characters and the reserved ones a path, query or fragment may carry (not `[` and `]`, which belong to the host).
  private static func isAllowed(_ byte: UInt8) -> Bool {
    switch byte {
    case 0x30...0x39, 0x41...0x5A, 0x61...0x7A: return true
    case UInt8(ascii: "-"), UInt8(ascii: "."), UInt8(ascii: "_"), UInt8(ascii: "~"): return true
    case UInt8(ascii: ":"), UInt8(ascii: "/"), UInt8(ascii: "?"), UInt8(ascii: "#"), UInt8(ascii: "@"): return true
    case UInt8(ascii: "!"), UInt8(ascii: "$"), UInt8(ascii: "&"), UInt8(ascii: "'"), UInt8(ascii: "("), UInt8(ascii: ")"): return true
    case UInt8(ascii: "*"), UInt8(ascii: "+"), UInt8(ascii: ","), UInt8(ascii: ";"), UInt8(ascii: "="): return true
    default: return false
    }
  }
}
