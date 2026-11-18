/* eslint-disable @typescript-eslint/no-require-imports -- every library is required inside its own check: nothing of the smoke test is evaluated until it runs, and only the smoke app links the libraries */
import { nativeModule, turboModule } from "@alfayez/svelte-native/platform";
import { ascii, decodeBase64, encodeBase64, hex, looksRandom } from "./smoke-bytes.ts";
import { skipName, type Os, type SmokePath } from "./smoke-log.ts";
import { hmsNativeModules, hmsOutcome } from "./smoke-rules.ts";

/**
 * The 36 checks of the native module smoke test (SPEC.md, "Native modules (smoke test)"): one core call for each native library the
 * production app uses, made from Svelte Native without React. Each check requires its library when it runs, calls it once, and
 * reports through `smoke.ts` `ok`, `fail` or `skip` with the path it took: `js` (the library's own JavaScript API), `direct` (its
 * TurboModule or NativeModule by name, when its JavaScript needs React or reaches another module than the one under test). Nothing
 * here asks for a permission, prompts, or touches the network: permission checks read the state, Firebase's collection and token
 * fetches are off (`firebase.json`), Sentry and Statsig run disabled, Intercom and Adjust are not initialized.
 *
 * Only the smoke app (`io.example.svelteqa.smoke`) links these libraries and carries this file: the product and the QA app resolve
 * it, and the libraries, to a stub in Metro (`metro.config.cjs`), so none of it is in their bundles.
 */

/** A check that did not apply: the reason is the detail of its `skip`. Tagged by name, not by class: `instanceof` on a transpiled Error subclass is not dependable. */
const skip = (reason: string): never => {
	const error = new Error(reason);
	error.name = skipName;
	throw error;
};
function expect(condition: boolean, message: string): void {
	if (!condition) throw new Error(message);
}

export type Check = {
	module: string;
	path: SmokePath;
	/** Platforms the library exists on; on the other the check is a `skip` that says so. */
	only?: Os;
	run(os: Os): Promise<string> | string;
};

/** SHA-256 of "abc" (FIPS 180-2, appendix B.1). */
const sha256Abc = "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad";
const dummyDsn = "https://smoke0000@sentry.invalid/1";

export const checks: Check[] = [
	{
		module: "async-storage",
		path: "js",
		run: async () => {
			const AsyncStorage = (require("@react-native-async-storage/async-storage") as typeof import("@react-native-async-storage/async-storage")).default;
			const key = "svelte-smoke";
			const value = `value-${Date.now()}`;
			await AsyncStorage.setItem(key, value);
			const read = await AsyncStorage.getItem(key);
			await AsyncStorage.removeItem(key);
			expect(read === value, `read back ${JSON.stringify(read)}`);
			return "setItem, getItem, removeItem round trip";
		},
	},
	{
		module: "mmkv",
		path: "js",
		run: () => {
			// By its name, as an app's own code would import it: Metro resolves it to the library's copy (the library carries MMKV, VENDORING.md), which is what the check is for. The types are the library's re-export.
			const { createMMKV } = require("react-native-mmkv") as typeof import("@alfayez/svelte-native/mmkv");
			const storage = createMMKV({ id: "svelte-smoke" });
			storage.set("key", "value");
			const read = storage.getString("key");
			const removed = storage.remove("key");
			expect(read === "value" && removed, `read back ${JSON.stringify(read)}, remove ${removed}`);
			return "createMMKV, set, getString, remove (Nitro hybrid object)";
		},
	},
	{
		module: "secure-store",
		path: "js",
		run: async () => {
			const SecureStore = require("expo-secure-store") as typeof import("expo-secure-store");
			const key = "svelte-smoke";
			await SecureStore.setItemAsync(key, "secret");
			const read = await SecureStore.getItemAsync(key);
			await SecureStore.deleteItemAsync(key);
			const gone = await SecureStore.getItemAsync(key);
			expect(read === "secret" && gone === null, `read ${JSON.stringify(read)}, after delete ${JSON.stringify(gone)}`);
			return "setItemAsync, getItemAsync, deleteItemAsync";
		},
	},
	{
		module: "netinfo",
		path: "js",
		run: async () => {
			const NetInfo = (require("@react-native-community/netinfo") as typeof import("@react-native-community/netinfo")).default;
			// The library's reachability probe is a fetch to Google; off, fetch() only reads the platform's connection state.
			NetInfo.configure({ reachabilityShouldRun: () => false });
			const state = await NetInfo.fetch();
			expect(typeof state.type === "string" && typeof state.isConnected !== "undefined", `state ${JSON.stringify(state)}`);
			return `fetch() type ${state.type}, connected ${String(state.isConnected)} (reachability probe off)`;
		},
	},
	{
		module: "device-info",
		path: "js",
		run: async () => {
			const DeviceInfo = require("react-native-device-info") as typeof import("react-native-device-info");
			const version = DeviceInfo.getVersion();
			const model = DeviceInfo.getModel();
			const bundle = DeviceInfo.getBundleId();
			const name = await DeviceInfo.getDeviceName();
			expect(version.length > 0 && model.length > 0 && bundle.length > 0, `version ${version}, model ${model}, bundle ${bundle}`);
			return `getVersion ${version}, getModel ${model}, getBundleId ${bundle}, getDeviceName ${name.length > 0 ? "answered" : "empty"}`;
		},
	},
	{
		module: "expo-device",
		path: "js",
		run: async () => {
			const Device = require("expo-device") as typeof import("expo-device");
			const type = await Device.getDeviceTypeAsync();
			expect(typeof Device.modelName === "string" && Device.isDevice !== undefined, `modelName ${String(Device.modelName)}`);
			return `modelName ${Device.modelName}, osName ${Device.osName} ${Device.osVersion}, isDevice ${Device.isDevice}, getDeviceTypeAsync ${type}`;
		},
	},
	{
		module: "get-random-values",
		path: "js+direct",
		run: () => {
			// Importing the library installs `crypto.getRandomValues`; its own JavaScript then prefers ExpoCrypto when `expo` is present (2.x), so
			// that call alone would not reach its module. RNGetRandomValues is called by name for that.
			require("react-native-get-random-values");
			const crypto = (globalThis as { crypto?: { getRandomValues?: (array: Uint8Array) => Uint8Array } }).crypto;
			expect(typeof crypto?.getRandomValues === "function", "crypto.getRandomValues is not installed");
			const filled = new Uint8Array(16);
			crypto?.getRandomValues?.(filled);
			const module = turboModule<{ getRandomBase64(byteLength: number): string }>("RNGetRandomValues");
			const bytes = decodeBase64(module.getRandomBase64(16));
			expect(bytes.length === 16 && looksRandom(bytes), `RNGetRandomValues gave ${bytes.length} bytes: ${hex(bytes)}`);
			expect(looksRandom(filled), `crypto.getRandomValues left ${hex(filled)}`);
			return "RNGetRandomValues.getRandomBase64(16) decoded to 16 random bytes; crypto.getRandomValues(Uint8Array(16)) filled";
		},
	},
	{
		module: "quick-crypto",
		path: "js",
		run: () => {
			// By its name, as an app's own code would import it: Metro resolves it to the library's copy (the library carries quick-crypto, VENDORING.md), which is what the check is for.
			const { createHash, randomBytes } = require("react-native-quick-crypto") as { createHash(algorithm: string): { update(data: string): { digest(encoding: "hex"): string } }; randomBytes(size: number): Uint8Array };
			const random = randomBytes(16);
			const digest = createHash("sha256").update("abc").digest("hex");
			expect(random.length === 16 && looksRandom(random), `randomBytes(16) gave ${hex(random)}`);
			expect(digest === sha256Abc, `sha256("abc") gave ${digest}`);
			return `randomBytes(16) and createHash("sha256") of "abc" = ${digest.slice(0, 16)}… as expected`;
		},
	},
	{
		module: "quick-base64",
		path: "js",
		run: () => {
			// The library's copy too, by the name Metro resolves.
			const base64 = require("react-native-quick-base64") as { fromByteArray(bytes: Uint8Array): string; toByteArray(text: string): Uint8Array; atob(text: string): string; btoa(text: string): string };
			const text = "Svelte Native";
			const encoded = base64.fromByteArray(ascii(text));
			const decoded = String.fromCharCode(...base64.toByteArray(encoded));
			expect(encoded === "U3ZlbHRlIE5hdGl2ZQ==" && decoded === text && base64.atob(base64.btoa(text)) === text, `encoded ${encoded}, decoded ${decoded}`);
			return `fromByteArray "${text}" = ${encoded}, toByteArray and atob(btoa()) round trip`;
		},
	},
	{
		module: "nitro",
		path: "js",
		run: () => {
			// The Nitro runtime is the library's copy too (VENDORING.md): the name is resolved by Metro, and the type is what this check reads of it (no app installs the package for its types).
			const { NitroModules } = require("react-native-nitro-modules") as { NitroModules: { version: string; buildType: string; getAllHybridObjectNames(): string[] } };
			const names = NitroModules.getAllHybridObjectNames();
			expect(typeof NitroModules.version === "string" && NitroModules.version.length > 0, `version ${String(NitroModules.version)}`);
			return `core ${NitroModules.version} (${NitroModules.buildType}), ${names.length} hybrid objects registered: ${names.slice(0, 6).join(", ")}${names.length > 6 ? ", …" : ""}`;
		},
	},
	{
		module: "launch-arguments",
		path: "js",
		run: () => {
			const { LaunchArguments } = require("react-native-launch-arguments") as typeof import("react-native-launch-arguments");
			const value = LaunchArguments.value();
			expect(typeof value === "object" && value !== null, `value() gave ${String(value)}`);
			return `value() answered with ${Object.keys(value).length} launch argument(s)`;
		},
	},
	{
		module: "localization",
		path: "js",
		run: () => {
			const Localization = require("expo-localization") as typeof import("expo-localization");
			const locales = Localization.getLocales();
			const calendars = Localization.getCalendars();
			expect(locales.length > 0 && typeof locales[0]?.languageTag === "string", `locales ${JSON.stringify(locales)}`);
			return `getLocales ${locales.map((locale) => locale.languageTag).join(", ")}; getCalendars ${calendars.map((calendar) => calendar.calendar).join(", ")}`;
		},
	},
	{
		module: "constants",
		path: "js",
		run: () => {
			const Constants = (require("expo-constants") as typeof import("expo-constants")).default;
			const config = Constants.expoConfig;
			expect(config !== null && typeof config.slug === "string", `expoConfig ${JSON.stringify(config)}`);
			return `expoConfig slug ${config?.slug}, name ${config?.name}, version ${config?.version}`;
		},
	},
	{
		module: "asset",
		path: "js",
		run: () => {
			const { Asset } = require("expo-asset") as typeof import("expo-asset");
			const { requireOptionalNativeModule } = require("expo-modules-core") as typeof import("expo-modules-core");
			// fromURI builds the descriptor; nothing is downloaded.
			const asset = Asset.fromURI("https://assets.invalid/smoke.png");
			const native = requireOptionalNativeModule("ExpoAsset");
			expect(asset.uri === "https://assets.invalid/smoke.png" && !asset.downloaded, `asset ${asset.uri} downloaded ${asset.downloaded}`);
			expect(native !== null, "the native module ExpoAsset is not registered");
			return "Asset.fromURI (no download); native module ExpoAsset registered";
		},
	},
	{
		module: "haptics",
		path: "js",
		run: async () => {
			const Haptics = require("expo-haptics") as typeof import("expo-haptics");
			await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
			return "impactAsync(Light) resolved";
		},
	},
	{
		module: "screen-orientation",
		path: "js",
		run: async () => {
			const ScreenOrientation = require("expo-screen-orientation") as typeof import("expo-screen-orientation");
			const orientation = await ScreenOrientation.getOrientationAsync();
			expect(typeof orientation === "number", `orientation ${String(orientation)}`);
			return `getOrientationAsync ${ScreenOrientation.Orientation[orientation]}`;
		},
	},
	{
		module: "store-review",
		path: "js",
		run: async () => {
			const StoreReview = require("expo-store-review") as typeof import("expo-store-review");
			const available = await StoreReview.isAvailableAsync();
			expect(typeof available === "boolean", `isAvailableAsync gave ${String(available)}`);
			return `isAvailableAsync ${available} (requestReview not called)`;
		},
	},
	{
		module: "system-ui",
		path: "js",
		run: async () => {
			const SystemUI = require("expo-system-ui") as typeof import("expo-system-ui");
			// Set to what it already is, so the screen does not change.
			const current = await SystemUI.getBackgroundColorAsync();
			await SystemUI.setBackgroundColorAsync(current);
			return `getBackgroundColorAsync ${String(current)}, setBackgroundColorAsync resolved`;
		},
	},
	{
		module: "tracking-transparency",
		path: "js",
		run: async () => {
			const TrackingTransparency = require("expo-tracking-transparency") as typeof import("expo-tracking-transparency");
			const permission = await TrackingTransparency.getTrackingPermissionsAsync();
			expect(typeof permission.status === "string", `permission ${JSON.stringify(permission)}`);
			return `getTrackingPermissionsAsync ${permission.status}, granted ${permission.granted} (no prompt)`;
		},
	},
	{
		module: "local-authentication",
		path: "js",
		run: async () => {
			const LocalAuthentication = require("expo-local-authentication") as typeof import("expo-local-authentication");
			const hardware = await LocalAuthentication.hasHardwareAsync();
			expect(typeof hardware === "boolean", `hasHardwareAsync gave ${String(hardware)}`);
			return `hasHardwareAsync ${hardware} (authenticateAsync not called)`;
		},
	},
	{
		module: "notifications",
		path: "js",
		run: async () => {
			const Notifications = require("expo-notifications") as typeof import("expo-notifications");
			const permission = await Notifications.getPermissionsAsync();
			expect(typeof permission.status === "string", `permission ${JSON.stringify(permission)}`);
			return `getPermissionsAsync ${permission.status}, canAskAgain ${permission.canAskAgain} (no prompt, no token)`;
		},
	},
	{
		module: "location",
		path: "js",
		run: async () => {
			const Location = require("expo-location") as typeof import("expo-location");
			const permission = await Location.getForegroundPermissionsAsync();
			expect(typeof permission.status === "string", `permission ${JSON.stringify(permission)}`);
			return `getForegroundPermissionsAsync ${permission.status}, canAskAgain ${permission.canAskAgain} (no prompt, no fix)`;
		},
	},
	{
		module: "sharing",
		path: "js",
		run: async () => {
			const Sharing = require("expo-sharing") as typeof import("expo-sharing");
			const available = await Sharing.isAvailableAsync();
			expect(typeof available === "boolean", `isAvailableAsync gave ${String(available)}`);
			return `isAvailableAsync ${available} (shareAsync not called)`;
		},
	},
	{
		module: "web-browser",
		path: "js",
		only: "android",
		run: async () => {
			const WebBrowser = require("expo-web-browser") as typeof import("expo-web-browser");
			const browsers = await WebBrowser.getCustomTabsSupportingBrowsersAsync();
			if (browsers.browserPackages.length === 0) return skip("no browser with Custom Tabs support is installed");
			const warm = await WebBrowser.warmUpAsync();
			const cool = await WebBrowser.coolDownAsync();
			return `warmUpAsync ${String(warm.servicePackage)}, coolDownAsync ${String(cool.servicePackage)}`;
		},
	},
	{
		module: "splash-screen",
		path: "js",
		run: async () => {
			const SplashScreen = require("expo-splash-screen") as typeof import("expo-splash-screen");
			await SplashScreen.hideAsync();
			return "hideAsync resolved (the engine hid the splash after the first commit)";
		},
	},
	{
		module: "ssl-pinning",
		path: "js",
		run: () => {
			const { isSslPinningAvailable } = require("react-native-ssl-public-key-pinning") as typeof import("react-native-ssl-public-key-pinning");
			expect(isSslPinningAvailable() === true, "isSslPinningAvailable() is false: the native module is not linked");
			return "isSslPinningAvailable() true (initializeSslPinning not called)";
		},
	},
	{
		module: "firebase",
		path: "js",
		run: async () => {
			const { getApp } = require("@react-native-firebase/app") as typeof import("@react-native-firebase/app");
			const { getAnalytics, setAnalyticsCollectionEnabled } = require("@react-native-firebase/analytics") as typeof import("@react-native-firebase/analytics");
			const { getMessaging, isDeviceRegisteredForRemoteMessages } = require("@react-native-firebase/messaging") as typeof import("@react-native-firebase/messaging");
			const app = getApp();
			await setAnalyticsCollectionEnabled(getAnalytics(app), false);
			const registered = await isDeviceRegisteredForRemoteMessages(getMessaging(app));
			expect(app.name === "[DEFAULT]", `app name ${app.name}`);
			return `getApp().name ${app.name}; analytics setAnalyticsCollectionEnabled(false) resolved; messaging isDeviceRegisteredForRemoteMessages ${registered} (no token fetch, fake google-services)`;
		},
	},
	{
		module: "sentry",
		path: "direct",
		run: async () => {
			// The library's JavaScript client needs React-side integrations; this is the native half it drives, disabled so that nothing is sent.
			const sentry = turboModule<{
				initNativeSdk(options: object): Promise<boolean>;
				captureEnvelope(bytes: string, options: { hardCrashed: boolean }): Promise<boolean>;
				fetchNativeRelease(): Promise<{ id: string; version: string; build: string }>;
			}>("RNSentry");
			const initialized = await sentry.initNativeSdk({ dsn: dummyDsn, enabled: false, enableAutoSessionTracking: false, sendClientReports: false, enableNativeCrashHandling: false });
			const release = await sentry.fetchNativeRelease();
			const event = JSON.stringify({ message: "Svelte Native smoke test", level: "info" });
			const header = JSON.stringify({ event_id: "00000000000000000000000000000000", sent_at: new Date(0).toISOString() });
			const envelope = `${header}\n${JSON.stringify({ type: "event", length: event.length })}\n${event}\n`;
			const captured = await sentry.captureEnvelope(encodeBase64(ascii(envelope)), { hardCrashed: false });
			expect(initialized === true && captured === true, `initNativeSdk ${String(initialized)}, captureEnvelope ${String(captured)}`);
			return `RNSentry.initNativeSdk (dummy DSN, enabled false), fetchNativeRelease ${release.id} ${release.version}, captureEnvelope of a message resolved (SDK disabled: nothing sent)`;
		},
	},
	{
		module: "hms",
		path: "js+direct",
		only: "android",
		run: () => {
			const hms = require("@hmscore/react-native-hms-location") as Record<string, unknown>;
			const Device = require("expo-device") as typeof import("expo-device");
			const registered = hmsNativeModules.filter((name) => nativeModule(name) !== undefined);
			const outcome = hmsOutcome(Device.manufacturer, registered);
			if (outcome.status === "fail") throw new Error(`${outcome.detail} (exports: ${Object.keys(hms).join(", ")})`);
			// Success only where HMS Core is: elsewhere the library is linked and its calls cannot be made, which `gates.json` lists as an expected skip.
			return outcome.status === "ok" ? outcome.detail : skip(outcome.detail);
		},
	},
	{
		module: "intercom",
		path: "js+direct",
		run: () => {
			// Not initialized: the SDK's network behavior is not ours to turn off. Loading the library reads the native module's constants.
			const intercom = require("@intercom/intercom-react-native") as typeof import("@intercom/intercom-react-native");
			// The unread-count event is the one both native modules export; the window show/hide names are iOS-only constants and
			// read undefined on Android (the library's `IntercomEvents` maps them anyway).
			const unread = intercom.IntercomEvents.IntercomUnreadCountDidChange;
			expect(typeof unread === "string" && unread.length > 0, `IntercomEvents ${JSON.stringify(intercom.IntercomEvents)}`);
			expect(typeof intercom.default.initialize === "function", "the JavaScript API has no initialize");
			const named = Object.values(intercom.IntercomEvents).filter((name) => typeof name === "string" && name.length > 0);
			return `loaded, native constants answered: ${named.length} event names (${unread}, …); initialize not called`;
		},
	},
	{
		module: "statsig",
		path: "js",
		run: async () => {
			const { StatsigClientRN } = require("@statsig/react-native-bindings") as typeof import("@statsig/react-native-bindings");
			const client = new StatsigClientRN("client-smoke0000000000000000000000000000000", { userID: "svelte-smoke" }, { networkConfig: { preventAllNetworkTraffic: true }, loggingEnabled: "disabled" });
			try {
				client.initializeSync();
				const gate = client.checkGate("svelte_smoke_gate");
				expect(gate === false, `checkGate gave ${String(gate)}`);
			} finally {
				await client.shutdown();
			}
			return "StatsigClientRN initializeSync and checkGate with all network traffic and logging off";
		},
	},
	{
		module: "mixpanel",
		path: "js",
		run: async () => {
			const { Mixpanel } = require("mixpanel-react-native") as typeof import("mixpanel-react-native");
			expect(nativeModule("MixpanelReactNative") !== undefined, "the native module MixpanelReactNative is not registered (the library would fall back to its JavaScript mode)");
			const mixpanel = new Mixpanel("smoke00000000000000000000000000", false);
			// Opted out from the start: the SDK tracks and sends nothing.
			await mixpanel.init(true);
			// The iOS SDK applies the opt-out default on its tracking queue after `initialize` returns (MixpanelInstance.swift: "optOutTracking() runs
			// async on trackingQueue, so hasOptedOutTracking() may not reflect the default yet"), so the first answer can still be false: ask again, for up to two seconds.
			let optedOut = await mixpanel.hasOptedOutTracking();
			for (let attempt = 0; attempt < 20 && optedOut !== true; attempt++) {
				await new Promise<void>((resolve) => setTimeout(resolve, 100));
				optedOut = await mixpanel.hasOptedOutTracking();
			}
			const distinctId = await mixpanel.getDistinctId();
			expect(optedOut === true && typeof distinctId === "string" && distinctId.length > 0, `optedOut ${String(optedOut)}, distinctId ${String(distinctId)}`);
			return "native init with the opt-out default on, hasOptedOutTracking true, getDistinctId answered";
		},
	},
	{
		module: "adjust",
		path: "js",
		run: async () => {
			// Not initialized: initSdk sends the install to Adjust. getSdkVersion is the SDK's static answer.
			const { Adjust } = require("react-native-adjust") as typeof import("react-native-adjust");
			const version = await new Promise<string>((resolve) => {
				Adjust.getSdkVersion((value) => resolve(value ?? ""));
			});
			expect(typeof version === "string" && version.length > 0, `getSdkVersion gave ${JSON.stringify(version)}`);
			return `getSdkVersion ${version}; initSdk not called`;
		},
	},
	{
		module: "check-installed-apps",
		path: "js",
		run: async (os) => {
			const { checkInstalledApps } = require("expo-check-installed-apps") as typeof import("expo-check-installed-apps");
			const targets = os === "android" ? ["com.android.vending", "com.huawei.appmarket"] : ["mailto", "https"];
			const found = await checkInstalledApps(targets);
			expect(targets.every((target) => typeof found[target] === "boolean"), `answer ${JSON.stringify(found)}`);
			return `checkInstalledApps ${JSON.stringify(found)}`;
		},
	},
	{
		module: "live-direction",
		path: "js",
		run: () => {
			// `auto` is what the production app loads: it patches I18nManager (with the production app's pnpm patch) and reads the native direction.
			const liveDirection = require("react-native-live-direction/auto") as { getDirection(): string; subscribe?: unknown };
			const direction = liveDirection.getDirection();
			expect(direction === "ltr" || direction === "rtl", `getDirection gave ${String(direction)}`);
			expect(typeof liveDirection.subscribe === "function", "auto did not install I18nManager.subscribe");
			return `getDirection ${direction}, I18nManager.subscribe installed`;
		},
	},
];
