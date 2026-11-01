import ImageIO
import UIKit

/// What the lab's checks of the native-view libraries read back from the platform (`apps/platform/src/lib/native/dev/foreign-libraries-checks.ts`,
/// SPEC.md, "Device verification of the libraries"): `inspect` says what UIKit built for a React Native tag (the class, its size and place on the screen
/// in pixels, whether it is in a window and shown, the text it holds, the classes of the views inside it), and `samplePixels` decodes an image the app made of
/// itself (a `captureRef` result: a file, a data URI or base64) and answers the colour at fractions of it, the mean of the square around each point.
/// The answers have the shape of the Android engine's (`SvelteEngine.inspect`) and of `SvelteQaPixels.sample`, so one check reads both. Nothing here touches
/// the screen. Not compiled or run on a device when it was written.
enum SvelteQAViews {
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

  /// The view of a React tag in any window of the app (a sheet's content is in the window of the controller that presented it, or in a window of its own).
  private static func view(tag: Int) -> UIView? {
    for scene in UIApplication.shared.connectedScenes {
      for window in (scene as? UIWindowScene)?.windows ?? [] {
        if let found = find(tag: tag, in: window) { return found }
      }
    }
    return nil
  }

  /// The text a view holds: a label's or a text view's string, else what it tells accessibility.
  private static func ownText(_ view: UIView) -> String? {
    if let label = view as? UILabel { return label.text }
    if let text = view as? UITextView { return text.text }
    if let label = view.accessibilityLabel, !label.isEmpty { return label }
    return nil
  }

  /// How a view clips what it draws, in the words the Android readback uses: `bounds` when UIKit cuts its subviews at its bounds (`clipsToBounds`, or a layer that masks to
  /// them), `none` otherwise. UIKit has one mode; Android's `canvas` (the padding box of an engine view with `overflow: hidden`) and `children` are its own.
  private static func clipMode(of view: UIView) -> String {
    view.clipsToBounds || view.layer.masksToBounds ? "bounds" : "none"
  }

  private static func collect(_ view: UIView, depth: Int, views: inout [String], texts: inout [String]) {
    if let text = ownText(view), !text.isEmpty, !texts.contains(text) { texts.append(text) }
    if depth >= 6 { return }
    for child in view.subviews {
      if views.count < 40 {
        let size = child.bounds.size
        views.append(String(repeating: "  ", count: depth) + String(describing: type(of: child)) + " \(Int(size.width))x\(Int(size.height)) clip=\(clipMode(of: child))")
      }
      collect(child, depth: depth + 1, views: &views, texts: &texts)
    }
  }

  private static func read(tag: Int) -> [String: Any]? {
    guard let view = view(tag: tag) else { return nil }
    let scale = Double(view.window?.screen.scale ?? UIScreen.main.scale)
    let screen = view.convert(view.bounds, to: nil)
    var views: [String] = []
    var texts: [String] = []
    collect(view, depth: 0, views: &views, texts: &texts)
    let shown = view.window != nil && !view.isHidden && view.alpha > 0.01
    return [
      "owner": "react",
      "class": NSStringFromClass(type(of: view)),
      "width": Int((Double(view.bounds.width) * scale).rounded()),
      "height": Int((Double(view.bounds.height) * scale).rounded()),
      "x": Int((Double(screen.origin.x) * scale).rounded()),
      "y": Int((Double(screen.origin.y) * scale).rounded()),
      "attached": view.window != nil,
      "shown": shown,
      "visibility": view.isHidden ? 4 : 0,
      "alpha": Double(view.alpha),
      "density": scale,
      "clip": clipMode(of: view),
      "parent": view.superview.map { NSStringFromClass(type(of: $0)) + " clip=" + clipMode(of: $0) } ?? "none",
      "text": texts.joined(separator: "\n"),
      "views": views,
      "surfaces": [String](),
    ]
  }

  /// UIKit is read on the main thread; the JavaScript thread waits for it (a read of a few views).
  static func inspect(tag: Int) -> [String: Any]? {
    if Thread.isMainThread { return read(tag: tag) }
    var out: [String: Any]?
    DispatchQueue.main.sync { out = read(tag: tag) }
    return out
  }

  private static func bytes(of source: String) throws -> Data {
    if source.hasPrefix("data:") {
      guard let comma = source.firstIndex(of: ","), let data = Data(base64Encoded: String(source[source.index(after: comma)...]), options: .ignoreUnknownCharacters) else { throw QAError("the data URI has no base64 payload") }
      return data
    }
    if source.hasPrefix("file://") {
      guard let url = URL(string: source) else { throw QAError("not a file URL: \(source.prefix(64))") }
      return try Data(contentsOf: url)
    }
    if source.hasPrefix("/") { return try Data(contentsOf: URL(fileURLWithPath: source)) }
    guard let data = Data(base64Encoded: source, options: .ignoreUnknownCharacters) else { throw QAError("not an image source: \(source.prefix(64))") }
    return data
  }

  private static func mime(_ type: String?) -> String {
    switch type {
    case "public.png": return "image/png"
    case "public.jpeg": return "image/jpeg"
    case "public.heic": return "image/heic"
    default: return type ?? ""
    }
  }

  static func samplePixels(source: String, points: [[Double]], radius: Int) throws -> [String: Any] {
    let data = try bytes(of: source)
    guard let imageSource = CGImageSourceCreateWithData(data as CFData, nil), let image = CGImageSourceCreateImageAtIndex(imageSource, 0, nil) else { throw QAError("the image of \(source.prefix(64)) could not be decoded (\(data.count) bytes)") }
    let width = image.width
    let height = image.height
    var raw = [UInt8](repeating: 0, count: width * height * 4)
    // The context draws into `raw` only while the pointer the closure is given is valid.
    let drawn: Bool = raw.withUnsafeMutableBytes { buffer in
      guard let context = CGContext(data: buffer.baseAddress, width: width, height: height, bitsPerComponent: 8, bytesPerRow: width * 4, space: CGColorSpaceCreateDeviceRGB(), bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue) else { return false }
      context.draw(image, in: CGRect(x: 0, y: 0, width: width, height: height))
      return true
    }
    guard drawn else { throw QAError("no bitmap context for \(width)x\(height)") }
    let reach = max(0, min(8, radius))
    var colors: [Int] = []
    for point in points {
      let x = max(0, min(width - 1, Int(point[0] * Double(width - 1))))
      let y = max(0, min(height - 1, Int(point[1] * Double(height - 1))))
      var a = 0, r = 0, g = 0, b = 0, n = 0
      for yy in max(0, y - reach)...min(height - 1, y + reach) {
        for xx in max(0, x - reach)...min(width - 1, x + reach) {
          let at = (yy * width + xx) * 4
          let alpha = Int(raw[at + 3])
          // The context holds premultiplied colour: undo it, so a half-transparent red reads as red at half alpha, as Android's bitmap does.
          let scale = alpha == 0 ? 0.0 : 255.0 / Double(alpha)
          r += Int((Double(raw[at]) * scale).rounded())
          g += Int((Double(raw[at + 1]) * scale).rounded())
          b += Int((Double(raw[at + 2]) * scale).rounded())
          a += alpha
          n += 1
        }
      }
      let value = (min(255, a / n) << 24) | (min(255, r / n) << 16) | (min(255, g / n) << 8) | min(255, b / n)
      colors.append(value)
    }
    return ["width": width, "height": height, "format": mime(CGImageSourceGetType(imageSource) as String?), "colors": colors]
  }
}
