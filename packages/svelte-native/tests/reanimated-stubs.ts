/** esbuild stubs for react-native-reanimated and react-native-worklets; every fake records its calls on `globalThis.__anim`. */
export type AnimLog = {
  descriptors: { id: number; adds: { tag: number; shadowNodeWrapper: object }[]; removes: number[] }[];
  mappers: { id: number; worklet: (forceUpdate?: boolean) => void; inputs: unknown[]; stopped: boolean }[];
  updates: { descriptors: unknown; values: Record<string, unknown>; animatedProps: boolean }[];
  css: { shadowNodeWrapper: object; viewTag: number; reactViewName: string; updates: Record<string, unknown>[]; cleaned: boolean }[];
  removable: object[];
  layoutConfigs?: { viewTag: number; type: number; config: unknown }[];
  inline?: unknown[];
};

const head = "const A = (globalThis.__anim ??= { descriptors: [], mappers: [], updates: [], css: [], removable: [] });";
const cssKey = "(k) => k.startsWith('animation') || k.startsWith('transition')";

export const reanimatedStubs: Record<string, string> = {
  "react-native-reanimated": `${head}
    export const makeMutable = (value) => ({ value, _isReanimatedSharedValue: true });
    export const isSharedValue = (v) => v?._isReanimatedSharedValue === true;
    export const startMapper = (worklet, inputs) => { const id = A.mappers.length + 1; A.mappers.push({ id, worklet, inputs, stopped: false }); return id; };
    export const stopMapper = (id) => { A.mappers.find((m) => m.id === id).stopped = true; };`,
  "react-native-reanimated/src/commonTypes": "export const LayoutAnimationType = { ENTERING: 1, EXITING: 2, LAYOUT: 3 };",
  // The colours of animated props are Reanimated's own function in the tests that look at them (`svg-colors.test.ts`).
  "react-native-reanimated/src/common/style/processors/colors": "export const processColorsInProps = () => {};",
  "react-native-reanimated/src/animationBuilder": "export const maybeBuild = (c) => (typeof c?.build === 'function' ? c.build() : c);",
  "react-native-reanimated/src/UpdateLayoutAnimations": `${head} export const updateLayoutAnimations = (viewTag, type, config) => { (A.layoutConfigs ??= []).push({ viewTag, type, config }); };`,
  "react-native-worklets": "export const makeShareable = (value) => value;",
  "react-native-reanimated/src/animation/util": "export const initialUpdaterRun = (updater) => updater();",
  "react-native-reanimated/src/updateProps": `${head} export const updateProps = (descriptors, values, isAnimatedProps) => { A.updates.push({ descriptors, values: { ...values }, animatedProps: isAnimatedProps === true }); };`,
  "react-native-reanimated/src/ViewDescriptorsSet": `${head}
    export const makeViewDescriptorsSet = () => {
      const entry = { id: A.descriptors.length + 1, adds: [], removes: [] };
      A.descriptors.push(entry);
      return { shareableViewDescriptors: { value: [], id: entry.id }, add: (d) => { entry.adds.push(d); }, remove: (tag) => { entry.removes.push(tag); }, has: () => true };
    };`,
  "react-native-reanimated/src/hook/utils": `
    export const isAnimated = () => false;
    export const shallowEqual = (a, b) => { const ak = Object.keys(a), bk = Object.keys(b); return ak.length === bk.length && ak.every((k) => a[k] === b[k]); };
    export const validateAnimatedStyles = (s) => { if (typeof s !== 'object' || Array.isArray(s)) throw new Error('has to return an object'); };`,
  "react-native-reanimated/src/css/platform": `${head}
    export class CSSManager {
      constructor(info) { this.entry = { ...info, updates: [], cleaned: false }; A.css.push(this.entry); }
      update(style) { this.entry.updates.push(style); }
      unmountCleanup() { this.entry.cleaned = true; }
    }`,
  "react-native-reanimated/src/css/native/proxy": `${head} export const markNodeAsRemovable = (wrapper) => { A.removable.push(wrapper); };`,
  "react-native-reanimated/src/css/utils": `
    const isCss = ${cssKey};
    export const filterCSSAndStyleProperties = (style) => { const rest = {}; for (const k in style) if (!isCss(k) && style[k] !== undefined) rest[k] = style[k]; return [null, null, null, null, rest]; };`,
  "react-native-reanimated/src/createAnimatedComponent/InlinePropManager": `
    const sv = (v) => v?._isReanimatedSharedValue === true;
    export const hasInlineStyles = (style) => !!style && Object.values(style).some(sv);
    export const getInlineStyle = (style, first) => { const out = {}; for (const k in style) { if (sv(style[k])) { if (first) out[k] = style[k].value; } else out[k] = style[k]; } return out; };
    export class InlinePropManager {
      attachInlineProps(component, info) {
        const log = (globalThis.__anim.inline ??= []);
        const shared = {}; for (const s of [].concat(component.props.style ?? [])) for (const k in s) if (sv(s[k])) shared[k] = s[k];
        log.push({ info, keys: Object.keys(shared) });
        this._inlinePropsViewDescriptors ??= { add: (d) => log.push({ add: d }) };
      }
      detachInlineProps() { (globalThis.__anim.inline ??= []).push("detached"); }
    }`,
};
