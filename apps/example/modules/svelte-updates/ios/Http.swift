import CryptoKit
import Foundation

/// Plain `URLSession` GETs: the manifest request and the asset downloads. Both block the calling (background) thread.
enum Http {
  struct Response {
    let status: Int
    let headers: [String: String]
    let body: String
  }

  private static func request(_ url: String, _ headers: [String: String]) throws -> URLRequest {
    guard let target = URL(string: url) else { throw StoreError("Invalid URL: \(url)") }
    var request = URLRequest(url: target, cachePolicy: .reloadIgnoringLocalCacheData, timeoutInterval: 30)
    request.httpMethod = "GET"
    for (name, value) in headers { request.setValue(value, forHTTPHeaderField: name) }
    return request
  }

  /// Response headers with lowercase names.
  private static func headers(of response: HTTPURLResponse) -> [String: String] {
    var result: [String: String] = [:]
    for (name, value) in response.allHeaderFields { if let name = name as? String, let value = value as? String { result[name.lowercased()] = value } }
    return result
  }

  private static func wait<T>(_ start: (@escaping (T?, URLResponse?, Error?) -> Void) -> URLSessionTask) throws -> (T, HTTPURLResponse) {
    let semaphore = DispatchSemaphore(value: 0)
    var outcome: (T?, URLResponse?, Error?) = (nil, nil, nil)
    start { value, response, error in
      outcome = (value, response, error)
      semaphore.signal()
    }.resume()
    semaphore.wait()
    if let error = outcome.2 { throw error }
    guard let value = outcome.0, let response = outcome.1 as? HTTPURLResponse else { throw StoreError("No response") }
    return (value, response)
  }

  static func get(_ url: String, headers requestHeaders: [String: String]) throws -> Response {
    let built = try request(url, requestHeaders)
    let (data, response) = try wait { done in URLSession.shared.dataTask(with: built, completionHandler: done) }
    return Response(status: response.statusCode, headers: headers(of: response), body: String(decoding: data, as: UTF8.self))
  }

  /// Downloads `url` to a temporary file, then moves it to `destination` only if its SHA-256 (base64url, no padding) is
  /// `expectedHash`. Returns the hash it computed.
  static func download(_ url: String, headers requestHeaders: [String: String], to destination: URL, expectedHash: String) throws -> String {
    let built = try request(url, requestHeaders)
    // URLSession deletes its file when the completion handler returns, so the handler moves it somewhere of ours first.
    let (temporary, response) = try wait { done in
      URLSession.shared.downloadTask(with: built) { location, response, error in
        var kept: URL?
        if let location {
          let target = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
          if (try? FileManager.default.moveItem(at: location, to: target)) != nil { kept = target }
        }
        done(kept, response, error)
      }
    }
    defer { try? FileManager.default.removeItem(at: temporary) }
    guard (200...299).contains(response.statusCode) else { throw StoreError("Download of \(url) failed with status \(response.statusCode)") }
    let hash = try sha256(of: temporary)
    guard hash == expectedHash else { throw StoreError("Download of \(url) has SHA-256 \(hash), expected \(expectedHash)") }
    // The bytes are on disk before the move gives them their name: without this a crash or a power cut shortly after leaves the name
    // with no data behind it (an empty file), which the store would trust as a bundle or as an asset it had verified.
    let written = try FileHandle(forUpdating: temporary)
    try written.synchronize()
    try written.close()
    try FileManager.default.createDirectory(at: destination.deletingLastPathComponent(), withIntermediateDirectories: true)
    // `replaceItemAt` swaps an existing file in one step; two assets with identical content share a name.
    if FileManager.default.fileExists(atPath: destination.path) {
      _ = try FileManager.default.replaceItemAt(destination, withItemAt: temporary)
    } else {
      try FileManager.default.moveItem(at: temporary, to: destination)
    }
    return hash
  }

  /// The file at `destination` with SHA-256 `expectedHash`, downloaded unless it is already there. A file in place counts only if it
  /// hashes to `expectedHash`: one that does not (data lost to a crash, damaged storage) is reported to `onDamaged` with its hash and
  /// replaced by a download, which is itself held to `expectedHash`, so bytes that are not the manifest's are still rejected.
  /// `reuse` is false for a file that belongs to one update (the bundle), which is always downloaded. Returns the hash of the file.
  static func ensure(_ url: String, headers requestHeaders: [String: String], to destination: URL, expectedHash: String, reuse: Bool, onDamaged: (String) -> Void) throws -> String {
    if reuse && FileManager.default.fileExists(atPath: destination.path) {
      let actual = try sha256(of: destination)
      if actual == expectedHash { return actual }
      onDamaged(actual)
    }
    return try download(url, headers: requestHeaders, to: destination, expectedHash: expectedHash)
  }

  static func sha256(of file: URL) throws -> String {
    let handle = try FileHandle(forReadingFrom: file)
    defer { try? handle.close() }
    var hasher = SHA256()
    while let chunk = try handle.read(upToCount: 64 * 1024), !chunk.isEmpty { hasher.update(data: chunk) }
    return Data(hasher.finalize()).base64EncodedString()
      .replacingOccurrences(of: "+", with: "-").replacingOccurrences(of: "/", with: "_").replacingOccurrences(of: "=", with: "")
  }
}
