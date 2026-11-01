import UIKit

/// A recording of what UIKit's gesture recognizers do while a person (or XCUITest) touches the screen: once per display frame, every recognizer
/// in the app's windows that has a touch down or is not idle gets a row with its state, the number of touches it tracks, its pan translation and
/// the touch's window position, and the context that decides arbitration is sampled beside it (the navigation controllers' depth and transition,
/// the presented sheet's detent and where its view is), and a passive recognizer on each window notes where every touch lands and which view the
/// system hit-tested. The harness (`native-qa gestures --platform ios --trace`) starts it by writing `1` to `Documents/gesture-trace.on` before the
/// launch (the app turns the flag off as it reads it: one launch per request) (an app that XCUITest opens by link takes no launch arguments), or by the launch argument `-SvelteQAGestureTrace YES`; it reads `Documents/gesture-trace.json` after the run and answers questions that need a time line: how
/// long a pan on a pushed screen waits for the edge swipe, and which of a sheet's drag and a handler's pan moves first. It only reads public
/// state, never touches the screen, and exists in the QA bundle only. Sampling per frame is what it costs: runs that judge frame times do not use it.
final class SvelteQAGestureTrace {
  static var shared: SvelteQAGestureTrace?

  /// Whether this launch asked for the recording (the QA bundle and the flag file or the argument).
  static var requested: Bool {
    guard SvelteQA.enabled else { return false }
    if UserDefaults.standard.bool(forKey: "SvelteQAGestureTrace") { return true }
    guard let documents = FileManager.default.urls(for: .documentDirectory, in: .userDomainMask).first else { return false }
    let file = documents.appendingPathComponent("gesture-trace.on")
    let flag = try? String(contentsOf: file, encoding: .utf8)
    guard flag?.trimmingCharacters(in: .whitespacesAndNewlines) == "1" else { return false }
    // One launch only: the recording samples every frame, and a flag that stayed on would sit under the next lab's frame times.
    try? "0".write(to: file, atomically: true, encoding: .utf8)
    return true
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
  private var touches: [[Any]] = []
  /// `[t, id, state, vx, vy]`: what each recognizer's own target-action saw, which the per-frame samples cannot tell apart (ended and cancelled both read as idle by the next frame).
  private var events: [[Any]] = []
  private let startedMs = SvelteQAGestureTrace.wallMs()
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
    // What kind of recognizer it is: a screen edge recognizer fails a touch that starts away from its edge, and a navigation controller's edge follows the layout direction.
    entry["superclass"] = class_getSuperclass(type(of: recognizer)).map { NSStringFromClass($0) } ?? NSNull()
    if let edge = recognizer as? UIScreenEdgePanGestureRecognizer { entry["edges"] = edge.edges.rawValue }
    if let view = recognizer.view {
      entry["direction"] = UIView.userInterfaceLayoutDirection(for: view.semanticContentAttribute) == .rightToLeft ? "rtl" : "ltr"
      entry["windowWidth"] = view.window.map { $0.bounds.width } ?? NSNull()
    }
    if let handler = recognizer.delegate as? NSObject, NSStringFromClass(type(of: handler)).hasPrefix("RN"), handler.responds(to: NSSelectorFromString("tag")) {
      entry["handlerTag"] = handler.value(forKey: "tag") ?? NSNull()
    }
    if let view = recognizer.view, view.window != nil {
      let frame = view.convert(view.bounds, to: nil)
      entry["frame"] = [frame.minX, frame.minY, frame.width, frame.height].map { ($0 * 10).rounded() / 10 }
    }
    meta.append(entry)
    // A target of our own sees every state change the recognizer makes, ended and cancelled included, with the pan's velocity at that moment.
    recognizer.addTarget(self, action: #selector(recognizerChanged(_:)))
    return number
  }

  /// A recognizer that fails every touch it sees and prevents nothing: it only reports where touches land and what the system hit-tested.
  private final class TouchProbe: UIGestureRecognizer {
    var report: ((String, UITouch) -> Void)?

    override init(target: Any?, action: Selector?) {
      super.init(target: target, action: action)
      cancelsTouchesInView = false
      delaysTouchesBegan = false
      delaysTouchesEnded = false
    }

    override func canBePrevented(by preventingGestureRecognizer: UIGestureRecognizer) -> Bool { false }
    override func canPrevent(_ preventedGestureRecognizer: UIGestureRecognizer) -> Bool { false }
    override func shouldRequireFailure(of otherGestureRecognizer: UIGestureRecognizer) -> Bool { false }
    override func shouldBeRequiredToFail(by otherGestureRecognizer: UIGestureRecognizer) -> Bool { false }

    override func touchesBegan(_ touches: Set<UITouch>, with event: UIEvent) { for touch in touches { report?("began", touch) } }
    override func touchesMoved(_ touches: Set<UITouch>, with event: UIEvent) { for touch in touches { report?("moved", touch) } }
    override func touchesEnded(_ touches: Set<UITouch>, with event: UIEvent) {
      for touch in touches { report?("ended", touch) }
      state = .failed
    }
    override func touchesCancelled(_ touches: Set<UITouch>, with event: UIEvent) {
      for touch in touches { report?("cancelled", touch) }
      state = .failed
    }
  }

  private func probe(_ window: UIWindow) {
    if window.gestureRecognizers?.contains(where: { $0 is TouchProbe }) == true { return }
    let probe = TouchProbe(target: nil, action: nil)
    probe.report = { [weak self] phase, touch in self?.noteTouch(phase, touch) }
    window.addGestureRecognizer(probe)
  }

  private func noteTouch(_ phase: String, _ touch: UITouch) {
    guard touches.count < maxRows else { return }
    let location = touch.location(in: nil)
    var hit = "-"
    if let view = touch.view {
      var parts: [String] = []
      var current: UIView? = view
      // The hit view and the first ancestors that carry an identifier (React Native's testID) or are a component view.
      while let item = current, parts.count < 4 {
        let name = NSStringFromClass(type(of: item))
        let identifier = item.accessibilityIdentifier ?? ""
        parts.append(identifier.isEmpty ? name : "\(name)#\(identifier)")
        current = item.superview
      }
      hit = parts.joined(separator: " < ")
      // Where the hit view is and whether it takes touches: a view that covers the screen shows here.
      if view.window != nil {
        let frame = view.convert(view.bounds, to: nil)
        hit += " @\([frame.minX, frame.minY, frame.width, frame.height].map { Int($0.rounded()) }) interaction=\(view.isUserInteractionEnabled) alpha=\(view.alpha) hidden=\(view.isHidden)"
      }
    }
    touches.append([Self.wallMs(), phase, (location.x * 10).rounded() / 10, (location.y * 10).rounded() / 10, hit])
    dirty = true
  }

  @objc private func recognizerChanged(_ recognizer: UIGestureRecognizer) {
    guard let number = ids[ObjectIdentifier(recognizer)], events.count < maxRows else { return }
    var row: [Any] = [Self.wallMs(), number, Self.stateNumber(recognizer.state)]
    if let pan = recognizer as? UIPanGestureRecognizer, let view = pan.view {
      let velocity = pan.velocity(in: view)
      row += [(velocity.x * 10).rounded() / 10, (velocity.y * 10).rounded() / 10]
    }
    events.append(row)
    dirty = true
  }

  @objc private func tick(_ link: CADisplayLink) {
    let now = Self.wallMs()
    var anyTouch = false
    var windows: [UIWindow] = []
    for scene in UIApplication.shared.connectedScenes { windows += (scene as? UIWindowScene)?.windows ?? [] }
    for window in windows { probe(window) }
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
    // The transition UIKit runs (a pop under the finger, or its cancel): how far it is, whether the finger drives it, and the speed it finishes at.
    func transition(_ navigation: UINavigationController) -> [String: Any] {
      var out: [String: Any] = ["depth": navigation.viewControllers.count, "transitioning": navigation.transitionCoordinator != nil]
      if let coordinator = navigation.transitionCoordinator {
        out["interactive"] = coordinator.isInteractive
        out["cancelled"] = coordinator.isCancelled
        out["percent"] = (coordinator.percentComplete * 1000).rounded() / 1000
        out["velocity"] = (coordinator.completionVelocity * 1000).rounded() / 1000
      }
      return out
    }
    var entry: [String: Any] = [
      "navigation": navigations.map { transition($0) },
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
    let payload: [String: Any] = ["startedMs": startedMs, "meta": meta, "rows": rows, "context": context, "touches": touches, "events": events, "columns": ["t", "id", "state", "touches", "tx", "ty", "x", "y"]]
    guard let documents = FileManager.default.urls(for: .documentDirectory, in: .userDomainMask).first else { return }
    writer.async {
      guard let data = try? JSONSerialization.data(withJSONObject: payload, options: [.sortedKeys]) else { return }
      try? data.write(to: documents.appendingPathComponent("gesture-trace.json"), options: .atomic)
    }
  }
}
