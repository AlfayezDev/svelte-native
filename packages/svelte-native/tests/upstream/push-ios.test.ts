import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { nodeModules } from "../support/paths.ts";
import { expoTemplateAppDelegate } from "../cli/support/app-delegate.ts";

// iOS push (`packages/svelte-native-push/ios`, PUSH.md) is written against the sources of Expo's app delegate, Expo modules core and React Native, which cannot be compiled on the
// machines these tests run on. What the Swift assumes of them is read from the installed sources here, so an update of one that changes the facts fails this file and says what, before
// a Mac build says it with a compile error or a screen that mounts in the background. What the Swift itself does is `native-host/contracts/push-ios.test.ts`.
const read = (path: string) => readFileSync(resolve(nodeModules, path), "utf8");
const rootViewFactoryHeader = read("react-native/Libraries/AppDelegate/RCTRootViewFactory.h");
const rootViewFactory = read("react-native/Libraries/AppDelegate/RCTRootViewFactory.mm");
const reactNativeFactory = read("react-native/Libraries/AppDelegate/RCTReactNativeFactory.mm");
const reactNativeFactoryHeader = read("react-native/Libraries/AppDelegate/RCTReactNativeFactory.h");
const host = read("react-native/ReactCommon/react/runtime/platform/ios/ReactCommon/RCTHost.mm");
const expoFactory = read("expo/ios/AppDelegates/ExpoReactNativeFactory.swift");
const expoRootViewFactory = read("expo/ios/AppDelegates/EXReactRootViewFactory.mm");
const expoAppDelegate = read("expo/ios/AppDelegates/ExpoAppDelegate.swift");
const subscriberManager = read("expo-modules-core/ios/AppDelegates/ExpoAppDelegateSubscriberManager.swift");
const subscriberProtocol = read("expo-modules-core/ios/AppDelegates/ExpoAppDelegateSubscriber.swift");
const module = read("expo-modules-core/ios/Core/Modules/Module.swift");
const promise = read("expo-modules-core/ios/Core/Promise.swift");
const observing = read("expo-modules-core/ios/Core/Events/EventObservingDefinition.swift");
const observingFactories = read("expo-modules-core/ios/Api/Factories/ObjectFactories.swift");
const emitter = read("expo-modules-core/common/cpp/EventEmitter.cpp");

describe("a launch in the background can start the React host without a screen, and a later start makes the screen on that host (rule 2)", () => {
  test("React Native offers to initialize the host without a view, and the view factory makes the host only once", () => {
    expect(rootViewFactoryHeader).toContain("Initialize React Host/Bridge without creating a view.");
    expect(rootViewFactoryHeader).toContain("- (void)initializeReactHostWithLaunchOptions:(NSDictionary *__nullable)launchOptions\n                         bundleConfiguration:(RCTBundleConfiguration *)bundleConfiguration\n                        devMenuConfiguration:(RCTDevMenuConfiguration *)devMenuConfiguration;");
    expect(rootViewFactory).toMatch(/- \(void\)createReactHostIfNeeded:[\s\S]*?if \(self\.reactHost\) \{\n {4}return;\n {2}\}\n\n {2}self\.reactHost = \[self createReactHost:/);
    // `createReactHost` starts it: the bundle loads and JavaScript runs, with no surface.
    expect(rootViewFactory).toMatch(/\[reactHost start\];\n {2}return reactHost;/);
  });

  test("the surface is what starts the first screen: making the view creates the surface, which starts when the bundle has run, whether or not a window shows it", () => {
    const view = rootViewFactory.slice(rootViewFactory.indexOf("- (UIView *)viewWithModuleName:(NSString *)moduleName\n             initialProperties:(NSDictionary *)initProps"));
    expect(view.indexOf("[self initializeReactHostWithLaunchOptions:launchOptions")).toBeGreaterThanOrEqual(0);
    expect(view.indexOf("[self initializeReactHostWithLaunchOptions:launchOptions")).toBeLessThan(view.indexOf("[self.reactHost createSurfaceWithModuleName:"));
    expect(host).toContain("[_instance callFunctionOnBufferedRuntimeExecutor:[weakSurface](facebook::jsi::Runtime &_) { [weakSurface start]; }];");
    // startReactNative makes the view, then the window shows it: the two halves the patch separates.
    expect(reactNativeFactory).toMatch(/UIView \*rootView = \[self\.rootViewFactory viewWithModuleName:moduleName/);
    expect(reactNativeFactory).toContain("[window makeKeyAndVisible];");
  });

  test("the factory's host start and its view use the same bundle configuration and dev menu configuration the patch passes", () => {
    expect(reactNativeFactoryHeader).toContain("@property (nonatomic, strong, nonnull) RCTRootViewFactory *rootViewFactory;");
    expect(reactNativeFactoryHeader).toContain("@property (nonatomic, strong, nonnull) RCTBundleConfiguration *bundleConfiguration;");
    expect(reactNativeFactoryHeader).toContain("@property (nonatomic, nullable) RCTDevMenuConfiguration *devMenuConfiguration;");
    expect(reactNativeFactory).toContain("bundleConfiguration:self.bundleConfiguration\n                                         devMenuConfiguration:self.devMenuConfiguration];");
    // Expo's factory answers `bundleConfiguration` itself (and adopts the Metro port from Info.plist), and uses `RCTDevMenuConfiguration.default()` where the property is nil.
    expect(expoFactory).toContain("public override var bundleConfiguration: RCTBundleConfiguration {");
    expect(expoFactory).toContain("adoptInfoPlistMetroPort()\n      return ExpoBundleConfiguration.configuration(bundleURL: self.delegate?.bundleURL())");
    expect(expoFactory).toContain("devMenuConfiguration: self.devMenuConfiguration ?? RCTDevMenuConfiguration.default()");
  });

  test("Expo's root view factory is the one the host starts on: its bundle URL (the update the library's handler chose) is the host's provider, and a view made later reuses the host", () => {
    expect(expoRootViewFactory).toContain("return [((id<EXReactDelegateProtocol>)self.reactDelegate) bundleURL] ?: [super bundleURL];");
    expect(rootViewFactory).toContain("[reactHost setBundleURLProvider:^NSURL *() {\n    return [weakSelf bundleURL];\n  }];");
    expect(expoFactory).toContain("rootView = factory.superView(");
  });

  test("Expo's template makes the call the patch wraps, in a method that returns the subscribers' answer last", () => {
    const template = expoTemplateAppDelegate();
    expect(template).toContain('    window = UIWindow(frame: UIScreen.main.bounds)\n    factory.startReactNative(\n      withModuleName: "main",\n      in: window,\n      launchOptions: launchOptions)\n#endif\n\n    return super.application(application, didFinishLaunchingWithOptions: launchOptions)');
    expect(template).toContain("class AppDelegate: ExpoAppDelegate {");
    expect(template).toContain("var reactNativeFactory: RCTReactNativeFactory?");
    expect(template).not.toContain("UIWindowSceneDelegate");
    expect(template).not.toContain("ExpoAppSceneDelegate");
  });
});

describe("the app delegate gives the subscriber what the Swift receives", () => {
  test("the registration, its failure, and the silent pushes reach every subscriber, and `didFinishLaunching` reaches them from the delegate's own", () => {
    expect(expoAppDelegate).toContain("open func application(_ application: UIApplication, didRegisterForRemoteNotificationsWithDeviceToken deviceToken: Data) {");
    expect(expoAppDelegate).toContain("open func application(_ application: UIApplication, didFailToRegisterForRemoteNotificationsWithError error: Error) {");
    expect(expoAppDelegate).toContain("didReceiveRemoteNotification userInfo: [AnyHashable: Any],\n    fetchCompletionHandler completionHandler: @escaping (UIBackgroundFetchResult) -> Void");
    expect(expoAppDelegate).toContain("return ExpoAppDelegateSubscriberManager.application(application, didFinishLaunchingWithOptions: launchOptions)");
    expect(subscriberManager).toContain("subscriber.application?(application, didReceiveRemoteNotification: userInfo, fetchCompletionHandler: aggregatedHandler)");
    expect(subscriberManager).toContain("$0.application?(application, didRegisterForRemoteNotificationsWithDeviceToken: deviceToken)");
    expect(subscriberManager).toContain("_ = subscriber.application?(application, didFinishLaunchingWithOptions: launchOptions)");
  });

  test("the subscriber is a class that inherits UIResponder, with an initializer of no arguments, and the system's completion is called once all subscribers have answered", () => {
    expect(subscriberProtocol).toContain("public typealias ExpoAppDelegateSubscriber = BaseExpoAppDelegateSubscriber & ExpoAppDelegateSubscriberProtocol");
    expect(subscriberProtocol).toContain("open class BaseExpoAppDelegateSubscriber: UIResponder {\n  public override required init() {");
    expect(subscriberManager).toContain("if newDataCount > 0 {\n            completionHandler(.newData)");
  });
});

describe("the module's DSL is what the Swift uses", () => {
  test("a module sends an event with sendEvent, and a promise resolves with an optional value and rejects with a code and a description", () => {
    expect(module).toContain("public func sendEvent(_ eventName: String, _ body: [String: Any?] = [:]) {");
    expect(promise).toContain("public func resolve(_ value: Any? = nil) {");
    expect(promise).toContain("public func reject(_ code: String, _ description: String) {");
    expect(promise).toContain("public func reject(_ error: Error) {");
  });

  test("OnStartObserving takes an event name and a closure, and the emitter has added the listener before the native side is told", () => {
    expect(observingFactories).toContain("public func OnStartObserving(_ event: String? = nil, @_implicitSelfCapture _ closure: @escaping () -> Void) -> EventObservingDefinition {");
    expect(observingFactories).toContain("public func OnStopObserving(_ event: String? = nil, @_implicitSelfCapture _ closure: @escaping () -> Void) -> EventObservingDefinition {");
    // The definition with an event name runs for the first listener of that name.
    expect(observing).toContain("if definition.event == event || (observingEvents == 1 && definition.event == nil) {");
    expect(emitter).toMatch(/state->listeners\.add\(runtime, eventName, listener\);\n\n {4}if \(state->listeners\.listenersCount\(eventName\) == 1\) \{[\s\S]*?callObservingFunction\(runtime, emitter, "startObserving", eventName\);/);
  });
});
