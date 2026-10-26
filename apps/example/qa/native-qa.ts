import { a11y } from "./commands/a11y.ts";
import { boot } from "./commands/boot.ts";
import { build } from "./commands/build.ts";
import { gates } from "./commands/gates.ts";
import { lab } from "./commands/lab.ts";
import { parity } from "./commands/parity.ts";
import { report } from "./commands/report.ts";
import { resilience } from "./commands/resilience.ts";
import { crashes } from "./soak/crashes.ts";
import { soak } from "./soak/soak.ts";
import { symbolicate } from "./soak/symbolicate.ts";

const usage = `usage: native-qa <command> [flags]

  build  [--abi x86_64|arm64-v8a] [--prebuild]
  lab    --device <serial> [--apk <path> | --no-install] [--repeat <n>] [--run checks,quick] [--timeout <s>]
  boot   --device <serial> [--apk <path> | --no-install] [--warm <n>] [--cold <n>] [--idle <s>]
  soak   --device <serial> [--apk <path> | --no-install] [--minutes 10] [--interval <s>] [--parts <names>]
  crashes --device <serial> [--apk <path> | --no-install] [--starts 1000] [--suites 100] [--idle <s>] [--map <file>] [--symbols <dir>] [--chunk <n>] [--resume] [--inject-crash]
  symbolicate [--input <logcat file>] [--map <file>] [--symbols <dir>] [--abi x86_64] [--all]
  parity --device <serial> [--apk <path> | --no-install] [--update | --missing] [--quick] [--filter <screen>]
  a11y   --device <serial> [--apk <path> | --no-install] [--quick] [--filter <screen>]
  resilience --device <serial> [--apk <path> | --no-install] [--rotations <n>] [--cycles <n>] [--rounds <n>]
  report
  gates  [--platform android|ios] [--all]`;

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
