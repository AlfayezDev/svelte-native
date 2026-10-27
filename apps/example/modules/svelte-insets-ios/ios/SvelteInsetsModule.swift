import ExpoModulesCore
import UIKit

/// Safe area and keyboard insets of the app's window, in the payload the Android engine sends (`apps/platform/modules/svelte-engine/SPEC.md`,
/// "Insets and keyboard"), points standing for dp: `{ top, right, bottom, left, keyboardHeight, keyboardVisible, frame }`.
/// `keyboardHeight` is how much of the window the keyboard covers; `frame` is the window, the coordinate space of the host's
/// `measureInWindow`. The module is called `SvelteInsets` (not `SvelteEngine`, whose presence tells the host the Android engine is installed).
public final class SvelteInsetsModule: Module {
  private var tracker: InsetsTracker?

  public func definition() -> ModuleDefinition {
    Name("SvelteInsets")
    Events("insets")

    OnCreate {
      DispatchQueue.main.async {
        let tracker = InsetsTracker { [weak self] payload in self?.sendEvent("insets", payload) }
        self.tracker = tracker
        tracker.start()
      }
    }

    // The current values, read on the main thread (up to 500 ms); null before the window exists.
    Function("getInsets") { () -> [String: Any]? in
      if Thread.isMainThread { return self.tracker?.snapshot() }
      var result: [String: Any]?
      let done = DispatchSemaphore(value: 0)
      DispatchQueue.main.async {
        result = self.tracker?.snapshot()
        done.signal()
      }
      _ = done.wait(timeout: .now() + 0.5)
      return result
    }

    OnDestroy {
      DispatchQueue.main.async {
        self.tracker?.stop()
        self.tracker = nil
      }
    }
  }
}

/// A view that does nothing but hear the window's layout: UIKit tells a view when its safe area changes.
final class InsetsProbeView: UIView {
  var changed: (() -> Void)?

  override init(frame: CGRect) {
    super.init(frame: frame)
    isUserInteractionEnabled = false
    isAccessibilityElement = false
    accessibilityElementsHidden = true
    alpha = 0
    autoresizingMask = [.flexibleWidth, .flexibleHeight]
  }

  required init?(coder: NSCoder) { fatalError("InsetsProbeView is not made from a nib") }

  override func safeAreaInsetsDidChange() {
    super.safeAreaInsetsDidChange()
    changed?()
  }

  override func layoutSubviews() {
    super.layoutSubviews()
    changed?()
  }
}

final class InsetsTracker {
  private let send: ([String: Any]) -> Void
  private var probe: InsetsProbeView?
  private var keyboard: CGRect = .zero
  private var last: [String: Any]?
  private var observers: [NSObjectProtocol] = []

  init(send: @escaping ([String: Any]) -> Void) { self.send = send }

  private var window: UIWindow? {
    UIApplication.shared.connectedScenes
      .compactMap { $0 as? UIWindowScene }
      .flatMap { $0.windows }
      .first { $0.isKeyWindow }
  }

  func start() {
    let center = NotificationCenter.default
    let refresh: (Notification) -> Void = { [weak self] _ in
      self?.attach()
      self?.report()
    }
    observers.append(center.addObserver(forName: UIWindow.didBecomeKeyNotification, object: nil, queue: .main, using: refresh))
    observers.append(center.addObserver(forName: UIApplication.didBecomeActiveNotification, object: nil, queue: .main, using: refresh))
    observers.append(center.addObserver(forName: UIDevice.orientationDidChangeNotification, object: nil, queue: .main, using: refresh))
    observers.append(center.addObserver(forName: UIResponder.keyboardWillChangeFrameNotification, object: nil, queue: .main) { [weak self] note in
      self?.keyboard = (note.userInfo?[UIResponder.keyboardFrameEndUserInfoKey] as? NSValue)?.cgRectValue ?? .zero
      self?.report()
    })
    observers.append(center.addObserver(forName: UIResponder.keyboardWillHideNotification, object: nil, queue: .main) { [weak self] _ in
      self?.keyboard = .zero
      self?.report()
    })
    attach()
    report()
  }

  func stop() {
    for observer in observers { NotificationCenter.default.removeObserver(observer) }
    observers.removeAll()
    probe?.removeFromSuperview()
    probe = nil
  }

  private func attach() {
    guard probe?.window == nil, let window else { return }
    let view = InsetsProbeView(frame: window.bounds)
    view.changed = { [weak self] in self?.report() }
    window.insertSubview(view, at: 0)
    probe = view
  }

  /// Sends the values when they differ from the last ones sent.
  private func report() {
    guard let payload = snapshot() else { return }
    if let last, NSDictionary(dictionary: last).isEqual(to: payload) { return }
    last = payload
    send(payload)
  }

  func snapshot() -> [String: Any]? {
    guard let window else { return nil }
    let safe = window.safeAreaInsets
    let covered = window.convert(keyboard, from: window.screen.coordinateSpace)
    let height = keyboard.isEmpty ? 0 : max(0, Double(window.bounds.maxY - covered.minY))
    return [
      "top": Double(safe.top),
      "right": Double(safe.right),
      "bottom": Double(safe.bottom),
      "left": Double(safe.left),
      "keyboardHeight": height,
      "keyboardVisible": height > 0,
      "frame": ["x": 0.0, "y": 0.0, "width": Double(window.bounds.width), "height": Double(window.bounds.height)],
    ]
  }
}
