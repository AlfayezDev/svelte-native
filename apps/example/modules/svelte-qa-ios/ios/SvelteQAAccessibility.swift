import UIKit

/// The accessibility elements of the key window, found the way the system finds them for VoiceOver:
/// a hidden view, a view with `accessibilityElementsHidden` or one that is fully transparent contributes nothing; an accessibility
/// element is a leaf (VoiceOver does not look inside it); a view that lists its own `accessibilityElements`, or is an
/// accessibility container, gives that list in that order; any other view passes on its subviews, and a subview with
/// `accessibilityViewIsModal` hides its earlier siblings. The list is in discovery order: where the app does not set an order
/// (`explicit` false) VoiceOver sorts the elements of the screen by position, and the harness does the same.
enum SvelteQAAccessibility {
  private static let traitNames: [(UIAccessibilityTraits, String)] = [
    (.button, "button"), (.link, "link"), (.image, "image"), (.selected, "selected"), (.playsSound, "playsSound"),
    (.keyboardKey, "keyboardKey"), (.staticText, "staticText"), (.summaryElement, "summaryElement"), (.notEnabled, "notEnabled"),
    (.updatesFrequently, "updatesFrequently"), (.searchField, "searchField"), (.startsMediaSession, "startsMediaSession"),
    (.adjustable, "adjustable"), (.allowsDirectInteraction, "allowsDirectInteraction"), (.causesPageTurn, "causesPageTurn"),
    (.header, "header"), (.tabBar, "tabBar"),
  ]

  private struct Walk {
    var elements: [[String: Any]] = []
    var modals: [[String: Any]] = []
    var moving: [[String: Any]] = []
    /// The system's glass chrome (the capsules of iOS 26 bars and tab bars): UIKit draws their edges a little differently from one launch to the next.
    var glass: [[String: Any]] = []
    /// The cards of presented sheets (UIKit's drop shadow views): their rounded rim and shadow vary the same way.
    var sheets: [[String: Any]] = []
    /// One id per container that lists its own elements: the harness keeps a group together in the order the container set.
    var groups = 0
    mutating func newGroup() -> Int { groups += 1; return groups }
  }

  static func dump() throws -> String {
    guard let window = SvelteQA.keyWindow else { throw QAError("there is no key window") }
    var walk = Walk()
    visit(window, explicit: false, group: 0, into: &walk)
    let scale = window.screen.scale
    let payload: [String: Any] = [
      "screen": ["width": Double(window.bounds.width), "height": Double(window.bounds.height), "scale": Double(scale)],
      "rtl": window.effectiveUserInterfaceLayoutDirection == .rightToLeft,
      "elements": walk.elements,
      "modalViews": walk.modals,
      "movingViews": walk.moving,
      "glassViews": walk.glass,
      "sheetViews": walk.sheets,
    ]
    let data = try JSONSerialization.data(withJSONObject: payload, options: [.sortedKeys])
    guard let text = String(data: data, encoding: .utf8) else { throw QAError("the accessibility tree is not UTF-8") }
    return text
  }

  private static func visible(_ view: UIView) -> Bool {
    !view.isHidden && view.alpha > 0.01 && !view.accessibilityElementsHidden
  }

  private static func rect(_ frame: CGRect) -> [Double] {
    [Double(frame.origin.x), Double(frame.origin.y), Double(frame.size.width), Double(frame.size.height)]
  }

  private static func visit(_ object: Any, explicit: Bool, group: Int, container: String? = nil, into walk: inout Walk) {
    if let view = object as? UIView {
      guard visible(view) else { return }
      let name = NSStringFromClass(type(of: view))
      if name.contains("Glass") || name.contains("Platter"), let window = view.window {
        walk.glass.append(["class": name, "frame": rect(view.convert(view.bounds, to: window))])
      }
      if name.contains("DropShadow"), let window = view.window, view.bounds.width < window.bounds.width {
        walk.sheets.append(["class": name, "frame": rect(view.convert(view.bounds, to: window))])
      }
      if view is UIActivityIndicatorView || (view.accessibilityIdentifier ?? "").hasPrefix("qa-mask") {
        if let window = view.window {
          walk.moving.append(["class": NSStringFromClass(type(of: view)), "frame": rect(view.convert(view.bounds, to: window))])
        }
      }
      if view.isAccessibilityElement {
        walk.elements.append(describe(view, explicit: explicit, group: group, container: container))
        return
      }
      if let implicit = implicitElement(view) {
        walk.elements.append(implicit)
        return
      }
      if let listed = view.accessibilityElements {
        let id = walk.newGroup()
        for element in listed { visit(element, explicit: true, group: id, container: NSStringFromClass(type(of: view)), into: &walk) }
        return
      }
      let count = view.accessibilityElementCount()
      if count != NSNotFound && count > 0 {
        let id = walk.newGroup()
        for index in 0..<count {
          if let element = view.accessibilityElement(at: index) {
            visit(element, explicit: true, group: id, container: NSStringFromClass(type(of: view)), into: &walk)
          }
        }
        return
      }
      var subviews = view.subviews
      if let top = subviews.lastIndex(where: { $0.accessibilityViewIsModal && visible($0) }) {
        walk.modals.append(["class": NSStringFromClass(type(of: subviews[top])), "ignoredSiblings": top])
        subviews = Array(subviews[top...])
      }
      for subview in subviews { visit(subview, explicit: explicit, group: group, container: container, into: &walk) }
      return
    }
    guard let element = object as? NSObject else { return }
    if element.isAccessibilityElement {
      walk.elements.append(describe(element, explicit: explicit, group: group, container: container))
    } else if let listed = element.accessibilityElements {
      let id = walk.newGroup()
      for inner in listed { visit(inner, explicit: true, group: id, container: NSStringFromClass(type(of: element)), into: &walk) }
    }
  }

  /// The frame an accessibility service would get, in the window's (the screen's) coordinates. `accessibilityFrame` and
  /// `UIAccessibilityConvertFrameToScreenCoordinates` give an empty origin until such a service runs, so the conversion is done
  /// here: a view by its bounds, an accessibility element by the frame it keeps in its container's space (React Native's text
  /// elements: `frameInContainerSpace`, empty for the whole view) or by the container.
  private static func windowFrame(of element: NSObject) -> CGRect {
    if let view = element as? UIView, let window = view.window { return view.convert(view.bounds, to: window) }
    if let accessible = element as? UIAccessibilityElement, let container = accessible.accessibilityContainer as? UIView, let window = container.window {
      var frame = CGRect.zero
      if accessible.responds(to: NSSelectorFromString("frameInContainerSpace")), let value = accessible.value(forKey: "frameInContainerSpace") as? NSValue {
        frame = value.cgRectValue
      }
      if frame.isEmpty { frame = accessible.accessibilityFrameInContainerSpace }
      if frame.isEmpty { frame = container.bounds }
      return container.convert(frame, to: window)
    }
    return element.accessibilityFrame
  }

  /// UIKit's own input controls are accessibility elements only while an accessibility service runs; the app's windows contain
  /// them either way, so the dump lists them as what they would be.
  private static func implicitElement(_ view: UIView) -> [String: Any]? {
    guard view is UITextField || view is UITextView || view is UISwitch, let window = view.window else { return nil }
    var label = view.accessibilityLabel
    var ancestor: UIView? = view.superview
    var depth = 0
    while (label ?? "").isEmpty, let current = ancestor, depth < 4 {
      label = current.accessibilityLabel
      ancestor = current.superview
      depth += 1
    }
    if (label ?? "").isEmpty { label = (view as? UITextField)?.placeholder }
    var entry: [String: Any] = [
      "class": NSStringFromClass(type(of: view)),
      "traits": view is UISwitch ? ["button"] : [],
      "frame": rect(view.convert(view.bounds, to: window)),
      "explicit": false,
      "group": 0,
      "implicit": true,
    ]
    if let label, !label.isEmpty { entry["label"] = label }
    if let value = (view as? UITextField)?.text ?? (view as? UITextView)?.text, !value.isEmpty { entry["value"] = value }
    if let toggle = view as? UISwitch { entry["value"] = toggle.isOn ? "1" : "0" }
    return entry
  }

  private static func describe(_ element: NSObject, explicit: Bool, group: Int, container: String?) -> [String: Any] {
    let traits = element.accessibilityTraits
    let screenFrame = windowFrame(of: element)
    var entry: [String: Any] = [
      "class": NSStringFromClass(type(of: element)),
      "traits": traitNames.filter { traits.contains($0.0) }.map { $0.1 },
      "frame": rect(screenFrame),
      "explicit": explicit,
      "group": group,
    ]
    if let container { entry["container"] = container }
    if let label = element.accessibilityLabel, !label.isEmpty { entry["label"] = label }
    if let value = element.accessibilityValue, !value.isEmpty { entry["value"] = value }
    if let hint = element.accessibilityHint, !hint.isEmpty { entry["hint"] = hint }
    if let identifier = (element as? UIAccessibilityIdentification)?.accessibilityIdentifier, !identifier.isEmpty {
      entry["identifier"] = identifier
    }
    if let view = element as? UIView {
      entry["text"] = (view as? UILabel)?.text ?? (view as? UITextField)?.text ?? (view as? UITextView)?.text
      var parents: [String] = []
      var ancestor = view.superview
      while let current = ancestor, parents.count < 14 {
        parents.append(NSStringFromClass(type(of: current)))
        ancestor = current.superview
      }
      entry["parents"] = parents
    }
    return entry
  }
}
