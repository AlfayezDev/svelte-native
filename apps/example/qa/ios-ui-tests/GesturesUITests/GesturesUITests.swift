import XCTest

/// Drives the gesture lab (`/__dev/gestures`, SPEC.md "Gestures") on the iPhone the way a person would. The harness has already started
/// the lab app with `rasheed-svelte:///__dev?run=gestures-...,drive:xctest`; this test brings it to the front without restarting it and
/// loops: read the lab's `ready` line from the element `gestures.status` (its accessibility label is the line's JSON), find the view the
/// step aims at by its accessibility identifier (`gesture.<name>`, the page's `testID`), perform the input with XCUITest's own gestures,
/// and wait for the next line. The verdicts are the lab's: it counts what its recognisers report and writes `Documents/lab-results.json`,
/// which the harness reads. Every action is printed as `GESTURES-ACTION {json}` so the harness can record what was injected.
///
/// Environment (as `TEST_RUNNER_*` variables of the xcodebuild call): `GESTURES_BUNDLE_ID` (the lab app), `GESTURES_SECONDS` (give up after).
///
/// What XCUITest cannot do is two fingers on two axes at once: a `twoFinger` input that both spreads and turns is performed as a pinch and
/// then a rotation, which the lab's pinch scenario expects on iOS (it keeps what the first left and judges the end state, with a
/// tolerance, and does not require the two to have been active together).
final class GesturesUITests: XCTestCase {
    private let bundleId = ProcessInfo.processInfo.environment["GESTURES_BUNDLE_ID"] ?? "io.rasheed.svelteqa"
    private let seconds = TimeInterval(ProcessInfo.processInfo.environment["GESTURES_SECONDS"] ?? "900") ?? 900

    override func setUp() {
        continueAfterFailure = true
    }

    func testDrive() throws {
        let app = XCUIApplication(bundleIdentifier: bundleId)
        app.activate()
        let status = app.staticTexts["gestures.status"]
        let deadline = Date().addingTimeInterval(seconds)
        var performed = Set<String>()
        while Date() < deadline {
            // The stress panel says "Done." when the last scenario has been judged.
            if app.staticTexts["Done."].exists { break }
            guard app.state == .runningForeground else {
                XCTFail("the lab app is not in the foreground (state \(app.state.rawValue))")
                return
            }
            guard status.exists, let ready = Self.readyLine(status.label), ready["drive"] as? String == "xctest" else {
                Thread.sleep(forTimeInterval: 0.25)
                continue
            }
            let key = "\(ready["scenario"] ?? "")#\(ready["round"] ?? 0)#\(ready["step"] ?? 0)"
            guard !performed.contains(key), let input = ready["input"] as? [String: Any] else {
                Thread.sleep(forTimeInterval: 0.25)
                continue
            }
            performed.insert(key)
            var failure: String? = nil
            do {
                try perform(input, in: app)
            } catch {
                failure = "\(error)"
                XCTFail("\(key): \(error)")
            }
            Self.report(ready, input: input, error: failure)
        }
        XCTAssertLessThan(Date(), deadline, "the lab did not finish within \(seconds) s")
    }

    // MARK: the lab's line

    /// The JSON of a `ready` line; nil for any other state of the element ("waiting", "step ...", "result ...").
    private static func readyLine(_ label: String) -> [String: Any]? {
        guard label.hasPrefix("{"), let data = label.data(using: .utf8) else { return nil }
        guard let object = try? JSONSerialization.jsonObject(with: data) as? [String: Any], object["input"] != nil else { return nil }
        return object
    }

    private static func report(_ ready: [String: Any], input: [String: Any], error: String?) {
        var line: [String: Any] = [
            "scenario": ready["scenario"] ?? "", "round": ready["round"] ?? 0, "step": ready["step"] ?? 0,
            "kind": input["kind"] ?? "",
        ]
        if let error = error { line["error"] = error }
        if let data = try? JSONSerialization.data(withJSONObject: line), let text = String(data: data, encoding: .utf8) {
            print("GESTURES-ACTION \(text)")
        }
    }

    // MARK: inputs (the lab's `Input`: dp, which are points here)

    private struct DriveError: Error, CustomStringConvertible {
        let description: String
    }

    private func number(_ value: Any?) -> CGFloat {
        if let n = value as? NSNumber { return CGFloat(truncating: n) }
        return 0
    }

    private func pair(_ value: Any?) -> (CGFloat, CGFloat) {
        guard let values = value as? [Any], values.count == 2 else { return (0, 0) }
        return (number(values[0]), number(values[1]))
    }

    /// The coordinate of an anchor: a fraction of the named view's frame, then extra points.
    private func coordinate(_ anchor: Any?, in app: XCUIApplication) throws -> XCUICoordinate {
        guard let anchor = anchor as? [String: Any], let target = anchor["target"] as? String else { throw DriveError(description: "an input without an anchor") }
        let element = app.descendants(matching: .any).matching(identifier: "gesture.\(target)").firstMatch
        guard element.waitForExistence(timeout: 5) else { throw DriveError(description: "no element with the identifier gesture.\(target)") }
        let base = element.coordinate(withNormalizedOffset: CGVector(dx: number(anchor["fx"]), dy: number(anchor["fy"])))
        return base.withOffset(CGVector(dx: number(anchor["dx"]), dy: number(anchor["dy"])))
    }

    private func perform(_ input: [String: Any], in app: XCUIApplication) throws {
        switch input["kind"] as? String ?? "" {
        case "tap":
            try coordinate(input["at"], in: app).tap()
        case "drag":
            let start = try coordinate(input["from"], in: app)
            let (dx, dy) = pair(input["by"])
            let duration = max(number(input["durationMs"]) / 1000, 0.05)
            let end = start.withOffset(CGVector(dx: dx, dy: dy))
            let speed = hypot(dx, dy) / duration
            start.press(forDuration: 0.05, thenDragTo: end, withVelocity: XCUIGestureVelocity(rawValue: speed), thenHoldForDuration: 0)
        case "hold":
            let start = try coordinate(input["at"], in: app)
            let duration = number(input["durationMs"]) / 1000
            let (dx, dy) = pair(input["drift"])
            if dx == 0 && dy == 0 {
                start.press(forDuration: duration)
            } else {
                // Press, then move slowly over the rest of the hold: the long press recogniser gives up when the finger leaves its radius.
                let end = start.withOffset(CGVector(dx: dx, dy: dy))
                let rest = max(duration - 0.1, 0.1)
                start.press(forDuration: 0.1, thenDragTo: end, withVelocity: XCUIGestureVelocity(rawValue: hypot(dx, dy) / rest), thenHoldForDuration: 0)
            }
        case "twoFinger":
            guard let anchor = input["at"] as? [String: Any], let target = anchor["target"] as? String else { throw DriveError(description: "a two finger input without an anchor") }
            let element = app.descendants(matching: .any).matching(identifier: "gesture.\(target)").firstMatch
            guard element.waitForExistence(timeout: 5) else { throw DriveError(description: "no element with the identifier gesture.\(target)") }
            let duration = max(number(input["durationMs"]) / 1000, 0.1)
            let (d0, d1) = pair(input["distance"])
            let (a0, a1) = pair(input["angle"])
            if d0 > 0 && d1 != d0 {
                let scale = d1 / d0
                element.pinch(withScale: scale, velocity: (scale - 1) / duration)
            }
            if a1 != a0 {
                let radians = (a1 - a0) * .pi / 180
                element.rotate(radians, withVelocity: radians / duration)
            }
        default:
            throw DriveError(description: "unknown input kind \(input["kind"] ?? "nil")")
        }
    }
}
