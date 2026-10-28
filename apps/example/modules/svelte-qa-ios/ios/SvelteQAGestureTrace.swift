import UIKit

/// A recording of what UIKit's gesture recognizers do while a person (or XCUITest) touches the screen: once per display frame, every recognizer
/// in the app's windows that has a touch down or is not idle gets a row with its state, the number of touches it tracks, its pan translation and
/// the touch's window position, and the context that decides arbitration is sampled beside it (the navigation controllers' depth and transition,
/// the presented sheet's detent and where its view is). The harness (`native-qa gestures --platform ios --trace`) starts it with the launch
/// argument `-SvelteQAGestureTrace YES`, reads `Documents/gesture-trace.json` after the run and answers questions that need a time line: how
/// long a pan on a pushed screen waits for the edge swipe, and which of a sheet's drag and a handler's pan moves first. It only reads public
/// state, never touches the screen, and exists in the QA bundle only. Sampling per frame is what it costs: runs that judge frame times do not use it.
final class SvelteQAGestureTrace {
  static var shared: SvelteQAGestureTrace?

  /// Whether this launch asked for the recording (the QA bundle and the argument).
  static var requested: Bool {
    SvelteQA.enabled && UserDefaults.standard.bool(forKey: "SvelteQAGestureTrace")
  }

  static func startIfRequested() {
    guard requested, shared == nil else { return }
    let trace = SvelteQAGestureTrace()
    shared = trace
    DispatchQueue.main.async { trace.start() }
  }

  private struct Seen {
    var state: Int
    var touches: Int
  }

  private var link: CADisplayLink?
  private var ids: [ObjectIdentifier: Int] = [:]
  private var seen: [Int: Seen] = [:]
  private var meta: [[String: Any]] = []
  private var rows: [[Any]] = []
  private var context: [[Any]] = []
  private var lastContext: String = ""
  private var dirty = false
  private var lastWrite = CACurrentMediaTime()
  private let maxRows = 60_000
  private let writer = DispatchQueue(label: "SvelteQAGestureTrace.writer", qos: .utility)

  private func start() {
    let link = CADisplayLink(target: self, selector: #selector(tick(_:)))
    link.add(to: .main, forMode: .common)
    self.link = link
    NSLog("[SvelteQA] gesture trace on")
    flush()
  }

  private static func wallMs() -> Double { (Date().timeIntervalSince1970 * 1000 * 10).rounded() / 10 }

  private static func stateNumber(_ state: UIGestureRecognizer.State) -> Int { state.rawValue }

  private func id(of recognizer: UIGestureRecognizer) -> Int {
    let key = ObjectIdentifier(recognizer)
    if let known = ids[key] { return known }
    let number = ids.count
    ids[key] = number
    var entry: [String: Any] = [
      "id": number,
      "class": NSStringFromClass(type(of: recognizer)),
      "delegate": recognizer.delegate.map { NSStringFromClass(type(of: $0 as AnyObject)) } ?? NSNull(),
      "view": recognizer.view.map { NSStringFromClass(type(of: $0)) } ?? NSNull(),
    ]
    if let handler = recognizer.delegate as? NSObject, NSStringFromClass(type(of: handler)).hasPrefix("RN"), handler.responds(to: NSSelectorFromString("tag")) {
      entry["handlerTag"] = handler.value(forKey: "tag") ?? NSNull()
    }
    if let view = recognizer.view, view.window != nil {
      let frame = view.convert(view.bounds, to: nil)
      entry["frame"] = [frame.minX, frame.minY, frame.width, frame.height].map { ($0 * 10).rounded() / 10 }
    }
    meta.append(entry)
    return number
  }

  @objc private func tick(_ link: CADisplayLink) {
    let now = Self.wallMs()
    var anyTouch = false
    var windows: [UIWindow] = []
    for scene in UIApplication.shared.connectedScenes { windows += (scene as? UIWindowScene)?.windows ?? [] }
    for window in windows { sample(view: window, at: now, touching: &anyTouch) }
    sampleContext(windows: windows, at: now, touching: anyTouch)
    if dirty, CACurrentMediaTime() - lastWrite > 0.4 { flush() }
  }

  private func sample(view: UIView, at now: Double, touching: inout Bool) {
    if let recognizers = view.gestureRecognizers {
      for recognizer in recognizers {
        let touches = recognizer.numberOfTouches
        let state = Self.stateNumber(recognizer.state)
        if touches > 0 { touching = true }
        let key = ObjectIdentifier(recognizer)
        let known = ids[key].flatMap { seen[$0] }
        let active = touches > 0 || (state != 0 && state != 5)
        // An idle recognizer that was idle before leaves no row; every change of one that moves, and every frame of one that is busy, does.
        if !active, let known, known.state == state, known.touches == touches { continue }
        if !active, known == nil { continue }
        guard rows.count < maxRows else { return }
        let number = id(of: recognizer)
        seen[number] = Seen(state: state, touches: touches)
        var row: [Any] = [now, number, state, touches]
        if let pan = recognizer as? UIPanGestureRecognizer, let panView = pan.view {
          let translation = pan.translation(in: panView)
          row += [translation.x, translation.y].map { ($0 * 10).rounded() / 10 }
        } else {
          row += [NSNull(), NSNull()]
        }
        if touches > 0 {
          let location = recognizer.location(in: nil)
          row += [location.x, location.y].map { ($0 * 10).rounded() / 10 }
        }
        rows.append(row)
        dirty = true
      }
    }
    for subview in view.subviews { sample(view: subview, at: now, touching: &touching) }
  }

  private func navigationControllers(from controller: UIViewController?, into found: inout [UINavigationController]) {
    guard let controller else { return }
    if let navigation = controller as? UINavigationController { found.append(navigation) }
    for child in controller.children { navigationControllers(from: child, into: &found) }
    navigationControllers(from: controller.presentedViewController, into: &found)
  }

  private func sampleContext(windows: [UIWindow], at now: Double, touching: Bool) {
    var navigations: [UINavigationController] = []
    var sheet: UISheetPresentationController?
    for window in windows {
      navigationControllers(from: window.rootViewController, into: &navigations)
      var presented = window.rootViewController?.presentedViewController
      while let next = presented?.presentedViewController { presented = next }
      if let candidate = presented?.presentationController as? UISheetPresentationController { sheet = candidate }
    }
    var entry: [String: Any] = [
      "navigation": navigations.map { ["depth": $0.viewControllers.count, "transitioning": $0.transitionCoordinator != nil] as [String: Any] },
    ]
    if let sheet {
      var info: [String: Any] = ["detent": sheet.selectedDetentIdentifier?.rawValue ?? NSNull()]
      if let view = sheet.presentedView, view.window != nil {
        let origin = view.convert(CGPoint.zero, to: nil)
        info["y"] = (origin.y * 10).rounded() / 10
        if let presentation = view.layer.presentation(), let root = view.window?.layer {
          info["visualY"] = (presentation.convert(CGPoint.zero, to: root).y * 10).rounded() / 10
        }
      }
      entry["sheet"] = info
    }
    guard let data = try? JSONSerialization.data(withJSONObject: entry, options: [.sortedKeys]), let text = String(data: data, encoding: .utf8) else { return }
    // A row when the context changed, and every frame of a touch (the sheet moves under the finger).
    guard touching || text != lastContext, context.count < maxRows else { return }
    lastContext = text
    context.append([now, text])
    dirty = true
  }

  private func flush() {
    dirty = false
    lastWrite = CACurrentMediaTime()
    let payload: [String: Any] = ["meta": meta, "rows": rows, "context": context, "columns": ["t", "id", "state", "touches", "tx", "ty", "x", "y"]]
    guard let documents = FileManager.default.urls(for: .documentDirectory, in: .userDomainMask).first else { return }
    writer.async {
      guard let data = try? JSONSerialization.data(withJSONObject: payload, options: [.sortedKeys]) else { return }
      try? data.write(to: documents.appendingPathComponent("gesture-trace.json"), options: .atomic)
    }
  }
}
