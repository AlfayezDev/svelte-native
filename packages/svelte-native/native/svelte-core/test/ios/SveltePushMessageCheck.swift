import Foundation

// Host check of what push maps from the system's words to the module's: an APNs payload to a `SveltePushMessage` (`SveltePushPayload`) and a provisioning profile to the
// `aps-environment` of the build (`SveltePushEnvironment`), and what turns the native code on (`SveltePushFlag`, from the Info.plist). Plain Foundation, no app and no phone: `message.sh`
// compiles it with the three Swift files as the program's `main.swift`.

var checks = 0
func expect<T: Equatable>(_ what: String, _ actual: T, _ wanted: T) {
  checks += 1
  if actual != wanted {
    FileHandle.standardError.write(Data("FAIL \(what): wanted \(wanted), got \(actual)\n".utf8))
    exit(1)
  }
}

/// A payload as APNs delivers it: JSON text read the way the system reads it, so a number, a boolean and null are the objects they are on a device.
func payload(_ json: String) -> [AnyHashable: Any] {
  guard let object = try? JSONSerialization.jsonObject(with: Data(json.utf8)) as? [AnyHashable: Any] else {
    FileHandle.standardError.write(Data("FAIL the check's own payload is not a JSON object: \(json)\n".utf8))
    exit(1)
  }
  return object
}

// What the sender writes (`apns.ts`): an alert with a title and a body, the link as `url`, and the data as custom keys beside `aps`.
let notification = SveltePushPayload.message(
  from: payload(#"{"aps":{"alert":{"title":"Order ready","body":"Pickup at gate 3"},"sound":"default"},"url":"/orders/42","order":"42"}"#),
  id: "E9DAC83C-0000-4000-8000-000000000001"
)
expect("the id is the one the system gave", notification.id, "E9DAC83C-0000-4000-8000-000000000001")
expect("the title is the alert's", notification.title, "Order ready")
expect("the body is the alert's", notification.body, "Pickup at gate 3")
expect("the link is the custom url", notification.url, "/orders/42")
expect("the data is the other custom keys, and neither aps nor url", notification.data, ["order": "42"])

// A string alert is the body.
let plain = SveltePushPayload.message(from: payload(#"{"aps":{"alert":"Hello"}}"#), id: "a")
expect("a string alert is a body without a title", [plain.title, plain.body], [nil, "Hello"])
expect("and the message has no link and no data", [plain.url == nil, plain.data.isEmpty], [true, true])

// Custom values are strings in the data, whatever they were: numbers as digits, booleans as words (an NSNumber would give 1 and 0), lists and objects as JSON with sorted keys.
let typed = SveltePushPayload.message(
  from: payload(#"{"aps":{},"count":3,"ratio":0.5,"flag":true,"off":false,"list":[1,"a"],"nested":{"b":1,"a":2},"nothing":null,"text":"x"}"#),
  id: "b"
)
expect("every custom value is a string", typed.data, [
  "count": "3", "ratio": "0.5", "flag": "true", "off": "false", "list": #"[1,"a"]"#, "nested": #"{"a":2,"b":1}"#, "nothing": "null", "text": "x",
])

// A `url` that is not a string is not a link: it stays among the data, as text.
let oddLink = SveltePushPayload.message(from: payload(#"{"aps":{},"url":5}"#), id: "c")
expect("a url that is a number is not a link", oddLink.url == nil, true)
expect("and is data", oddLink.data, ["url": "5"])

// Empty text is no text: a message JavaScript tests for a title finds none.
let empty = SveltePushPayload.message(from: payload(#"{"aps":{"alert":{"title":"","body":"x"}},"url":""}"#), id: "d")
expect("an empty title is none", [empty.title == nil, empty.body == "x", empty.url == nil], [true, true, true])

// A silent push has no notification and so no id from the system: one is made, a different one each time.
let silent = payload(#"{"aps":{"content-available":1},"inbox":"7"}"#)
let first = SveltePushPayload.message(from: silent)
let second = SveltePushPayload.message(from: silent)
expect("a silent push still has an id", first.id.isEmpty, false)
expect("and each one is its own", first.id != second.id, true)
expect("its data is the custom keys", first.data, ["inbox": "7"])
expect("it shows nothing", SveltePushPayload.hasAlert(silent), false)
expect("a notification does", SveltePushPayload.hasAlert(payload(#"{"aps":{"alert":"x"}}"#)), true)
expect("and a payload without aps does not", SveltePushPayload.hasAlert(payload(#"{"inbox":"7"}"#)), false)
expect("an empty id is no id", SveltePushPayload.message(from: silent, id: "").id.isEmpty, false)

// What JavaScript receives: the keys of `PushMessage`, and a missing title, body or link is absent and not null.
let dictionary = plain.payload
expect("the payload has the provider, the id and the data", [dictionary["provider"] as? String, dictionary["id"] as? String], ["apns", "a"])
expect("its data is a dictionary of strings", (dictionary["data"] as? [String: String])?.isEmpty, true)
expect("its body is there", dictionary["body"] as? String, "Hello")
expect("its title and link are not", [dictionary["title"] == nil, dictionary["url"] == nil], [true, true])
expect("the keys are those of PushMessage, and no more", Set(notification.payload.keys), ["id", "title", "body", "url", "data", "provider"])

// The profile: a signed message around a property list, found by its XML header. The bytes around it are not text.
func profile(_ entitlements: String) -> Data {
  let list = """
    <?xml version="1.0" encoding="UTF-8"?>
    <!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
    <plist version="1.0"><dict><key>Name</key><string>demo</string><key>Entitlements</key><dict>\(entitlements)</dict></dict></plist>
    """
  return Data([0x30, 0x82, 0x0a, 0xff, 0x80]) + Data(list.utf8) + Data([0x00, 0xfe, 0x31])
}
expect("a development profile", SveltePushEnvironment.apsEnvironment(inProfile: profile("<key>aps-environment</key><string>development</string>")), "development")
expect("a distribution profile", SveltePushEnvironment.apsEnvironment(inProfile: profile("<key>aps-environment</key><string>production</string>")), "production")
expect("a profile without the entitlement", SveltePushEnvironment.apsEnvironment(inProfile: profile("<key>get-task-allow</key><true/>")), nil)
expect("an environment that is neither", SveltePushEnvironment.apsEnvironment(inProfile: profile("<key>aps-environment</key><string>sandbox</string>")), nil)
expect("bytes with no property list", SveltePushEnvironment.apsEnvironment(inProfile: Data([0x30, 0x82, 0x0a, 0xff])), nil)
expect("a property list that is cut off", SveltePushEnvironment.apsEnvironment(inProfile: Data("<?xml version=\"1.0\"?><plist><dict>".utf8)), nil)

// The flag: SvelteCore is in every app, so everything push does asks it first, and only the boolean the config plugin writes turns push on.
func infoPlist(_ entries: String) -> [String: Any]? {
  let list = #"<?xml version="1.0" encoding="UTF-8"?><plist version="1.0"><dict>\#(entries)</dict></plist>"#
  return try? PropertyListSerialization.propertyList(from: Data(list.utf8), options: [], format: nil) as? [String: Any]
}
expect("the Info.plist key the config plugin writes", SveltePushFlag.infoPlistKey, "SveltePushEnabled")
expect("true is on", SveltePushFlag.isOn(true), true)
expect("false is off", SveltePushFlag.isOn(false), false)
expect("no entry is off", SveltePushFlag.isOn(nil), false)
expect("a text is off", SveltePushFlag.isOn("true"), false)
expect("the property list's <true/> is on", SveltePushFlag.isOn(infoPlist("<key>SveltePushEnabled</key><true/>")?[SveltePushFlag.infoPlistKey]), true)
expect("the property list's <false/> is off", SveltePushFlag.isOn(infoPlist("<key>SveltePushEnabled</key><false/>")?[SveltePushFlag.infoPlistKey]), false)
expect("a property list without the key is off", SveltePushFlag.isOn(infoPlist("<key>UIBackgroundModes</key><array><string>remote-notification</string></array>")?[SveltePushFlag.infoPlistKey]), false)

FileHandle.standardError.write(Data("SveltePushMessageCheck: \(checks) checks passed\n".utf8))
