// The server only knows a remote module that is part of its graph: a native-only module has no web page importing it, so the server imports it here.
import "./lib/api.remote.ts";
