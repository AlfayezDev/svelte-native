// Run by compile-error-metro.test.ts under Node: what a developer reads when the package's transformer fails a file. The file goes to a worker the way Metro's go (jest-worker, a process of its
// own), the error the worker threw comes back through jest-worker's serialization, Metro's own `WorkerFarm` makes the error it reports of it (a `TransformError`, with the Babel path when the
// error has a `loc` and the generic one when not: `WorkerFarm.transform`), and the terminal prints it as `@expo/cli`'s `MetroTerminalReporter._logBundlingError` and Metro's `TerminalReporter`
// do (their lines are repeated below, with where they are).
import { createRequire } from "node:module";
import { join } from "node:path";

const require = createRequire(import.meta.url);
const { Worker } = require("jest-worker") as { Worker: new (file: string, options: object) => { transform(filename: string, src: string, root: string): Promise<string>; end(): Promise<unknown> } };
const WorkerFarm = require("@expo/metro/metro/DeltaBundler/WorkerFarm") as { default: { prototype: Record<string, (error: unknown, filename: string) => unknown> } };
const farm = Object.create(WorkerFarm.default.prototype) as Record<string, (error: unknown, filename: string) => unknown>;

type Reported = Error & { type?: string; snippet?: string; lineNumber?: number; column?: number; filename?: string };
/** What the terminal shows for an error Metro reports. */
function printed(error: Reported): string {
  // @expo/cli build/src/start/server/metro/MetroTerminalReporter.js, `_logBundlingError`: Metro drops the stack of a SyntaxError (a TransformError is one), which hid Babel plugins' errors; this puts it back as the message.
  if (error.snippet == null && error.stack != null && error instanceof SyntaxError) {
    error.message = error.stack;
    delete (error as { stack?: string }).stack;
  }
  // metro build `lib/TerminalReporter.js`, `_logBundlingError`.
  let message = error.message;
  if (!(error instanceof SyntaxError) && error.snippet == null && error.stack != null) message = error.stack;
  const { filename } = error;
  if (filename?.length && !message.includes(filename)) message += ` [${filename}]`;
  if (error.snippet != null) message += `\n${error.snippet}`;
  return message;
}

type Case = { filename: string; src: string; root: string };
const cases = JSON.parse(process.argv[2] as string) as Case[];
const worker = new Worker(join(import.meta.dirname, "compile-error-worker.cjs"), { exposedMethods: ["transform"], numWorkers: 1, enableWorkerThreads: false, forkOptions: { silent: true } });
const results = [];
for (const { filename, src, root } of cases) {
  try {
    await worker.transform(filename, src, root);
    results.push({ filename, failed: false });
  } catch (thrown) {
    // `WorkerFarm.transform`'s catch: an error with a `loc` is a Babel error, any other is a generic one.
    const error = ((thrown as { loc?: unknown }).loc ? farm._formatBabelError!(thrown, filename) : farm._formatGenericError!(thrown, filename)) as Reported;
    const { type, lineNumber, column, snippet } = error;
    results.push({ filename, failed: true, type, lineNumber, column, reportedFilename: error.filename, snippet, text: printed(error), thrownName: (thrown as Error).name, thrownCode: (thrown as { code?: string }).code });
  }
}
await worker.end();
console.log(JSON.stringify(results));
