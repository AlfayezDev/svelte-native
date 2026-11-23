/** Replaces React Native's `RendererProxy` on the Fabric entry: there is no React renderer, so nothing resolves a React instance. */
const unsupported = (name: string) => () => { throw new Error(`${name} needs the React renderer, which the Fabric entry does not load`); };
type Handle = { dispatchCommand(name: string, args: unknown[]): void };
/**
 * React Native's command helpers (`Commands.blur(ref)` of a native component, which `Keyboard.dismiss()` sends to the focused text input) are
 * given an element's handle (`fabric/host.ts`), not a React instance: the handle sends the command to its view.
 */
export function dispatchCommand(handle: unknown, command: string, args: readonly unknown[] = []): void {
  if (handle === null || typeof handle !== "object" || typeof (handle as Partial<Handle>).dispatchCommand !== "function") {
    throw new Error("dispatchCommand needs the handle of an element (its ref): React instances need the React renderer, which the Fabric entry does not load");
  }
  (handle as Handle).dispatchCommand(command, [...args]);
}
export const renderElement = unsupported("renderElement");
export const sendAccessibilityEvent = unsupported("sendAccessibilityEvent");
export const getNodeFromInternalInstanceHandle = unsupported("getNodeFromInternalInstanceHandle");
export const getPublicInstanceFromInternalInstanceHandle = unsupported("getPublicInstanceFromInternalInstanceHandle");
export const getPublicInstanceFromRootTag = unsupported("getPublicInstanceFromRootTag");
export const findHostInstance_DEPRECATED = (): null => null;
export const findNodeHandle = (): null => null;
export const isChildPublicInstance = (): boolean => false;
export const isProfilingRenderer = (): boolean => false;
