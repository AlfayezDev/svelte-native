import { assertEnvironment } from "./environment.ts";
import { requireOrigin } from "./config.ts";

/** Checks what a remote call needs, throwing the error that names what is missing (the host, or a global the engine lacks). Every remote function calls it first. */
export function assertReady(): void {
  assertEnvironment();
  requireOrigin();
}
