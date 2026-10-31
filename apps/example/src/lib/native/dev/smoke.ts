/* eslint-disable @typescript-eslint/no-require-imports -- every library is required inside its own check: nothing of the smoke test is evaluated until it runs, and only the QA app links the libraries */
import Platform from "react-native/Libraries/Utilities/Platform";
import { nativeModule, turboModule } from "@rasheed/svelte-native/native-modules";
import { ascii, decodeBase64, encodeBase64, hex, looksRandom } from "./smoke-bytes.ts";
import { formatSmokeLine, formatSmokeSummary, smokeLaunch, type SmokePath, type SmokeResult, type SmokeResultsFile } from "./smoke-log.ts";

/**
 * The native module smoke test (SPEC.md, "Native modules (smoke test)"): one core call for each native library the production
 * app uses, made from Svelte Native without React. Each check requires its library when it runs, calls it once, and reports
 * `ok`, `fail` or `skip` with the path it took: `js` (the library's own JavaScript API), `direct` (its TurboModule or
 * NativeModule by name, when its JavaScript needs React or reaches another module than the one under test). Nothing here asks
 * for a permission, prompts, or touches the network: permission checks read the state, Firebase's collection and token fetches
 * are off (`firebase.json`), Sentry and Statsig run disabled, Intercom and Adjust are not initialized.
 *
 * Only the QA app (`io.rasheed.svelteqa`) links these libraries. The product leaves them out of autolinking (app.config.ts), and
 * the lab that runs this is off there (`nativeLabEnabled`), so this file is never evaluated in the product.
 */
export type Os = "android" | "ios";

/** A check that did not apply: the reason is the detail of its `skip`. Tagged by name, not by class: `instanceof` on a transpiled Error subclass is not dependable. */
const skipName = "SmokeSkip";
const skip = (reason: string): never => {
	const error = new Error(reason);
	error.name = skipName;
	throw error;
};
function expect(condition: boolean, message: string): void {
	if (!condition) throw new Error(message);
}

type Check = {
	module: string;
	path: SmokePath;
	/** Platforms the library exists on; on the other the check is a `skip` that says so. */
	only?: Os;
	run(os: Os): Promise<string> | string;
};

const timeoutMs = 10_000;

function pause(milliseconds: number): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

/** A check that never settles (a native call that lost its promise) fails after `timeoutMs` instead of hanging the run. */
async function settled<T>(work: Promise<T> | T): Promise<T> {
	let timer: ReturnType<typeof setTimeout> | undefined;
	const limit = new Promise<never>((_resolve, reject) => {
		timer = setTimeout(() => reject(new Error(`no answer after ${timeoutMs / 1000} s`)), timeoutMs);
	});
	try {
		return await Promise.race([Promise.resolve(work), limit]);
	} finally {
		clearTimeout(timer);
	}
}

/** SHA-256 of "abc" (FIPS 180-2, appendix B.1). */
const sha256Abc = "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad";
const dummyDsn = "https://smoke0000@sentry.invalid/1";

const checks: Check[] = [
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
			const { createMMKV } = require("react-native-mmkv") as typeof import("react-native-mmkv");
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
			const { createHash, randomBytes } = require("react-native-quick-crypto") as typeof import("react-native-quick-crypto");
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
			const base64 = require("react-native-quick-base64") as typeof import("react-native-quick-base64");
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
			const { NitroModules } = require("react-native-nitro-modules") as typeof import("react-native-nitro-modules");
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
			const natives = ["HMSFusedLocation", "HMSLocationKit", "HMSGeofence", "HMSGeocoder", "HMSActivityIdentification"].filter((name) => nativeModule(name) !== undefined);
			expect(natives.length > 0, `loaded (${Object.keys(hms).join(", ")}) but no HMS native module is registered`);
			return skip(`loaded, ${natives.length} native modules registered (${natives.join(", ")}); the calls need HMS Core, which only Huawei devices have`);
		},
	},
	{
		module: "samsung-pay",
		path: "js",
		only: "android",
		run: () => {
			const SamsungPay = require("expo-samsung-pay") as Record<string, unknown>;
			const { requireOptionalNativeModule } = require("expo-modules-core") as typeof import("expo-modules-core");
			const native = requireOptionalNativeModule("ExpoSamsungPay");
			expect(native !== null, "the native module ExpoSamsungPay is not registered");
			return `loaded, native module ExpoSamsungPay registered (exports: ${Object.keys(SamsungPay).join(", ")}); canMakePayments not called`;
		},
	},
	{
		module: "intercom",
		path: "js+direct",
		run: () => {
			// Not initialized: the SDK's network behavior is not ours to turn off. Loading the library reads the native module's constants.
			const intercom = require("@intercom/intercom-react-native") as typeof import("@intercom/intercom-react-native");
			const events = Object.values(intercom.IntercomEvents);
			expect(events.length > 0 && events.every((name) => typeof name === "string" && name.length > 0), `IntercomEvents ${JSON.stringify(intercom.IntercomEvents)}`);
			expect(typeof intercom.default.initialize === "function", "the JavaScript API has no initialize");
			return `loaded, native constants answered: ${events.length} event names (${events[0]}, …); initialize not called`;
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
			const optedOut = await mixpanel.hasOptedOutTracking();
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

/** Every module id the test reports, in run order; `qa/gates.json` pins the same list. */
export const smokeModules: readonly string[] = checks.map((check) => check.module);

const platform = (): Os => (Platform.OS === "ios" ? "ios" : "android");

async function runCheck(check: Check, os: Os): Promise<SmokeResult> {
	const started = Date.now();
	const result = (status: SmokeResult["status"], path: SmokePath, detail: string): SmokeResult => ({ module: check.module, status, path, ms: Date.now() - started, detail });
	if (check.only !== undefined && check.only !== os) return result("skip", "none", `${check.only === "android" ? "Android" : "iOS"} only: the library has no ${os === "ios" ? "iOS" : "Android"} code`);
	try {
		return result("ok", check.path, await settled(check.run(os)));
	} catch (error) {
		if (error instanceof Error && error.name === skipName) return result("skip", check.path, error.message);
		const detail = error instanceof Error ? `${error.name}: ${error.message}` : String(error);
		return result("fail", check.path, detail);
	}
}

/** `Documents/smoke-results.json`: what an iPhone harness reads, since it cannot follow a log. The Android harness reads logcat and ignores it. */
function saveResults(results: readonly SmokeResult[], os: Os): void {
	try {
		const { File, Paths } = require("expo-file-system") as typeof import("expo-file-system");
		const file: SmokeResultsFile = { token: smokeLaunch.token, finishedAt: new Date().toISOString(), os, results: [...results] };
		new File(Paths.document, "smoke-results.json").write(JSON.stringify(file));
	} catch (error) {
		console.error("[Svelte smoke] results file", error);
	}
}

/**
 * Runs every check in turn, logging one `[Svelte smoke]` line as each finishes and `[Svelte smoke] complete` at the end (what
 * `native-qa smoke` reads from logcat). `onResult` sees each result as it arrives; an aborted run stops between checks.
 */
export async function runSmoke(onResult?: (result: SmokeResult, all: readonly SmokeResult[]) => void, signal?: AbortSignal): Promise<SmokeResult[]> {
	const os = platform();
	const results: SmokeResult[] = [];
	for (const check of checks) {
		if (signal?.aborted) break;
		const result = await runCheck(check, os);
		results.push(result);
		console.info(formatSmokeLine(result));
		onResult?.(result, results);
		await pause(0);
	}
	saveResults(results, os);
	console.info(formatSmokeSummary(results, os));
	return results;
}
