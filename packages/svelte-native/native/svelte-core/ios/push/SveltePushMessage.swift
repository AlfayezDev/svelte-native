// Compiled only when push is on (`SVELTE_PUSH`, set by SvelteCore.podspec from the config plugin's `capabilities.push.ios`): an app without push has none of it in its binary.
#if SVELTE_PUSH
import CoreFoundation
import Foundation

/// A push message as JavaScript receives it (`PushMessage` in `src/push/types.ts`), made from the payload APNs delivered. It holds plain values and imports neither
/// UserNotifications nor Expo, so the mapping can be compiled and tried on its own.
struct SveltePushMessage: Equatable {
  var id: String
  var title: String?
  var body: String?
  var url: String?
  var data: [String: String]

  /// The dictionary the module gives to JavaScript. A title, body or link the payload did not carry is left out and not sent as null, because `PushMessage` types them
  /// as optional and the app's hooks test them for `undefined`. Every message of this module comes from APNs.
  var payload: [String: Any] {
    var result: [String: Any] = ["id": id, "data": data, "provider": "apns"]
    if let title { result["title"] = title }
    if let body { result["body"] = body }
    if let url { result["url"] = url }
    return result
  }
}

/// The mapping of the `userInfo` of an APNs payload to a `SveltePushMessage` (PUSH.md, "How a message maps"). The sender writes `aps.alert` as `{ title, body }`, the link as
/// the custom key `url` and the app's `data` as more custom keys beside `aps`, so reading a payload back is that mapping the other way.
enum SveltePushPayload {
  /// Whether the payload asks the system to show something, which is what tells a data message from a notification that arrives with `content-available` as well.
  static func hasAlert(_ userInfo: [AnyHashable: Any]) -> Bool {
    guard let aps = userInfo["aps"] as? [AnyHashable: Any] else { return false }
    return aps["alert"] != nil
  }

  /// The message of a payload. `id` is the one the system gave the notification: for a remote notification that is the `apns-id` of the send (or its collapse id), which is
  /// not part of the payload; a message that reaches the app without a notification (a silent push) has none, and gets one made here so that the hooks can tell messages apart.
  static func message(from userInfo: [AnyHashable: Any], id: String? = nil) -> SveltePushMessage {
    var title: String?
    var body: String?
    if let aps = userInfo["aps"] as? [AnyHashable: Any], let alert = aps["alert"] {
      if let text = alert as? String {
        // APNs reads a string alert as the body.
        body = text
      } else if let fields = alert as? [AnyHashable: Any] {
        title = fields["title"] as? String
        body = fields["body"] as? String
      }
    }
    let link = userInfo["url"] as? String
    var data: [String: String] = [:]
    for (key, value) in userInfo {
      guard let name = key as? String else {
        NSLog("[SveltePush] a payload key that is not a string was left out of the message's data: %@", String(describing: key))
        continue
      }
      // `aps` is APNs's own key and the link is the message's `url`; a `url` that is not a string is not a link, and stays among the data.
      if name == "aps" || (name == "url" && link != nil) { continue }
      data[name] = text(of: value)
    }
    return SveltePushMessage(id: nonEmpty(id) ?? UUID().uuidString, title: nonEmpty(title), body: nonEmpty(body), url: nonEmpty(link), data: data)
  }

  /// A custom value as the string `data` holds, since both providers carry strings only: a string as it is, a number as its digits, a boolean as `true` or `false`, and a
  /// list or an object as JSON (with its keys sorted, so the same payload always gives the same text).
  static func text(of value: Any) -> String {
    switch value {
    case let string as String:
      return string
    case let number as NSNumber:
      // A JSON boolean arrives as an NSNumber too, and `stringValue` would write it as 1 or 0.
      if CFGetTypeID(number) == CFBooleanGetTypeID() { return number.boolValue ? "true" : "false" }
      return number.stringValue
    case is NSNull:
      return "null"
    default:
      if JSONSerialization.isValidJSONObject(value),
        let json = try? JSONSerialization.data(withJSONObject: value, options: [.sortedKeys]),
        let string = String(data: json, encoding: .utf8) {
        return string
      }
      return String(describing: value)
    }
  }

  /// A string that has something in it: an empty title, body or link is as good as none, and JavaScript's checks for a missing one would not see it.
  private static func nonEmpty(_ text: String?) -> String? {
    guard let text, !text.isEmpty else { return nil }
    return text
  }
}
#endif
