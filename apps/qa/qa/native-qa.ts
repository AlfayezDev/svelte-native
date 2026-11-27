import { a11y } from "./commands/a11y.ts";
import { boot } from "./commands/boot.ts";
import { build } from "./commands/build.ts";
import { gates } from "./commands/gates.ts";
import { foreign } from "./commands/foreign.ts";
import { gestures } from "./commands/gestures.ts";
import { hold } from "./commands/hold.ts";
import { iosProbe } from "./commands/ios-probe.ts";
import { lab } from "./commands/lab.ts";
import { parity } from "./commands/parity.ts";
import { product } from "./commands/product.ts";
import { report } from "./commands/report.ts";
import { resilience } from "./commands/resilience.ts";
import { smoke } from "./commands/smoke.ts";
import { updates } from "./commands/updates.ts";
import { crashes } from "./soak/crashes.ts";
import { soak } from "./soak/soak.ts";
import { symbolicate } from "./soak/symbolicate.ts";

const usage = `usage: native-qa <command> [flags]

  build  [--abi x86_64|arm64-v8a] [--prebuild] [--variant qa|smoke] [--updates-channel qa]   (a channel build is the QA app)
  build  --platform ios --mac <user@host> --mac-checkout <dir> [--build-script <path on the Mac>] [--variant qa|smoke]
  lab    --device <serial> [--apk <path> | --no-install] [--repeat <n>] [--run checks,quick] [--timeout <s>]
  boot   --device <serial> [--apk <path> | --no-install] [--warm <n>] [--cold <n>] [--idle <s>]
  lab | boot | parity | a11y  --platform ios --device <devicectl id> --mac <user@host> [--udid <hardware UDID>] [--app <.app on the Mac> | --no-install] [--package <bundle id>]   (NATIVE_QA_MAC replaces --mac; --udid defaults to the lab phone's, for xcodebuild and the USB check)
  soak   --device <serial> [--apk <path> | --no-install] [--minutes 10] [--interval <s>] [--parts <names>]
  crashes --device <serial> [--apk <path> | --no-install] [--starts 1000] [--suites 100] [--idle <s>] [--map <file>] [--symbols <dir>] [--chunk <n>] [--resume] [--inject-crash]
  symbolicate [--input <logcat file>] [--map <file>] [--symbols <dir>] [--abi x86_64] [--all]
  parity --device <serial> [--apk <path> | --no-install] [--update | --missing] [--quick] [--filter <screen>] [--chunk <n> | --limit <n>] [--resume] [--fresh]
  a11y   --device <serial> [--apk <path> | --no-install] [--quick] [--filter <screen>] [--chunk <n> | --limit <n>] [--resume] [--fresh]
         (--chunk <n>: the run as commands of --limit n cases, each on a fresh emulator (--fresh) continuing the run file (--resume); --limit ends with status 3 when cases are left)
  resilience --device <serial> [--apk <path> | --no-install] [--rotations <n>] [--cycles <n>] [--rounds <n>] [--font-cycles <n>] [--only <groups>]
  resilience --platform ios --device <devicectl id> --mac <user@host> [--udid <hardware UDID>] [--team <id>] [--rebuild] [--build-only] [--rotations <n>] [--cycles <n>] [--rounds <n>] [--timeout <s>] [--assume-system-kill]
  smoke  --device <serial> [--apk <path> | --no-install] [--timeout <s>]      (the smoke app: build --variant smoke first)
  smoke  --platform ios --device <devicectl id> --mac <user@host> [--udid <hardware UDID>] [--app <.app on the Mac> | --no-install] [--timeout <s>]
  gestures --device <serial> [--apk <path> | --no-install] [--input adb|qa|both] [--run box,row,...] [--repeat <n>] [--timeout <s>]
  gestures --platform ios --device <devicectl id> --mac <user@host> [--udid <hardware UDID>] [--team <id>] [--rebuild] [--run ...] [--repeat <n>] [--timeout <s>] [--trace] [--collect <token of a test that ran>]
  foreign --device <serial> [--apk <path> | --no-install] [--only <libraries>] [--attempts <n>] [--timeout <s>]
  foreign --platform ios --device <devicectl id> --mac <user@host> [--udid <hardware UDID>] [--app <.app on the Mac> | --no-install] [--only <libraries>] [--timeout <s>]
  probe  --platform ios --device <devicectl id> --mac <user@host> [--udid <hardware UDID>] [--probes <names>] [--direction ltr|rtl]
  updates --device <serial> [--apk <channel build>] [--baseline-apk <path> | --no-baseline] [--channel qa] [--warm <n>] [--max-launches <n>] [--settle <n>] [--faults boot,mount,effect] [--eas "<command>"] [--environment <eas environment>] [--reset app|data] [--dexopt profile|none] [--package <id>]
  product --device <serial> [--apk <path> | --no-install] [--dexopt profile|none]      (the product boot check on the lab emulator: build --variant production first)
  hold   --device <serial> [--wait <seconds>] -- <command...>   (the emulator lock held across the commands: a CI lane, a sequence of runs)
  report
  gates  [--platform android|ios] [--all] [--smoke] [--runs lab,parity,...] [--except lab.runs,...] [--markdown <file>]`;

const [command, ...rest] = process.argv.slice(2);

const commands: Record<string, (argv: string[]) => Promise<void>> = {
	build,
	lab,
	boot,
	soak,
	crashes,
	symbolicate,
	parity,
	a11y,
	resilience,
	smoke,
	gestures,
	foreign,
	updates,
	product,
	hold,
	probe: iosProbe,
	report: async () => report(),
	gates,
};

const run = command ? commands[command] : undefined;
if (!run) {
	console.error(usage);
	process.exit(command === "help" || command === "--help" ? 0 : 2);
}
try {
	await run(rest);
} catch (error) {
	console.error(error instanceof Error ? error.message : String(error));
	process.exit(1);
}
