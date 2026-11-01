// A config plugin for the smoke app only: makes its iOS project signable by an iOS Personal Team, the team the QA iPhone's builds use.
//
// A Personal Team cannot sign an app with the Push Notifications or the In-App Purchase capability, and Xcode's automatic signing asks
// for both of them for this app (the first iOS smoke builds failed at provisioning, before any code compiled):
// - Push: `expo-notifications` adds the `aps-environment` entitlement. The smoke test never registers for remote notifications; its
//   notifications check reads the permission state and its Firebase check asks `isDeviceRegisteredForRemoteMessages`, which both
//   answer without the entitlement.
// - In-App Purchase: `@config-plugins/react-native-adjust` links `StoreKit.framework` into the app target, and Xcode turns linked StoreKit
//   into that capability. Adjust's pod links StoreKit (weakly) itself, through the pods' xcconfig, so the app target does not need it.
//
// Expo runs the mods of the last listed plugin first, so this plugin is listed before both: its mods then run after theirs.
const { IOSConfig, withEntitlementsPlist, withXcodeProject } = require("@expo/config-plugins");

/** @param {string | undefined} name */
function requiredProjectName(name) {
	if (!name) throw new Error("smoke-personal-team: the Xcode project has no name");
	return name;
}

/** @param {import("@expo/config-types").ExpoConfig} config */
module.exports = (config) => {
	config = withEntitlementsPlist(config, (entitlements) => {
		delete entitlements.modResults["aps-environment"];
		return entitlements;
	});
	return withXcodeProject(config, (project) => {
		const target = IOSConfig.XcodeUtils.getApplicationNativeTarget({ project: project.modResults, projectName: requiredProjectName(project.modRequest.projectName) });
		project.modResults.removeFramework("StoreKit.framework", { target: target.uuid });
		return project;
	});
};
