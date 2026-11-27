// The server only knows a remote module that is part of its graph: a native-only module has no web page importing it, so the server imports it here.
import "./lib/api.remote.ts";
// Remote modules a test copies into src/lib/lab (the QA app's lab server module, tests/kit/remote-lab.test.ts).
import.meta.glob("./lib/lab/*.remote.ts", { eager: true });
