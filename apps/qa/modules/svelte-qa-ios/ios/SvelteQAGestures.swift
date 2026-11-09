import UIKit

/// What the gesture probes ask of UIKit (`apps/qa/src/lib/native/dev/probe.ts`, `gestures-*`): the gesture recognizers on the view that has a
/// React Native tag and on every view above it up to the window, so that the harness can see whether react-native-gesture-handler's handler is bound to
/// the view and its root recognizer sits on the view that holds React Native's touch handler (the surface, or a presented screen), and how the
/// navigation controller's edge swipe and a sheet's own recognizers relate to them. Nothing here touches the screen.
enum SvelteQAGestures {
  /// JSON has no optionals: an absent value is `null`.
  private static func json(_ value: Any?) -> Any { value ?? NSNull() }

  private static func className(_ object: AnyObject?) -> Any {
    guard let object else { return NSNull() }
    return NSStringFromClass(type(of: object))
  }

  private static func stateName(_ state: UIGestureRecognizer.State) -> String {
    switch state {
    case .possible: return "possible"
    case .began: return "began"
    case .changed: return "changed"
    case .ended: return "ended"
    case .cancelled: return "cancelled"
    case .failed: return "failed"
    @unknown default: return "unknown"
    }
  }

  /// The delegate of a handler library recognizer is the library's handler (its class name starts with `RN`).
  private static func handlerDelegate(_ recognizer: UIGestureRecognizer) -> NSObject? {
    guard let delegate = recognizer.delegate as? NSObject, NSStringFromClass(type(of: delegate)).hasPrefix("RN") else { return nil }
    return delegate
  }

  private static func describe(_ recognizer: UIGestureRecognizer) -> [String: Any] {
    var out: [String: Any] = [
      "class": NSStringFromClass(type(of: recognizer)),
      "state": stateName(recognizer.state),
      "enabled": recognizer.isEnabled,
      "delegate": className(recognizer.delegate as? NSObject),
      "view": className(recognizer.view),
    ]
    // The handler's `tag` is the number JavaScript gave it.
    if let handler = handlerDelegate(recognizer), handler.responds(to: NSSelectorFromString("tag")) { out["handlerTag"] = json(handler.value(forKey: "tag")) }
    return out
  }

  private static func isReactComponent(_ view: UIView) -> Bool {
    view.responds(to: NSSelectorFromString("mountChildComponentView:index:"))
  }

  private static func find(tag: Int, in view: UIView) -> UIView? {
    if view.tag == tag, isReactComponent(view) { return view }
    for subview in view.subviews {
      if let found = find(tag: tag, in: subview) { return found }
    }
    return nil
  }

  private static func holds(_ view: UIView, _ fragment: String) -> Bool {
    (view.gestureRecognizers ?? []).contains { NSStringFromClass(type(of: $0)).contains(fragment) }
  }

  private static func controller(of view: UIView) -> UIViewController? {
    var responder: UIResponder? = view.next
    while let current = responder {
      if let controller = current as? UIViewController { return controller }
      responder = current.next
    }
    return nil
  }

  private static func rootRecognizer(on view: UIView?) -> Any {
    guard let view, let root = view.gestureRecognizers?.first(where: { NSStringFromClass(type(of: $0)) == "RNRootViewGestureRecognizer" }) else { return NSNull() }
    var out = describe(root)
    out["onView"] = NSStringFromClass(type(of: view))
    return out
  }

  private static func viewInfo(_ view: UIView?) -> Any {
    guard let view else { return NSNull() }
    return ["class": NSStringFromClass(type(of: view)), "tag": view.tag] as [String: Any]
  }

  /// What the edge swipe's delegate answers about a plain pan recognizer and about the handler library's pans: whether each has to wait for the swipe to fail.
  private static func popGesture(from view: UIView, pans: [UIGestureRecognizer]) -> Any {
    guard let navigation = controller(of: view)?.navigationController, let pop = navigation.interactivePopGestureRecognizer else { return NSNull() }
    var out: [String: Any] = [
      "enabled": pop.isEnabled,
      "state": stateName(pop.state),
      "delegate": className(pop.delegate as? NSObject),
      "class": NSStringFromClass(type(of: pop)),
      "viewControllers": navigation.viewControllers.count,
      "transitioning": navigation.transitionCoordinator != nil,
    ]
    if let delegate = pop.delegate {
      func waits(_ other: UIGestureRecognizer) -> Any {
        guard let answer = delegate.gestureRecognizer?(pop, shouldBeRequiredToFailBy: other) else { return NSNull() }
        return answer
      }
      out["plainPanWaits"] = waits(UIPanGestureRecognizer())
      out["handlerPansWait"] = pans.map { ["class": NSStringFromClass(type(of: $0)), "waits": waits($0)] as [String: Any] }
      out["shouldBegin"] = json(delegate.gestureRecognizerShouldBegin?(pop))
    }
    return out
  }

  static func recognizers(tag: Int) throws -> String {
    var found: UIView?
    for scene in UIApplication.shared.connectedScenes {
      for window in (scene as? UIWindowScene)?.windows ?? [] where found == nil { found = find(tag: tag, in: window) }
    }
    guard let view = found else { return try serialize(["tag": tag, "found": false]) }
    var out: [String: Any] = ["tag": tag, "found": true, "viewClass": NSStringFromClass(type(of: view))]
    var own: [UIGestureRecognizer] = view.gestureRecognizers ?? []
    out["recognizers"] = own.map(describe)
    // React Native's view with a content view: the handler library binds to the content view.
    if view.responds(to: NSSelectorFromString("contentView")), let content = view.value(forKey: "contentView") as? UIView {
      let held = content.gestureRecognizers ?? []
      own += held
      out["contentViewClass"] = NSStringFromClass(type(of: content))
      out["contentRecognizers"] = held.map(describe)
    }
    let owner = controller(of: view)
    out["controller"] = className(owner)
    out["presented"] = owner?.presentingViewController != nil
    out["inWindow"] = view.window != nil
    // Every view above, with the recognizers it holds: the touch handler's host, the surface, the sheet's own.
    var ancestors: [[String: Any]] = []
    var host: UIView?
    var surface: UIView?
    var current = view.superview
    while let ancestor = current {
      let held = ancestor.gestureRecognizers ?? []
      if host == nil, holds(ancestor, "RCTSurfaceTouchHandler") { host = ancestor }
      if surface == nil, NSStringFromClass(type(of: ancestor)) == "RCTSurfaceView" { surface = ancestor }
      if !held.isEmpty { ancestors.append(["class": NSStringFromClass(type(of: ancestor)), "tag": ancestor.tag, "recognizers": held.map(describe)]) }
      current = ancestor.superview
    }
    out["ancestors"] = ancestors
    out["touchHost"] = viewInfo(host)
    out["touchHostRoot"] = rootRecognizer(on: host)
    out["surfaceRoot"] = rootRecognizer(on: surface)
    out["pop"] = popGesture(from: view, pans: own.filter { $0 is UIPanGestureRecognizer && handlerDelegate($0) != nil })
    if let sheet = owner?.presentationController as? UISheetPresentationController, owner?.presentingViewController != nil {
      out["sheet"] = [
        "selected": json(sheet.selectedDetentIdentifier?.rawValue),
        "presentedView": className(sheet.presentedView),
        "containerView": className(sheet.containerView),
        "containerRecognizers": (sheet.containerView?.gestureRecognizers ?? []).map(describe),
        "presentedViewRecognizers": (sheet.presentedView?.gestureRecognizers ?? []).map(describe),
      ] as [String: Any]
    }
    return try serialize(out)
  }

  private static func serialize(_ payload: [String: Any]) throws -> String {
    let data = try JSONSerialization.data(withJSONObject: payload, options: [.sortedKeys])
    guard let text = String(data: data, encoding: .utf8) else { throw QAError("the recognizers are not UTF-8") }
    return text
  }
}
