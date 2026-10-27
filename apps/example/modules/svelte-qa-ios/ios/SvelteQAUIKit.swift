import UIKit

/// What the harness asks of UIKit on the device itself, since nothing outside the process can read a view controller or press
/// a button on an iOS device: the state of the controllers the stack, the sheets and the tabs built, and the few user
/// actions an app can perform on itself the way the system would (scroll a scroll view, type into the search field, escape).
enum SvelteQAUIKit {
  /// JSON has no optionals: an absent value is `null` (a Swift optional boxed in `Any` makes `JSONSerialization` raise).
  private static func json(_ value: Any?) -> Any { value ?? NSNull() }

  private static func frame(_ rect: CGRect) -> [Double] {
    [Double(rect.origin.x), Double(rect.origin.y), Double(rect.size.width), Double(rect.size.height)]
  }

  private static func windowFrame(_ view: UIView) -> [Double] {
    guard let window = view.window else { return frame(view.frame) }
    return frame(view.convert(view.bounds, to: window))
  }

  private static func color(_ color: UIColor?) -> String? {
    guard let color else { return nil }
    var r: CGFloat = 0, g: CGFloat = 0, b: CGFloat = 0, a: CGFloat = 0
    guard color.getRed(&r, green: &g, blue: &b, alpha: &a) else { return "pattern" }
    return String(format: "%02x%02x%02x%02x", Int(r * 255 + 0.5), Int(g * 255 + 0.5), Int(b * 255 + 0.5), Int(a * 255 + 0.5))
  }

  private static func appearance(_ appearance: UINavigationBarAppearance?) -> [String: Any]? {
    guard let appearance else { return nil }
    return [
      "backgroundColor": json(color(appearance.backgroundColor)),
      "hasBackgroundEffect": appearance.backgroundEffect != nil,
      "shadowColor": json(color(appearance.shadowColor)),
      "hasShadowImage": appearance.shadowImage != nil,
    ]
  }

  private static func item(_ item: UINavigationItem) -> [String: Any] {
    var out: [String: Any] = [
      "title": json(item.title),
      "largeTitleDisplayMode": item.largeTitleDisplayMode.rawValue,
      "hidesBackButton": item.hidesBackButton,
      "backButtonTitle": json(item.backButtonTitle),
      "leftItems": item.leftBarButtonItems?.count ?? 0,
      "rightItems": item.rightBarButtonItems?.count ?? 0,
      "hasTitleView": item.titleView != nil,
      "hasSearchController": item.searchController != nil,
      "hidesSearchBarWhenScrolling": item.hidesSearchBarWhenScrolling,
    ]
    // `subtitle` exists from iOS 26; read through key-value coding so that the module builds against older SDKs too.
    if item.responds(to: NSSelectorFromString("subtitle")) { out["subtitle"] = json(item.value(forKey: "subtitle")) }
    if let search = item.searchController {
      out["searchActive"] = search.isActive
      out["searchPlaceholder"] = json(search.searchBar.placeholder)
      out["searchText"] = json(search.searchBar.text)
    }
    // Where the slots ended up in the window, and the views of the bar around each (the glass capsule of a bar item is one of them).
    var slots: [[String: Any]] = []
    var customs: [UIView] = ((item.leftBarButtonItems ?? []) + (item.rightBarButtonItems ?? [])).compactMap { $0.customView }
    if let titleView = item.titleView { customs.append(titleView) }
    for view in customs {
      guard view.window != nil else { continue }
      var parents: [[String: Any]] = []
      var current = view.superview
      while let parent = current, !(parent is UINavigationBar), parents.count < 5 {
        parents.append(["class": NSStringFromClass(type(of: parent)), "frame": windowFrame(parent)])
        current = parent.superview
      }
      slots.append(["class": NSStringFromClass(type(of: view)), "frame": windowFrame(view), "content": json(view.subviews.first.map { windowFrame($0) }), "parents": parents])
    }
    if !slots.isEmpty { out["slots"] = slots }
    out["standardAppearance"] = json(appearance(item.standardAppearance))
    out["scrollEdgeAppearance"] = json(appearance(item.scrollEdgeAppearance))
    return out
  }

  private static func detents(_ sheet: UISheetPresentationController) -> [String: Any] {
    var out: [String: Any] = [
      "detents": sheet.detents.map { $0.identifier.rawValue },
      "selected": json(sheet.selectedDetentIdentifier?.rawValue),
      "grabber": sheet.prefersGrabberVisible,
      "scrollingExpands": sheet.prefersScrollingExpandsWhenScrolledToEdge,
      "largestUndimmed": json(sheet.largestUndimmedDetentIdentifier?.rawValue),
      "cornerRadius": json(sheet.preferredCornerRadius),
    ]
    out["presentedViewFrame"] = json(sheet.presentedView.map { windowFrame($0) })
    return out
  }

  /// In a window and not hidden or transparent anywhere above it: what is on screen (a hidden tab pane's controllers are not).
  private static func shown(_ view: UIView) -> Bool {
    guard view.window != nil else { return false }
    var current: UIView? = view
    while let candidate = current {
      if candidate.isHidden || candidate.alpha < 0.01 { return false }
      current = candidate.superview
    }
    return true
  }

  private static func describe(_ controller: UIViewController, depth: Int) -> [String: Any] {
    var out: [String: Any] = [
      "shown": controller.isViewLoaded && shown(controller.view),
      "class": NSStringFromClass(type(of: controller)),
      "title": json(controller.title),
      "viewFrame": controller.isViewLoaded ? windowFrame(controller.view) : [],
      "modalPresentationStyle": controller.modalPresentationStyle.rawValue,
      "modalInPresentation": controller.isModalInPresentation,
      "semanticContentAttribute": controller.isViewLoaded ? controller.view.semanticContentAttribute.rawValue : -1,
      "accessibilityViewIsModal": controller.isViewLoaded ? controller.view.accessibilityViewIsModal : false,
    ]
    if let navigation = controller as? UINavigationController {
      let bar = navigation.navigationBar
      out["navigation"] = [
        "barHidden": navigation.isNavigationBarHidden,
        "prefersLargeTitles": bar.prefersLargeTitles,
        "barFrame": windowFrame(bar),
        "barSemanticContentAttribute": bar.semanticContentAttribute.rawValue,
        "tint": json(color(bar.tintColor)),
        "items": navigation.viewControllers.map { item($0.navigationItem) },
        "topIndex": navigation.viewControllers.count - 1,
        "transitioning": navigation.transitionCoordinator != nil,
      ] as [String: Any]
    }
    if let tabs = controller as? UITabBarController {
      let bar = tabs.tabBar
      out["tabs"] = [
        "selectedIndex": tabs.selectedIndex,
        "barFrame": windowFrame(bar),
        "barSemanticContentAttribute": bar.semanticContentAttribute.rawValue,
        "items": (bar.items ?? []).map { tab in
          [
            "title": json(tab.title),
            "badge": json(tab.badgeValue),
            "hasImage": tab.image != nil,
            "hasSelectedImage": tab.selectedImage != nil,
            "enabled": tab.isEnabled,
            "accessibilityLabel": json(tab.accessibilityLabel),
          ] as [String: Any]
        },
      ] as [String: Any]
    }
    if let sheet = controller.presentationController as? UISheetPresentationController, controller.presentingViewController != nil {
      out["sheet"] = detents(sheet)
    }
    if depth < 8 {
      out["children"] = controller.children.map { describe($0, depth: depth + 1) }
      if let presented = controller.presentedViewController { out["presented"] = describe(presented, depth: depth + 1) }
    }
    return out
  }

  /// The view of a Svelte stack answers `qaState` with what it believes (flags, screens): found by selector, the module has no link to the pod.
  private static func stacks(in view: UIView) -> [[String: Any]] {
    var out: [[String: Any]] = []
    let selector = NSSelectorFromString("qaState")
    if view.responds(to: selector), let state = view.perform(selector)?.takeUnretainedValue() as? [String: Any] { out.append(state) }
    for subview in view.subviews { out += stacks(in: subview) }
    return out
  }

  static func state() throws -> String {
    guard let window = SvelteQA.keyWindow, let root = window.rootViewController else { throw QAError("there is no root view controller") }
    let payload: [String: Any] = [
      "screen": ["width": Double(window.bounds.width), "height": Double(window.bounds.height), "scale": Double(window.screen.scale)],
      "safeArea": [Double(window.safeAreaInsets.top), Double(window.safeAreaInsets.left), Double(window.safeAreaInsets.bottom), Double(window.safeAreaInsets.right)],
      "rtl": window.effectiveUserInterfaceLayoutDirection == .rightToLeft,
      "root": describe(root, depth: 0),
      "stacks": stacks(in: window),
    ]
    let data = try JSONSerialization.data(withJSONObject: payload, options: [.sortedKeys])
    guard let text = String(data: data, encoding: .utf8) else { throw QAError("the controller state is not UTF-8") }
    return text
  }

  /// The topmost controller on screen: the deepest presented one, else the root.
  private static func topController() -> UIViewController? {
    var top = SvelteQA.keyWindow?.rootViewController
    while let presented = top?.presentedViewController { top = presented }
    return top
  }

  private static func scrollViews(in view: UIView, into out: inout [UIScrollView]) {
    if view.isHidden || view.alpha < 0.01 { return }
    if let scroll = view as? UIScrollView, scroll.bounds.width > 100 { out.append(scroll) }
    for subview in view.subviews { scrollViews(in: subview, into: &out) }
  }

  /// Scrolls the first scroll view of the screen on top to `y` points from its rest position, as a finger would have (no animation).
  static func scroll(to y: Double) throws -> [String: Any] {
    guard let view = topController()?.view else { throw QAError("there is no screen on top") }
    var found: [UIScrollView] = []
    scrollViews(in: view, into: &found)
    guard let scroll = found.first else { throw QAError("the screen on top has no scroll view") }
    let rest = -scroll.adjustedContentInset.top
    scroll.setContentOffset(CGPoint(x: scroll.contentOffset.x, y: rest + CGFloat(y)), animated: false)
    scroll.layoutIfNeeded()
    return ["rest": Double(rest), "offset": Double(scroll.contentOffset.y), "adjustedTop": Double(scroll.adjustedContentInset.top)]
  }

  /// Types into the search field of the screen on top: activates the controller and sets the text the way the keyboard would.
  static func search(text: String) throws -> [String: Any] {
    var current: UINavigationController?
    var controller = topController()
    while current == nil, let candidate = controller {
      current = candidate as? UINavigationController ?? candidate.navigationController
      controller = candidate.children.last
    }
    guard let search = current?.topViewController?.navigationItem.searchController else { throw QAError("the screen on top has no search controller") }
    search.isActive = true
    search.searchBar.text = text
    search.searchResultsUpdater?.updateSearchResults(for: search)
    search.searchBar.delegate?.searchBar?(search.searchBar, textDidChange: text)
    return ["active": search.isActive, "text": json(search.searchBar.text)]
  }

  /// Moves the sheet on top to its `index`-th detent, as a drag would, and reports the height it settles at.
  static func selectDetent(index: Int, completion: @escaping ([String: Any]) -> Void) throws {
    guard let top = topController(), let sheet = top.presentationController as? UISheetPresentationController else { throw QAError("the screen on top is not a sheet") }
    guard index >= 0, index < sheet.detents.count else { throw QAError("the sheet has \(sheet.detents.count) detents") }
    sheet.animateChanges { sheet.selectedDetentIdentifier = sheet.detents[index].identifier }
    DispatchQueue.main.asyncAfter(deadline: .now() + 0.8) {
      completion(detents(sheet))
    }
  }

  /// The system's escape gesture (VoiceOver's two-finger Z) on the screen on top: a dismissal by the user, not by the app.
  static func escape() throws -> Bool {
    guard let top = topController() else { throw QAError("there is no screen on top") }
    // The system asks the focused element, then what contains it, up to the view controllers: here the controllers and views of the screen on top, innermost first.
    var chain: [UIViewController] = []
    func collect(_ controller: UIViewController) {
      for child in controller.children { collect(child) }
      chain.append(controller)
    }
    collect(top)
    for controller in chain where controller.view.window != nil || controller === top {
      if controller.view.accessibilityPerformEscape() || controller.accessibilityPerformEscape() { return true }
    }
    return false
  }

  private static func textInputs(in view: UIView, into out: inout [UIView]) {
    if view.isHidden || view.alpha < 0.01 { return }
    if view is UITextField || view is UITextView { out.append(view) }
    for subview in view.subviews { textInputs(in: subview, into: &out) }
  }

  /// Focuses the first text input of the screen on top (the keyboard comes up) and reports where the field is and where the keyboard went.
  static func focusTextInput(completion: @escaping ([String: Any]) -> Void) throws {
    guard let view = topController()?.view else { throw QAError("there is no screen on top") }
    var inputs: [UIView] = []
    textInputs(in: view, into: &inputs)
    guard let field = inputs.first else { throw QAError("the screen on top has no text input") }
    var keyboard: CGRect = .zero
    let token = NotificationCenter.default.addObserver(forName: UIResponder.keyboardDidShowNotification, object: nil, queue: .main) { notification in
      keyboard = (notification.userInfo?[UIResponder.keyboardFrameEndUserInfoKey] as? NSValue)?.cgRectValue ?? .zero
    }
    field.becomeFirstResponder()
    DispatchQueue.main.asyncAfter(deadline: .now() + 1.5) {
      NotificationCenter.default.removeObserver(token)
      let inWindow = field.window.map { field.convert(field.bounds, to: $0) } ?? .zero
      completion([
        "focused": field.isFirstResponder,
        "fieldFrame": frame(inWindow),
        "keyboardFrame": frame(keyboard),
        "overlap": Double(max(0, inWindow.intersection(keyboard).height)),
      ])
    }
  }

  static func blur() {
    SvelteQA.keyWindow?.endEditing(true)
  }
}
