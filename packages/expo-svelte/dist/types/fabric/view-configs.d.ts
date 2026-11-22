/**
 * Static view configs and the prop payload builder for the views the Fabric host mounts itself.
 *
 * React Native encodes props for Fabric from a view config's `validAttributes` (which keys are native props and how a
 * value is converted) through `ReactNativeAttributePayload`. Loading that module and the native components that register
 * the configs costs about 50 ms of boot, so the host's own view names carry the tables below, equal to what React Native
 * 0.88 registers on Android and iOS (`tests/renderer/view-configs.test.ts` compares them with React Native's own modules). A name
 * outside the tables, from a third-party native component, takes React Native's registry and payload code, required on
 * first use.
 *
 * The payload holds only native props: style arrays are flattened (a later entry wins), conversions run (colours become
 * ARGB integers), functions become `true`, and an update carries the keys whose encoded value changed, `null` for a removed
 * one. React Native's nested-array diff repeats a key that moved between style entries without changing; this builder
 * compares the flattened result, so it omits such a key, and the native side ends with the same props.
 */
export type Platform = "android" | "ios";
export type Payload = Record<string, unknown>;
type Props = Record<string, unknown>;
type Converter = (value: unknown) => unknown;
/** `true` sends the value as given, a function converts it first, and a table (`style`) holds attributes of its own. */
type Attribute = true | Converter | Table;
interface Table {
    [name: string]: Attribute;
}
export type ViewConfig = {
    readonly attributes: Table;
    /** The registration name of every event the view emits, by native event type (`topChange` to `onChange`). */
    readonly events: ReadonlyMap<string, string>;
    /** Taken from React Native's registry: its own payload code applies. */
    readonly foreign: boolean;
};
/** `processColor` for a platform: the ARGB integer a native view takes for a colour prop (an Android integer is signed). */
export declare function processColorValue(color: unknown, platform: Platform): unknown;
/**
 * What a view adds to `RCTView`'s attributes and events. `assetSources` are attributes React Native resolves through
 * `resolveAssetSource`; `colorLists` hold an array of colours (a gradient's `colors`, converted one by one); `colorStructs`
 * name the colour field of each struct in an array attribute (Lottie's `colorFilters` are `{ keypath, color }`).
 */
export type Kind = {
    plain?: string;
    colors?: string;
    events?: string;
    assetSources?: string;
    colorLists?: string;
    colorStructs?: Record<string, string>;
    /**
     * A view manager without codegen (`requireNativeComponent`), which iOS mounts through React Native's legacy interop layer. The interop gives the
     * native view an event block only for an event prop that is sent as `true` (`RCTComponentData`'s event setter), and React Native's own config for
     * such a view lists every event as a prop on iOS (`ViewConfigIgnore.js`, `ConditionallyIgnoredEventHandlers`); without the prop the view's
     * block stays nil and its events are never sent. Android's managers emit their events without a prop, and a codegen component's emitter is
     * created with the view, so on iOS only these kinds carry their events as attributes.
     */
    legacy?: boolean;
};
/**
 * Describes a native component the host cannot list statically, for both platforms: an Expo module's view, whose
 * attributes and events the native module reports at run time (`fabric/foreign.ts`). A later definition of the same name replaces the first.
 */
export declare function defineViewKind(name: string, kind: Kind): void;
/** The config of a Fabric view component on a platform: the static table for the host's own views, else React Native's registry entry. */
export declare function viewConfigFor(name: string, platform: Platform): ViewConfig;
/** The payload for a new Fabric node: every native prop, encoded; `null` when there is none. */
export declare function createPayload(props: Props, config: ViewConfig): Payload | null;
/** The payload for a cloned node: the native props whose value changed, `null` for each one that went away; `null` when nothing did. */
export declare function diffPayload(previous: Props, next: Props, config: ViewConfig): Payload | null;
export {};
