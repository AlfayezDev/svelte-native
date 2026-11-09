import { appVariantOf, type Variant } from "./variant.ts";

/**
 * The shell lines that prebuild the iOS project on the Mac, in `apps/qa` of its checkout. `ios/` is generated and shared by
 * the variants (the checkout is copied without it), and an Expo prebuild over an existing project keeps what an earlier one wrote
 * (the smoke app's `ios.useFrameworks: "static"` in `Podfile.properties.json`), so a prebuild for another variant, or after one
 * that did not finish, starts from nothing (`--clean`). The marker is removed before the prebuild and written after it, so a failed
 * one leaves none. [log] is where the prebuild writes.
 */
export function iosPrebuildLines(variant: Variant, log: string): string[] {
	const marker = "ios/.native-qa-variant";
	return [
		`if [ "$(cat ${marker} 2>/dev/null)" = '${variant}' ]; then CLEAN=''; else CLEAN='--clean'; fi`,
		`rm -f ${marker}`,
		`APP_VARIANT='${appVariantOf[variant]}' npx expo prebuild --platform ios $CLEAN > '${log}' 2>&1 || { tail -n 20 '${log}'; exit 1; }`,
		`printf '%s\\n' '${variant}' > ${marker}`,
	];
}
