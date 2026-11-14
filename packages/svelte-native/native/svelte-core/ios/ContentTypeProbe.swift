import Foundation

/// TEMPORARY: which ways of attaching a POST body leave URLSession without its default Content-Type. Runs once, at the first POST to the test server's /echo, and reports
/// each way to /report. To be removed.
enum ContentTypeProbe {
  private static let lock = NSLock()
  private static var ran = false

  static func runOnce(for url: URL) {
    lock.lock()
    let first = !ran
    ran = true
    lock.unlock()
    guard first, url.port == 8787, url.path == "/echo" else { return }
    DispatchQueue.global().async { run(url) }
  }

  private static func run(_ echo: URL) {
    let bytes = Data((0..<64).map { UInt8($0) })
    let file = FileManager.default.temporaryDirectory.appendingPathComponent("probe-body.bin")
    try? bytes.write(to: file)
    var lines: [String] = []

    func request(_ method: String = "POST") -> URLRequest {
      var request = URLRequest(url: echo)
      request.httpMethod = method
      return request
    }

    func finish(_ name: String, _ data: Data?, _ error: Error?) {
      var result = "error \(String(describing: error))"
      if let data, let json = try? JSONSerialization.jsonObject(with: data) as? [String: Any], let headers = json["headers"] as? [[String]] {
        let types = headers.filter { $0[0] == "content-type" }.map { "\"\($0[1])\"" }
        result = "content-type: " + (types.isEmpty ? "NONE" : types.joined(separator: ", "))
      }
      lines.append("[web-apis] probe \(name): \(result)")
    }

    func send(_ name: String, configuration: URLSessionConfiguration = .ephemeral, _ make: (URLSession, @escaping @Sendable (Data?, URLResponse?, Error?) -> Void) -> URLSessionTask) {
      let session = URLSession(configuration: configuration)
      let done = DispatchSemaphore(value: 0)
      let task = make(session) { data, _, error in
        finish(name, data, error)
        done.signal()
      }
      task.resume()
      if done.wait(timeout: .now() + 20) == .timedOut { lines.append("[web-apis] probe \(name): timed out") }
      session.finishTasksAndInvalidate()
    }

    send("uploadTask from data") { session, done in session.uploadTask(with: request(), from: bytes, completionHandler: done) }
    send("dataTask httpBody") { session, done in
      var r = request()
      r.httpBody = bytes
      return session.dataTask(with: r, completionHandler: done)
    }
    send("uploadTask from data, Content-Type empty") { session, done in
      var r = request()
      r.setValue("", forHTTPHeaderField: "Content-Type")
      return session.uploadTask(with: r, from: bytes, completionHandler: done)
    }
    send("dataTask httpBody, Content-Type empty") { session, done in
      var r = request()
      r.httpBody = bytes
      r.setValue("", forHTTPHeaderField: "Content-Type")
      return session.dataTask(with: r, completionHandler: done)
    }
    send("uploadTask from file") { session, done in session.uploadTask(with: request(), fromFile: file, completionHandler: done) }
    send("dataTask httpBodyStream, Content-Length") { session, done in
      var r = request()
      r.httpBodyStream = InputStream(data: bytes)
      r.setValue("64", forHTTPHeaderField: "Content-Length")
      return session.dataTask(with: r, completionHandler: done)
    }
    let additional = URLSessionConfiguration.ephemeral
    additional.httpAdditionalHeaders = ["Content-Type": ""]
    send("uploadTask from data, httpAdditionalHeaders Content-Type empty", configuration: additional) { session, done in
      session.uploadTask(with: request(), from: bytes, completionHandler: done)
    }
    send("uploadTask from data, PUT") { session, done in session.uploadTask(with: request("PUT"), from: bytes, completionHandler: done) }
    send("uploadTask from data, Content-Type space") { session, done in
      var r = request()
      r.setValue(" ", forHTTPHeaderField: "Content-Type")
      return session.uploadTask(with: r, from: bytes, completionHandler: done)
    }

    var report = URLRequest(url: URL(string: "http://localhost:8787/report")!)
    report.httpMethod = "POST"
    report.httpBody = Data(lines.joined(separator: "\n").utf8)
    report.setValue("text/plain", forHTTPHeaderField: "Content-Type")
    let sent = DispatchSemaphore(value: 0)
    URLSession.shared.dataTask(with: report) { _, _, _ in sent.signal() }.resume()
    _ = sent.wait(timeout: .now() + 20)
  }
}
