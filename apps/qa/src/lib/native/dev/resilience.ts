import { File, Paths } from "expo-file-system";
import { qaModule, type BuildIdentity } from "./qa.ts";

/**
 * The iOS side of `native-qa resilience --platform ios` (`apps/qa/qa`, "Resilience on the iPhone"). An XCUITest drives the whole run
 * (rotation, Dynamic Type and language by launch argument, the Home button, ending the process) and cannot ask the app anything while it
 * runs, so the app says one thing, once, at the start: which build it is, so the harness can tell that the run measured the build it was
 * meant to. `run=resilience&token=<text>` writes it to `Documents/resilience.json` and does nothing else; the XCUITest then opens the
 * screens menu over the lab page, as the Android run does.
 */
export type ResilienceIdentity = { schema: 1; token: string | null; build: BuildIdentity | null; startedAt: string; jsErrors: number };

export async function writeResilienceIdentity(token: string | null, jsErrors: number): Promise<void> {
  const build = qaModule?.enabled ? await qaModule.buildIdentity() : null;
  const identity: ResilienceIdentity = { schema: 1, token, build, startedAt: new Date().toISOString(), jsErrors };
  new File(Paths.document, "resilience.json").write(JSON.stringify(identity));
}
