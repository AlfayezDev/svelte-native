import ExpoModulesCore
import UIKit

/// What the view shows before the app gives a prop, and when it stops giving it: the same as the Android view and the JavaScript component.
enum SvelteBlurDefaults {
  static let intensity: Double = 50
  static let tint = "default"
}

/// The `UIBlurEffect.Style` of a `tint` name, the names of the style's cases: "default" and any name not listed here is `.regular`, which follows the
/// trait collection (light or dark), as do `.prominent` and the system materials without a "Light" or "Dark" suffix.
enum SvelteBlurTint {
  private static let styles: [String: UIBlurEffect.Style] = [
    "default": .regular,
    "regular": .regular,
    "prominent": .prominent,
    "light": .light,
    "extraLight": .extraLight,
    "dark": .dark,
    "systemUltraThinMaterial": .systemUltraThinMaterial,
    "systemUltraThinMaterialLight": .systemUltraThinMaterialLight,
    "systemUltraThinMaterialDark": .systemUltraThinMaterialDark,
    "systemThinMaterial": .systemThinMaterial,
    "systemThinMaterialLight": .systemThinMaterialLight,
    "systemThinMaterialDark": .systemThinMaterialDark,
    "systemMaterial": .systemMaterial,
    "systemMaterialLight": .systemMaterialLight,
    "systemMaterialDark": .systemMaterialDark,
    "systemThickMaterial": .systemThickMaterial,
    "systemThickMaterialLight": .systemThickMaterialLight,
    "systemThickMaterialDark": .systemThickMaterialDark,
    "systemChromeMaterial": .systemChromeMaterial,
    "systemChromeMaterialLight": .systemChromeMaterialLight,
    "systemChromeMaterialDark": .systemChromeMaterialDark,
  ]

  static func style(named name: String) -> UIBlurEffect.Style { styles[name] ?? .regular }
}

/// Gives a `UIVisualEffectView` the blur at a fraction of its strength. UIKit has no intensity for a blur effect; the way to get one is an animator
/// that takes the effect from nil to the blur and is paused part of the way (`fractionComplete`), so what the view shows is that fraction of the
/// effect. Three things go wrong with such an animator and this class is where they are handled: the system finishes it when the app goes to the
/// background (the view would come back at full strength), a paused animator that is released without being stopped is an exception that ends the app,
/// and it was made for the style and the appearance of the moment (a change of either needs a new one). So the animator exists only while the view is
/// in a window, is made again on every change and on the app's return to the foreground, and is stopped when the view leaves the window or is released.
/// The ends need no animator: 0 is no effect and 100 is the effect itself, which the system never finishes on the app's behalf.
final class SvelteBlurEffectDriver {
  private let effectView: UIVisualEffectView
  private var animator: UIViewPropertyAnimator?
  private var observers: [NSObjectProtocol] = []
  private var attached = false
  private var intensity: Double
  private var style: UIBlurEffect.Style

  init(effectView: UIVisualEffectView, intensity: Double, style: UIBlurEffect.Style) {
    self.effectView = effectView
    self.intensity = intensity
    self.style = style
  }

  deinit {
    stopObserving()
    stopAnimator()
  }

  /// The intensity as the app gave it: 0 to 100, a value outside it is the nearest end, and one that is not a finite number (NaN, an infinity) is 50, the
  /// default, as on Android. Between the ends a live, paused animator is scrubbed to the new fraction, which is all an animated intensity costs; the effect
  /// is made again only when the value crosses 0 or 100 (the ends have no animator) or the animator is not there or was finished by the system.
  func setIntensity(_ value: Double) {
    let next = value.isFinite ? min(max(value, 0), 100) : SvelteBlurDefaults.intensity
    guard next != intensity else { return }
    intensity = next
    if attached, next > 0, next < 100, let animator, animator.state == .active {
      animator.fractionComplete = CGFloat(next / 100)
    } else {
      rebuild()
    }
  }

  func setStyle(_ value: UIBlurEffect.Style) {
    guard value != style else { return }
    style = value
    rebuild()
  }

  /// The view is in a window: the blur is shown and kept through the app's trips to the background.
  func attach() {
    guard !attached else { return }
    attached = true
    let center = NotificationCenter.default
    // The system finishes a running animator on the way to the background; both notifications of the return are heard because the first can come
    // while the app is still inactive, and the effect has to be right once it is not.
    for name in [UIApplication.willEnterForegroundNotification, UIApplication.didBecomeActiveNotification] {
      observers.append(center.addObserver(forName: name, object: nil, queue: .main) { [weak self] _ in self?.rebuild() })
    }
    rebuild()
  }

  /// The view left its window: nothing is kept running for it.
  func detach() {
    guard attached else { return }
    attached = false
    stopObserving()
    rebuild()
  }

  /// Makes the effect again from the current intensity and style, after stopping the animator that made the last.
  func rebuild() {
    stopAnimator()
    effectView.effect = nil
    guard attached, intensity > 0 else { return }
    let effect = UIBlurEffect(style: style)
    if intensity >= 100 {
      effectView.effect = effect
      return
    }
    let animator = UIViewPropertyAnimator(duration: 1, curve: .linear)
    animator.addAnimations { [effectView] in effectView.effect = effect }
    // Paused at the end it would be finished, and a finished animator cannot be scrubbed again.
    animator.pausesOnCompletion = true
    animator.fractionComplete = CGFloat(intensity / 100)
    self.animator = animator
  }

  private func stopObserving() {
    for observer in observers { NotificationCenter.default.removeObserver(observer) }
    observers.removeAll()
  }

  /// Ends the animator in whatever state the system left it: an active one is stopped without finishing, a stopped one has to be finished,
  /// and only an inactive one may be released.
  private func stopAnimator() {
    guard let animator else { return }
    self.animator = nil
    switch animator.state {
    case .active: animator.stopAnimation(true)
    case .stopped: animator.finishAnimation(at: .current)
    case .inactive: break
    @unknown default: break
    }
  }
}

/// A view that blurs what is behind it, by `intensity` (0 to 100: 0 is no blur, 100 the whole effect) in the style named by `tint`, and shows its
/// children above the blur. The blur is a `UIVisualEffectView` that is the view's first subview, as large as the view, which takes no touches and is
/// not in the accessibility tree; it takes the corner radius of the view's layer, so a view with rounded corners blurs inside them (a style with
/// differing radii clips the blur only with `overflow: hidden`, which clips what is inside the view whatever its shape).
///
/// Fabric mounts a child at the index it has among the view's children, which counts from 0; the blur takes subview 0 and the children follow it,
/// so mounting and unmounting add one to the index (React Native checks the index it is given against the subviews at unmount).
public final class SvelteBlurView: ExpoView {
  private let effectView: UIVisualEffectView
  private let driver: SvelteBlurEffectDriver
  private var layerObservations: [NSKeyValueObservation] = []

  public required init(appContext: AppContext? = nil) {
    let effectView = UIVisualEffectView(effect: nil)
    self.effectView = effectView
    self.driver = SvelteBlurEffectDriver(
      effectView: effectView, intensity: SvelteBlurDefaults.intensity, style: SvelteBlurTint.style(named: SvelteBlurDefaults.tint))
    super.init(appContext: appContext)
    effectView.isUserInteractionEnabled = false
    effectView.isAccessibilityElement = false
    effectView.accessibilityElementsHidden = true
    effectView.clipsToBounds = true
    effectView.autoresizingMask = [.flexibleWidth, .flexibleHeight]
    effectView.frame = bounds
    addSubview(effectView)
    // React Native sets the layer's corner radius when the style changes, which does not always lay the view out again.
    layerObservations = [
      layer.observe(\.cornerRadius) { [weak self] _, _ in self?.followCornerRadius() },
      layer.observe(\.cornerCurve) { [weak self] _, _ in self?.followCornerRadius() },
    ]
    followCornerRadius()
  }

  func setIntensity(_ value: Double) { driver.setIntensity(value) }

  func setTint(_ name: String) { driver.setStyle(SvelteBlurTint.style(named: name)) }

  /// One place later than Fabric's index: the blur is subview 0, wherever React Native keeps the view's children (the view itself, or the container
  /// it moves its subviews into when the style asks, the blur with them).
  private var childOffset: Int { effectView.superview == nil ? 0 : 1 }

  public override func mountChildComponentView(_ childComponentView: UIView, index: Int) {
    super.mountChildComponentView(childComponentView, index: index + childOffset)
  }

  public override func unmountChildComponentView(_ childComponentView: UIView, index: Int) {
    super.unmountChildComponentView(childComponentView, index: index + childOffset)
  }

  public override func layoutSubviews() {
    super.layoutSubviews()
    guard let parent = effectView.superview else { return }
    // Nothing but this class puts a view in front of the blur; this keeps it below whatever got in.
    if parent.subviews.first !== effectView { parent.sendSubviewToBack(effectView) }
    effectView.frame = parent.bounds
    followCornerRadius()
  }

  public override func didMoveToWindow() {
    super.didMoveToWindow()
    if window == nil { driver.detach() } else { driver.attach() }
  }

  // The system effects ("default", the materials) resolve to light or dark when they are drawn; one scrubbed to part of its strength does not follow a
  // change of appearance, so it is made again.
  public override func traitCollectionDidChange(_ previousTraitCollection: UITraitCollection?) {
    super.traitCollectionDidChange(previousTraitCollection)
    if previousTraitCollection?.hasDifferentColorAppearance(comparedTo: traitCollection) ?? false { driver.rebuild() }
  }

  private func followCornerRadius() {
    let source = layer
    let target = effectView.layer
    if target.cornerRadius != source.cornerRadius { target.cornerRadius = source.cornerRadius }
    if target.cornerCurve != source.cornerCurve { target.cornerCurve = source.cornerCurve }
  }
}
