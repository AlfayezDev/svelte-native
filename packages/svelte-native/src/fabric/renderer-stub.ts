/** Replaces React Native's `RendererProxy` on the Fabric entry: there is no React renderer, so nothing resolves a React instance. */
const unsupported = (name: string) => () => { throw new Error(`${name} needs the React renderer, which the Fabric entry does not load`); };
export const renderElement = unsupported("renderElement");
export const dispatchCommand = unsupported("dispatchCommand");
export const sendAccessibilityEvent = unsupported("sendAccessibilityEvent");
export const getNodeFromInternalInstanceHandle = unsupported("getNodeFromInternalInstanceHandle");
export const getPublicInstanceFromInternalInstanceHandle = unsupported("getPublicInstanceFromInternalInstanceHandle");
export const getPublicInstanceFromRootTag = unsupported("getPublicInstanceFromRootTag");
export const findHostInstance_DEPRECATED = (): null => null;
export const findNodeHandle = (): null => null;
export const isChildPublicInstance = (): boolean => false;
export const isProfilingRenderer = (): boolean => false;
