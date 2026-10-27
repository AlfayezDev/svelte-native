import CryptoKit
import ExpoModulesCore
import UIKit

struct QAError: Error, CustomStringConvertible {
  let description: String
  init(_ description: String) { self.description = description }
}

/// What the lab app can ask of itself on iOS, where nothing outside the process can take its screenshot or read its accessibility
/// tree (`apps/platform/qa`, "iOS"): the pixels of its window, the elements VoiceOver walks, and the launch times. Every function but
/// the boot recorder refuses to run outside the QA bundle, so the module that ships in a production build does nothing there.
public final class SvelteQAModule: Module {
  public func definition() -> ModuleDefinition {
    Name("SvelteQA")

    Constant("enabled") { SvelteQA.enabled }

    // The `[Svelte boot]` phases of the launch, kept with the native times; the report file is written when both are complete.
    Function("recordBoot") { (summary: String, jsErrors: Int) in
      SvelteQA.boot?.recordJavaScript(summary, jsErrors: jsErrors)
    }

    // What is installed, for the harness to compare with its build record: the SHA-256 of `main.jsbundle` and the executable's
    // code directory hash (what `codesign -dvvv` prints as CDHash: the signature identifies the binary without hashing 30 MB).
    AsyncFunction("buildIdentity") { () -> [String: String] in
      try SvelteQA.requireEnabled()
      return try SvelteQA.buildIdentity()
    }

    // The app's own window as a PNG at the screen's scale (no status bar: that is another process's), written to `path`.
    AsyncFunction("capture") { (path: String) -> [String: Any] in
      try SvelteQA.requireEnabled()
      return try SvelteQA.capture(to: path)
    }.runOnQueue(.main)

    // Forces the interface style of the app's windows, so that the native chrome (bars, sheets) follows the theme the lab shows.
    AsyncFunction("setInterfaceStyle") { (style: String) in
      try SvelteQA.requireEnabled()
      let value: UIUserInterfaceStyle = style == "dark" ? .dark : style == "light" ? .light : .unspecified
      for scene in UIApplication.shared.connectedScenes {
        for window in (scene as? UIWindowScene)?.windows ?? [] { window.overrideUserInterfaceStyle = value }
      }
    }.runOnQueue(.main)

    // The view controllers the stack, the sheets and the tabs built, as JSON text (navigation bars, items, detents, tab items).
    AsyncFunction("uikitState") { () -> String in
      try SvelteQA.requireEnabled()
      return try SvelteQAUIKit.state()
    }.runOnQueue(.main)

    // Actions a user would perform, performed by the app on itself (no process outside can touch the phone's screen).
    AsyncFunction("scrollTo") { (y: Double) -> [String: Any] in
      try SvelteQA.requireEnabled()
      return try SvelteQAUIKit.scroll(to: y)
    }.runOnQueue(.main)

    AsyncFunction("typeSearch") { (text: String) -> [String: Any] in
      try SvelteQA.requireEnabled()
      return try SvelteQAUIKit.search(text: text)
    }.runOnQueue(.main)

    AsyncFunction("selectDetent") { (index: Int, promise: Promise) in
      do {
        try SvelteQA.requireEnabled()
        try SvelteQAUIKit.selectDetent(index: index) { promise.resolve($0) }
      } catch {
        promise.reject("ERR_SVELTE_QA", String(describing: error))
      }
    }.runOnQueue(.main)

    AsyncFunction("escape") { () -> Bool in
      try SvelteQA.requireEnabled()
      return try SvelteQAUIKit.escape()
    }.runOnQueue(.main)

    AsyncFunction("focusTextInput") { (promise: Promise) in
      do {
        try SvelteQA.requireEnabled()
        try SvelteQAUIKit.focusTextInput { promise.resolve($0) }
      } catch {
        promise.reject("ERR_SVELTE_QA", String(describing: error))
      }
    }.runOnQueue(.main)

    AsyncFunction("blur") { () in
      try SvelteQA.requireEnabled()
      SvelteQAUIKit.blur()
    }.runOnQueue(.main)

    // The accessibility elements of the key window as VoiceOver finds them (JSON text).
    AsyncFunction("accessibilityTree") { () -> String in
      try SvelteQA.requireEnabled()
      return try SvelteQAAccessibility.dump()
    }.runOnQueue(.main)
  }
}

enum SvelteQA {
  static let bundleIdentifier = "io.rasheed.svelteqa"
  static var enabled: Bool { Bundle.main.bundleIdentifier == bundleIdentifier }
  static var boot: BootRecorder?

  static func requireEnabled() throws {
    guard enabled else { throw QAError("SvelteQA only runs in the QA app (\(bundleIdentifier))") }
  }

  static var keyWindow: UIWindow? {
    UIApplication.shared.connectedScenes
      .compactMap { $0 as? UIWindowScene }
      .flatMap { $0.windows }
      .first { $0.isKeyWindow }
  }

  private static var identity: [String: String]?

  /// Computed once per process, on first use (after the boot report's times are taken, never before).
  static func buildIdentity() throws -> [String: String] {
    if let identity { return identity }
    guard let bundle = Bundle.main.url(forResource: "main", withExtension: "jsbundle") else { throw QAError("the app has no main.jsbundle") }
    guard let executable = Bundle.main.executableURL else { throw QAError("the app has no executable") }
    let computed = [
      "jsbundleSha256": hex(SHA256.hash(data: try Data(contentsOf: bundle, options: .mappedIfSafe))),
      "cdHash": try codeDirectoryHash(of: executable),
    ]
    identity = computed
    return computed
  }

  private static func hex<D: Sequence>(_ digest: D) -> String where D.Element == UInt8 {
    digest.map { String(format: "%02x", $0) }.joined()
  }

  /// The CDHash of a thin arm64 Mach-O: the SHA-256 of its SHA-256 code directory (the primary one when there is no other),
  /// truncated to 20 bytes, read from `LC_CODE_SIGNATURE` alone. `codesign -dvvv` prints the same value as `CDHash=`.
  private static func codeDirectoryHash(of url: URL) throws -> String {
    let handle = try FileHandle(forReadingFrom: url)
    defer { try? handle.close() }
    func read(_ offset: UInt64, _ count: Int) throws -> Data {
      try handle.seek(toOffset: offset)
      guard let data = try handle.read(upToCount: count), data.count == count else { throw QAError("the executable is shorter than its headers say") }
      return data
    }
    func u32(_ data: Data, _ at: Int, bigEndian: Bool) -> UInt32 {
      let value = data.withUnsafeBytes { $0.loadUnaligned(fromByteOffset: at, as: UInt32.self) }
      return bigEndian ? UInt32(bigEndian: value) : UInt32(littleEndian: value)
    }
    let header = try read(0, 32)
    guard u32(header, 0, bigEndian: false) == 0xfeedfacf else { throw QAError("the executable is not a thin 64-bit Mach-O") }
    let commandCount = Int(u32(header, 16, bigEndian: false))
    let commandsSize = Int(u32(header, 20, bigEndian: false))
    let commands = try read(32, commandsSize)
    var offset = 0
    var signature: (offset: UInt64, size: Int)?
    for _ in 0..<commandCount {
      let command = u32(commands, offset, bigEndian: false)
      let size = Int(u32(commands, offset + 4, bigEndian: false))
      if command == 0x1d { signature = (UInt64(u32(commands, offset + 8, bigEndian: false)), Int(u32(commands, offset + 12, bigEndian: false))) }
      offset += size
    }
    guard let signature else { throw QAError("the executable has no code signature") }
    let blob = try read(signature.offset, signature.size)
    guard u32(blob, 0, bigEndian: true) == 0xfade0cc0 else { throw QAError("the code signature is not a SuperBlob") }
    var chosen: Data?
    for index in 0..<Int(u32(blob, 8, bigEndian: true)) {
      let at = Int(u32(blob, 12 + index * 8 + 4, bigEndian: true))
      guard at + 40 <= blob.count, u32(blob, at, bigEndian: true) == 0xfade0c02 else { continue }
      let length = Int(u32(blob, at + 4, bigEndian: true))
      guard at + length <= blob.count else { continue }
      let directory = blob.subdata(in: at..<(at + length))
      let hashType = directory[37]
      if chosen == nil || hashType == 2 { chosen = directory }
      if hashType == 2 { break }
    }
    guard let chosen else { throw QAError("the code signature has no code directory") }
    return hex(SHA256.hash(data: chosen).prefix(20))
  }

  static func capture(to path: String) throws -> [String: Any] {
    guard let window = keyWindow else { throw QAError("there is no key window") }
    let format = UIGraphicsImageRendererFormat()
    format.scale = window.screen.scale
    format.opaque = true
    let renderer = UIGraphicsImageRenderer(bounds: window.bounds, format: format)
    var drawn = false
    let image = renderer.image { _ in
      drawn = window.drawHierarchy(in: window.bounds, afterScreenUpdates: true)
    }
    guard drawn, let data = image.pngData() else { throw QAError("the window could not be drawn") }
    try data.write(to: URL(fileURLWithPath: path), options: .atomic)
    let digest = SHA256.hash(data: data).map { String(format: "%02x", $0) }.joined()
    return [
      "width": Int((image.size.width * image.scale).rounded()),
      "height": Int((image.size.height * image.scale).rounded()),
      "scale": Double(image.scale),
      "bytes": data.count,
      "sha256": digest,
    ]
  }
}

/// Launch to first frame. The process start is the kernel's (`p_starttime`); the first frame is the display link tick after React
/// Native mounted the first content (`RCTContentDidAppearNotification`), its `targetTimestamp` being the vsync the frame is shown at.
final class BootRecorder {
  private let pid = getpid()
  private let processStartMs: Double
  private let launchedMs: Double
  private var contentAppearedMs: Double?
  private var displayedMs: Double?
  private var javaScript: String?
  private var jsErrors = 0
  private var link: CADisplayLink?
  private var written = false

  init() {
    processStartMs = BootRecorder.kernelProcessStartMs()
    launchedMs = BootRecorder.nowMs()
    NotificationCenter.default.addObserver(
      self, selector: #selector(contentAppeared), name: Notification.Name("RCTContentDidAppearNotification"), object: nil)
  }

  static func nowMs() -> Double { Date().timeIntervalSince1970 * 1000 }

  static func kernelProcessStartMs() -> Double {
    var info = kinfo_proc()
    var size = MemoryLayout<kinfo_proc>.stride
    var mib: [Int32] = [CTL_KERN, KERN_PROC, KERN_PROC_PID, getpid()]
    guard sysctl(&mib, UInt32(mib.count), &info, &size, nil, 0) == 0 else { return 0 }
    let start = info.kp_proc.p_un.__p_starttime
    return Double(start.tv_sec) * 1000 + Double(start.tv_usec) / 1000
  }

  @objc private func contentAppeared() {
    guard contentAppearedMs == nil else { return }
    contentAppearedMs = BootRecorder.nowMs()
    let link = CADisplayLink(target: self, selector: #selector(tick(_:)))
    link.add(to: .main, forMode: .common)
    self.link = link
  }

  @objc private func tick(_ link: CADisplayLink) {
    displayedMs = BootRecorder.nowMs() + (link.targetTimestamp - CACurrentMediaTime()) * 1000
    link.invalidate()
    self.link = nil
    writeIfComplete()
  }

  func recordJavaScript(_ summary: String, jsErrors: Int) {
    DispatchQueue.main.async {
      self.javaScript = summary
      self.jsErrors = jsErrors
      self.writeIfComplete()
    }
  }

  private func writeIfComplete() {
    guard !written, let displayed = displayedMs, let content = contentAppearedMs, let summary = javaScript else { return }
    written = true
    var report: [String: Any] = [
      "pid": Int(pid),
      "processStartMs": processStartMs,
      "launchedMs": launchedMs,
      "contentAppearedMs": content,
      "displayedMs": displayed,
      "javaScript": summary,
      "jsErrors": jsErrors,
      "osVersion": UIDevice.current.systemVersion,
    ]
    guard let documents = FileManager.default.urls(for: .documentDirectory, in: .userDomainMask).first else {
      NSLog("[SvelteQA] the boot report has no Documents directory to go to")
      return
    }
    // The times are all taken; hashing the installed files for the report's build identity happens off the main thread.
    DispatchQueue.global(qos: .utility).async {
      do {
        report["build"] = try SvelteQA.buildIdentity()
        let data = try JSONSerialization.data(withJSONObject: report, options: [.sortedKeys])
        try data.write(to: documents.appendingPathComponent("boot-report.json"), options: .atomic)
      } catch {
        NSLog("[SvelteQA] the boot report could not be written: %@", String(describing: error))
      }
    }
  }
}

/// Starts the boot recorder when the process launches, before the JavaScript host exists (the QA bundle only).
public final class SvelteQABootSubscriber: ExpoAppDelegateSubscriber {
  public func application(_ application: UIApplication, didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey: Any]? = nil) -> Bool {
    if SvelteQA.enabled { SvelteQA.boot = BootRecorder() }
    return true
  }
}
