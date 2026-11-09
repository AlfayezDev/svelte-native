import XCTest

/// Puts the lab app through what an iOS app can be put through from outside, in one go (`native-qa resilience --platform ios`, README "Resilience on
/// the iPhone"): rotation, the Home button, ending the process, a launch with a text size or a language, the appearance. It decides nothing: the
/// harness wrote the plan (`qa/lib/iphone/resilience.ts`, passed as JSON in `RESILIENCE_PLAN`), this test carries out each step's moves, looks at the
/// screen for what the step's check lists and prints `RESILIENCE-STEP {json}` for the harness to read. While it runs the phone is asked nothing
/// (a `devicectl` call made then hangs), so everything the harness learns here comes through these lines.
///
/// Environment (as `TEST_RUNNER_*` variables of the xcodebuild call): `RESILIENCE_BUNDLE_ID` (the lab app), `RESILIENCE_PLAN` (`{ recovery, steps }`),
/// `RESILIENCE_SECONDS` (give up after).
final class ResilienceUITests: XCTestCase {
    private let bundleId = ProcessInfo.processInfo.environment["RESILIENCE_BUNDLE_ID"] ?? "io.example.svelteqa"
    private let seconds = TimeInterval(ProcessInfo.processInfo.environment["RESILIENCE_SECONDS"] ?? "1800") ?? 1800
    /// The launch arguments of the launches that follow (a text size, a language); set by the plan's `args` move.
    private var launchArguments: [String] = []
    /// Heights of elements recorded by a step (`scale.record`), for the steps that compare against them.
    private var heights: [String: Double] = [:]

    override func setUp() {
        continueAfterFailure = true
    }

    func testPlan() throws {
        guard
            let text = ProcessInfo.processInfo.environment["RESILIENCE_PLAN"],
            let data = text.data(using: .utf8),
            let plan = (try? JSONSerialization.jsonObject(with: data)) as? [String: Any],
            let steps = plan["steps"] as? [[String: Any]]
        else {
            XCTFail("RESILIENCE_PLAN is not a JSON object with a list of steps")
            return
        }
        let recovery = plan["recovery"] as? [[String: Any]] ?? []
        let app = XCUIApplication(bundleIdentifier: bundleId)
        let deadline = Date().addingTimeInterval(seconds)
        Self.emit("RESILIENCE-STARTED {\"steps\":\(steps.count)}")
        for step in steps {
            if Date() > deadline {
                Self.emit("RESILIENCE-TIMEOUT")
                break
            }
            run(step, recovery: recovery, app: app)
        }
        // The next run (or the harness reading the phone's files) finds the app ended, and the phone upright and light.
        XCUIDevice.shared.orientation = .portrait
        app.terminate()
        Self.emit("RESILIENCE-DONE")
    }

    // MARK: a step

    private func run(_ step: [String: Any], recovery: [[String: Any]], app: XCUIApplication) {
        let began = Date()
        var failures: [String] = []
        var skipped: String? = nil
        for move in step["moves"] as? [[String: Any]] ?? [] {
            if let problem = perform(move, app: app) {
                if problem.hasPrefix("skipped: ") { skipped = String(problem.dropFirst("skipped: ".count)) } else { failures.append(problem) }
            }
        }
        if skipped == nil { failures.append(contentsOf: verify(step["check"] as? [String: Any] ?? [:], app: app)) }
        var recovered = false
        if !failures.isEmpty && step["recover"] as? Bool == true {
            // A hung or dead app would fail every step after this one for the same reason: put the phone right so the next step is judged on its own.
            recovered = true
            for move in recovery { _ = perform(move, app: app) }
        }
        var line: [String: Any] = [
            "index": step["index"] ?? 0, "ok": failures.isEmpty, "failures": failures, "recovered": recovered,
            "durationMs": Int(Date().timeIntervalSince(began) * 1000),
        ]
        if let skipped = skipped { line["skipped"] = skipped }
        if let data = try? JSONSerialization.data(withJSONObject: line), let text = String(data: data, encoding: .utf8) {
            Self.emit("RESILIENCE-STEP \(text)")
        }
    }

    // MARK: moves

    /// One move; a problem is returned as text (`skipped: ...` for one the phone or the SDK cannot do), nil when it was done.
    private func perform(_ move: [String: Any], app: XCUIApplication) -> String? {
        switch move["do"] as? String ?? "" {
        case "open":
            guard let text = move["url"] as? String, let url = URL(string: text) else { return "open: no link" }
            app.launchArguments = launchArguments
            app.open(url)
        case "args":
            launchArguments = move["args"] as? [String] ?? []
        case "launch":
            if app.state != .notRunning { app.terminate() }
            app.launchArguments = launchArguments
            app.launch()
        case "activate":
            app.activate()
        case "home":
            XCUIDevice.shared.press(.home)
        case "terminate":
            app.terminate()
        case "orient":
            XCUIDevice.shared.orientation = move["to"] as? String == "landscapeLeft" ? .landscapeLeft : .portrait
        case "appearance":
            // `XCUIDevice.appearance` is looked up at run time: a runner built with an SDK that lacks it still builds, and the step is skipped.
            let device = XCUIDevice.shared
            guard device.responds(to: NSSelectorFromString("setAppearance:")) else { return "skipped: this SDK's XCUIDevice has no appearance" }
            device.setValue(move["to"] as? String == "dark" ? 2 : 1, forKey: "appearance")
        case "tap":
            let label = move["label"] as? String ?? ""
            guard let button = appearing(Self.label(label), in: app, timeout: 20) else { return "tap: \(label) is not on screen" }
            button.tap()
        case "await":
            let label = move["label"] as? String ?? ""
            if appearing(Self.label(label), in: app, timeout: 20) == nil { return "await: \(label) did not appear" }
        case "wait":
            Thread.sleep(forTimeInterval: (move["seconds"] as? Double) ?? 1)
        default:
            return "unknown move \(move["do"] ?? "nil")"
        }
        return nil
    }

    // MARK: checks

    private func verify(_ check: [String: Any], app: XCUIApplication) -> [String] {
        var failures: [String] = []
        if let expected = check["state"] as? String {
            let actual = Self.stateName(app.state)
            if actual != expected { failures.append("the app is \(actual), it should be \(expected)") }
        }
        for anchor in check["present"] as? [[String: Any]] ?? [] {
            if appearing(anchor, in: app, timeout: 20) == nil { failures.append("not on screen: \(Self.describe(anchor))") }
        }
        for anchor in check["absent"] as? [[String: Any]] ?? [] {
            if candidates(anchor, in: app).contains(where: { $0.exists }) { failures.append("on screen, and it should not be: \(Self.describe(anchor))") }
        }
        if let scale = check["scale"] as? [String: Any] { failures.append(contentsOf: measure(scale, app: app)) }
        return failures
    }

    /// The height of the element (points) against the one a step recorded: Dynamic Type made the text larger or smaller.
    private func measure(_ scale: [String: Any], app: XCUIApplication) -> [String] {
        let label = scale["label"] as? String ?? ""
        guard let target = appearing(Self.label(label), in: app, timeout: 20) else { return ["scale: \(label) is not on screen"] }
        let height = Double(target.frame.height)
        if let key = scale["record"] as? String { heights[key] = height }
        guard let against = scale["against"] as? String else { return [] }
        guard let base = heights[against], base > 0 else { return ["scale: no height was recorded as \(against)"] }
        let ratio = height / base
        var failures: [String] = []
        if let minimum = scale["min"] as? Double, ratio < minimum {
            failures.append("the text is \(Self.rounded(ratio))x the default height (\(Self.rounded(height)) pt of \(Self.rounded(base))), it should be at least \(minimum)x: the launch argument did not change the text size")
        }
        if let maximum = scale["max"] as? Double, ratio > maximum {
            failures.append("the text is \(Self.rounded(ratio))x the default height (\(Self.rounded(height)) pt of \(Self.rounded(base))), it should be at most \(maximum)x: the launch argument did not change the text size")
        }
        return failures
    }

    // MARK: finding things

    private static func label(_ value: String) -> [String: Any] { ["kind": "label", "value": value] }

    /// The elements that may be the anchor: UIKit names a navigation bar by its title (its identifier) or only draws the title as text inside it.
    private func candidates(_ anchor: [String: Any], in app: XCUIApplication) -> [XCUIElement] {
        let value = anchor["value"] as? String ?? ""
        let named = NSPredicate(format: "label == %@ OR identifier == %@", value, value)
        switch anchor["kind"] as? String ?? "" {
        case "bar":
            return [app.navigationBars.matching(identifier: value).firstMatch, app.navigationBars.staticTexts.matching(named).firstMatch]
        case "back":
            return [app.navigationBars.buttons.firstMatch]
        default:
            return [app.descendants(matching: .any).matching(named).firstMatch]
        }
    }

    /// The first candidate that is on screen within `timeout` seconds, polled; nil when none came.
    private func appearing(_ anchor: [String: Any], in app: XCUIApplication, timeout: TimeInterval) -> XCUIElement? {
        let deadline = Date().addingTimeInterval(timeout)
        repeat {
            for candidate in candidates(anchor, in: app) where candidate.exists { return candidate }
            Thread.sleep(forTimeInterval: 0.25)
        } while Date() < deadline
        return nil
    }

    private static func describe(_ anchor: [String: Any]) -> String {
        switch anchor["kind"] as? String ?? "" {
        case "bar": return "the navigation bar \"\(anchor["value"] ?? "")\""
        case "back": return "a back button in the navigation bar"
        default: return "\"\(anchor["value"] ?? "")\""
        }
    }

    private static func stateName(_ state: XCUIApplication.State) -> String {
        switch state {
        case .runningForeground: return "foreground"
        case .runningBackground, .runningBackgroundSuspended: return "background"
        case .notRunning: return "notRunning"
        default: return "unknown"
        }
    }

    private static func rounded(_ value: Double) -> String { String(format: "%.2f", value) }

    /// One line of the harness's protocol: printed and flushed at once, because the output is a pipe and a buffered line would reach it late.
    private static func emit(_ line: String) {
        print(line)
        fflush(stdout)
    }
}
