import { type ComputedStyle, type Rect, type Size } from "./fabric/dom-style.js";
import type { AnimationOptions, Keyframe } from "./fabric/keyframes.js";
export type { AnimationOptions, Keyframe } from "./fabric/keyframes.js";
/**
 * The React Native props the host builds from a host node's attributes (`peekProps()`): the host calls this itself, so what it returns is what a node sends to the native view (its `style` is the
 * style of its `class` under its own). For tests and the QA lab, which read a mounted node's resolved props.
 */
export { mergeHostProps } from "./native-props.js";
type Listener = (...args: unknown[]) => void;
export type Snapshot = {
    props: Readonly<Record<string, unknown>>;
    children: readonly NativeNode[];
    text: string;
};
/** An attribute value on an element that also has a spread: a function is boxed, anything else passes. The same function always gives the same box, so an unchanged ref is not set again. */
export declare function hostValue<T>(value: T): T;
/**
 * `class` on a lowered tag: `lower.ts` writes `nativeClass={hostClass(...)}` for `class` and `class:name` on `<View>`, `<Text>`, ..., because
 * Svelte would join a `class` attribute into a string the host drops. The style is worked out here, in the element's template effect, so
 * what the class resolver reads (the color scheme, the window) is tracked there, as for a component (`createNativeProps`); the host puts it under
 * the element's own style (`mergeHostProps`). `style` is that style, which `lower.ts` passes when the tag has one: the font size it sets is what a font-relative
 * line height is made from.
 */
export declare function hostClass(value: unknown, style?: unknown): unknown;
/**
 * What `{...props}` sends to Svelte: a copy in which every function Svelte would drop is boxed, and a `class` is its style (`hostClass`),
 * with the toggles of the element's `class:name` directives (`lower.ts`).
 */
export declare function hostSpread<T extends object>(props: T, toggles?: Record<string, unknown>): T;
/**
 * The spread of an HTML element the lowering turned into a host tag (`lower-html.ts`): `hostSpread`, and a web handler name in the props is the native one (`onclick` is
 * `onPress`), so `<div {...rest}>` presses when its parent gave `rest` an `onclick`, as a browser's does. The style of a `class` in it keeps its font-relative values
 * for the host, as `hostHtmlClass` does.
 */
export declare function hostWebSpread<T extends object>(props: T, toggles?: Record<string, unknown>): T;
/**
 * The same for an element whose press does something by itself (a `<button>` submits its form, an `<a>` follows its `href`): that is `onPress`, and the spread's `onclick` must not replace
 * it, so it is `onHtmlClick`, which `hostClick` runs (before what the press does, as a browser runs a handler before the default action).
 */
export declare function hostWebClickSpread<T extends object>(props: T, toggles?: Record<string, unknown>): T;
/** `hostClass` for a lowered HTML element: the font-relative values of the class (a `leading-6`'s line height) stay in the style for the host, which knows the font size the element inherits (`fabric/text-inherit.ts`). */
export declare function hostHtmlClass(value: unknown, style?: unknown): unknown;
/** The `src` of an HTML `<img>` as the `source` of a native image: a string is its `uri`; a source object and an asset module (what Metro makes of an `import`) already are one. */
export declare function hostSource(value: unknown): unknown;
/**
 * The host tag of the tag a `<svelte:element this={tag}>` is given when the app runs, by the table the lowering reads (`html-tags.ts`): `h2` is a text, `div` a view. A host tag
 * (`native-view`) is as it is; no tag (`undefined`, `false`) is no element; a tag that has no host tag (an `input` is a component, a `table` has no equivalent) is an error that names it.
 */
export declare function hostTag(tag: unknown): unknown;
/** What `nativeHtml` is for the tag of a `<svelte:element>` that is worked out when the app runs: `"inline"` for a text element that flows in a line (`span`, `b`, ...), as the lowering marks the ones it reads. */
export declare function hostInline(tag: unknown): true | "inline";
/**
 * What `oninput` and `onchange` of an `<input>` get, in the shape a browser's event has for the fields web code reads: `currentTarget.value` (`.checked` for a checkbox) and
 * `target`, with the `name`, `id` and `type` the element has. The text, or the state of the switch, is what the native control reported.
 */
export declare function hostInputEvent(type: "input" | "change", value: unknown, element?: {
    name?: string;
    id?: string;
    type?: string;
}): {
    type: "input" | "change";
    target: {
        checked: boolean;
        name?: string;
        id?: string;
        type?: string;
    } | {
        value: unknown;
        name?: string;
        id?: string;
        type?: string;
    };
    currentTarget: {
        checked: boolean;
        name?: string;
        id?: string;
        type?: string;
    } | {
        value: unknown;
        name?: string;
        id?: string;
        type?: string;
    };
    preventDefault(): void;
    stopPropagation(): void;
};
/**
 * A press, as a click: the handler gets the event with a `preventDefault` that works, then the handlers a spread's `onclick` gave (`hostWebClickSpread`), and what the press does by itself (a
 * link's navigation, a button's form submission) happens after them unless one called `preventDefault`. The event is the press event itself otherwise (`currentTarget` is the element).
 */
export declare function hostClick(event: unknown, handler: ((event: unknown) => void) | undefined | null, after?: (event: unknown) => void): void;
/** The `href` of the element a press came from (an `<a>`'s, which stays an attribute of it, so one from a spread is there too): a string, or nothing. */
export declare function hostHref(event: unknown): string | undefined;
/**
 * What a `<button>` does after its press when it is a submit button (no `type`, or `type="submit"`: the element's own `type`, so one from a spread counts), or what Enter in a
 * single-line input does (`force`, unless its key press was prevented): the nearest `<form>` above the element that gave the event (a lowered `<form>` has `nativeForm`, which the
 * element tree knows however the components are put together) hears `submit`, with `target` and `currentTarget` the form and `submitter` the element. With no form above, nothing happens.
 */
export declare function hostSubmit(event: unknown, force?: boolean): void;
/**
 * What `onkeydown` and `onkeyup` of an `<input>` get: the key (`"Enter"`, `"a"`, `"Backspace"`) of the native key press, in the shape of a browser's event. `preventDefault` on the
 * key press of Enter stops the submission it would make.
 */
export declare function hostKeyEvent(type: "keydown" | "keyup", event: unknown): {
    type: "keydown" | "keyup";
    key: string | undefined;
    nativeEvent: {
        key?: string;
    } | undefined;
    target: unknown;
    currentTarget: unknown;
    preventDefault(): void;
    stopPropagation(): void;
};
/**
 * The `ref` of a `bind:this={target}` of the lowering: the variable gets the host handle, and `null` only if it still holds this one when the element goes away. `keys` are the computed
 * keys of the target (`els[i]` has `[i]`), read where the attribute is, so the `ref` is made again when one changes (the host then gives the old one `null` and the new one the
 * handle, as Svelte's own `bind:this` follows its target) and `set` and `get` act on the target the keys named when it was made, not on the one they name now.
 */
export declare function hostBind(set: (keys: unknown[], value: unknown) => void, get: (keys: unknown[]) => unknown, keys?: unknown[]): (handle: unknown) => void;
export { hostStyleProps } from "./html-style.js";
/**
 * Why a node must be committed again. `animation`: what the node's transitions draw changed (`fabric/transitions.ts`), and only in paint (opacity, transforms,
 * colours), so the layout of the committed tree is still right: a layout read (`getBoundingClientRect`) does not commit it first.
 */
export type Invalidation = "props" | "children" | "text" | "animation";
/** The host (see `fabric/`) hears every change through this sink. */
export declare function setInvalidationSink(sink: ((node: NativeNode, reason: Invalidation) => void) | null): void;
/**
 * The members of a Web Animations `Animation` that Svelte's transitions and `animate:` use: they set `onfinish` and `effect`, read `playState` and `currentTime`, and call `cancel()`.
 * What plays one is the host (`fabric/transitions.ts`).
 */
export interface NativeAnimation {
    /** Called once, on the JS thread, when the animation has run its length. Never after `cancel()`. */
    onfinish: ((event?: unknown) => void) | null;
    /** Svelte sets it to null after `cancel()` (to let Chromium free the effect); nothing reads it. */
    effect: unknown;
    readonly playState: "idle" | "running" | "finished";
    /** Milliseconds since the animation started, including its delay; the length once it has finished; null once cancelled. */
    readonly currentTime: number | null;
    /** Stops it, takes its effect off the node (the node goes back to its own style) and never calls `onfinish`. */
    cancel(): void;
}
/** What the host plays a node's animations with, and measures a node by. Installed by `startSurface`. */
export interface AnimationDriver {
    animate(node: NativeNode, keyframes: readonly Keyframe[], options: AnimationOptions): NativeAnimation;
    getAnimations(node: NativeNode): NativeAnimation[];
    /** The node's box in the window as `getBoundingClientRect` reports it: from the tree the host has committed (what is pending is committed first), with the node's own transform, which an animation may be drawing. Null when the node has no view yet. */
    layout(node: NativeNode): Rect | null;
    /** The node's own size, before any transform (`clientWidth`, `clientHeight`, a computed `width`). Null when the node has no view yet. */
    size(node: NativeNode): Size | null;
    /** A node's animations are over and its own values are back: the host lets go of what Reanimated remembers of the node's last animated values (`fabric/animation.ts`, `forgetAnimatedValues`). */
    forget(node: NativeNode): void;
}
export declare function setAnimationDriver(driver: AnimationDriver | null): void;
/** What plays when there is no host (a tree built without a surface): nothing moves, and the animation finishes at once, so a transition's outro still ends and its node still goes. */
export declare class InstantAnimation implements NativeAnimation {
    onfinish: ((event?: unknown) => void) | null;
    effect: unknown;
    playState: "idle" | "running" | "finished";
    currentTime: number | null;
    constructor();
    cancel(): void;
}
/** What a node keeps for the DOM-like surface Svelte's transitions use. */
export type DomState = {
    /** What was written to `node.style` (`overflow`, `position`, `width`, `height`, `transform`), as CSS text. */
    inline: Record<string, string> | null;
    shim: InlineStyle | null;
    /** The host's record of the animations playing on the node (`fabric/transitions.ts`). */
    animation: object | null;
};
/**
 * `node.style`, as far as Svelte writes it: `overflow` (a transition that clips), and `position`, `width`, `height`, `transform` (`animate:` takes a leaving item out of the flow and
 * keeps it where it was). A write is kept on the node and applied over its own style by the host (`applyInlineStyle`); an empty string removes it, as on the DOM.
 */
export declare class InlineStyle {
    private readonly node;
    constructor(node: NativeNode);
    getPropertyValue(name: string): string;
    setProperty(name: string, value: string | number | null): void;
    removeProperty(name: string): string;
}
export interface InlineStyle {
    overflow: string;
    position: string;
    width: string;
    height: string;
    transform: string;
}
/**
 * The host hears of a `ref` (the attribute, or the one in `nativeProps` a component hands its view) when the element is in a tree that is on a surface: the moment it is set if it is, and
 * the moment it gets there if not (Svelte sets the attributes of an element while it builds the subtree it is in, and links the subtree into the screen after). The handle is given then, so
 * `onMount` and effects find it, and not a microtask later, when the host builds the view (`fabric/host.ts`, `earlyRef`). An element that is in no screen yet (what a `fork()` builds
 * off screen, `router.prepare`) hears nothing until it is: a screen that is dropped never calls its refs.
 */
export declare function setRefSink(sink: ((node: NativeNode) => void) | null): void;
/**
 * The host hears every node taken out of its parent. Svelte removes the top node of a destroyed block this way and moves a node by unlinking and linking it
 * again, so a node that is unlinked is only a candidate for being gone: the host looks again when its flush has run.
 */
export declare function setUnlinkSink(sink: ((node: NativeNode) => void) | null): void;
/**
 * One node of the Svelte host tree. Children form a doubly linked list, so the renderer's
 * sibling queries, inserts and keyed moves are O(1). The host reads an immutable snapshot
 * that is rebuilt lazily after a change.
 */
export declare class NativeNode {
    readonly kind: "element" | "fragment" | "text" | "comment";
    readonly name: string;
    readonly id: number;
    parent: NativeNode | null;
    firstChild: NativeNode | null;
    lastChild: NativeNode | null;
    previousSibling: NativeNode | null;
    nextSibling: NativeNode | null;
    /** Created with the first listener (`addEventListener`): most nodes, every text and every static view, never get one. */
    listeners: Map<string, Set<Listener>>;
    private dispatchers;
    private props;
    /** The current `props` object went out in a snapshot or was handed in whole: the next change copies it first. */
    private propsShared;
    private text;
    /** What the host keeps for this node (`fabric/host.ts`): a field, not a WeakMap lookup on every flush. */
    hostState: unknown;
    /** The host's own root of a surface: the one node it hears about before it has built anything under it. */
    surfaceRoot: boolean;
    /** Created by the first animation or write to `style`: most nodes never have one. */
    dom: DomState | null;
    /** How many nodes of this subtree (this one too) have a `ref` that the host has not heard of, because the subtree is in no screen yet (`giveRefs`). */
    waiting: number;
    /** This node's `ref` is one of those. */
    refWaits: boolean;
    private children;
    private childrenStale;
    private snapshot;
    constructor(kind: "element" | "fragment" | "text" | "comment", name?: string, text?: string);
    /** The current state as one object; a new object appears only after a change. */
    getSnapshot(): Snapshot;
    /** The attributes as they are now, for a reader that copies what it needs and keeps no reference (no snapshot is built). */
    peekProps(): Readonly<Record<string, unknown>>;
    get textValue(): string;
    hasProp(key: string): boolean;
    getProp(key: string): unknown;
    /** Sets one attribute. A snapshot already handed out keeps the object it saw, so a shared object is copied before the write; consecutive writes to a fresh element change one object. */
    setProp(key: string, value: unknown): void;
    removeProp(key: string): void;
    /** A stable function per event type, so host props keep their identity between flushes. */
    dispatcher(type: string): Listener;
    setProps(props: Readonly<Record<string, unknown>>): void;
    setText(text: string): void;
    childrenChanged(): void;
    /** The node's DOM state, made at the first use. */
    domState(): DomState;
    /** `element.style`: the inline style Svelte's transitions write (`InlineStyle`). */
    get style(): InlineStyle;
    /** One inline style property; an empty value removes it. The host sees the change. */
    setInline(name: string, value: string): void;
    /** `element.inert`: Svelte makes an element inert for the length of its outro, so it takes no clicks while it leaves. On a native node that is `pointerEvents: "none"`, over the node's own. */
    get inert(): boolean;
    set inert(value: boolean);
    /** `element.animate(keyframes, options)`: plays on the UI thread through Reanimated (`fabric/transitions.ts`); see `NativeAnimation`. */
    animate(keyframes: readonly Keyframe[], options?: AnimationOptions): NativeAnimation;
    /** `element.getAnimations()`: the animations that have not been cancelled. */
    getAnimations(): NativeAnimation[];
    /** The node's box as `getBoundingClientRect` gives it: layout from the tree the host has committed (pending changes are committed first), with what a running animation moves. Zeros for a node with no view. */
    getBoundingClientRect(): DOMRectReadOnly;
    get clientWidth(): number;
    get clientHeight(): number;
    /** The node's animations are over and its own values are back (`fabric/transitions.ts`): the host lets go of what Reanimated remembers of the node's last animated values. */
    forgetAnimated(): void;
    /** `transition:draw` asks an SVG path for its length; a native element has none, so the transition has nothing to draw (its other properties still play). */
    getTotalLength(): number;
    /** Svelte's `flip` asks for the zoom: a native view has none, and answering here keeps it from walking up the parents. */
    get currentCSSZoom(): number;
    /** What `getComputedStyle(node)` returns for this node. */
    computedStyle(): ComputedStyle;
    /** Calls the listeners of `event.type`, as `dispatchEvent` does (`introstart`, `introend`, `outrostart`, `outroend` reach `onintrostart={...}` this way). */
    dispatchEvent(event: {
        type: string;
    }): boolean;
    /** Drops the cached snapshot and reports the change to the host. */
    invalidate(reason?: Invalidation): void;
}
declare const renderer: {
    createFragment(): NativeNode;
    createElement(name: string): NativeNode;
    createTextNode(data: string): NativeNode;
    createComment(data: string): NativeNode;
    nodeType(node: NativeNode): keyof {
        fragment: any;
        element: any;
        text: any;
        comment: any;
    };
    getNodeValue(node: NativeNode): string | null;
    getAttribute(element: NativeNode, name: string): string | null;
    setAttribute(element: NativeNode, key: string, value: any): void;
    removeAttribute(element: NativeNode, name: string): void;
    hasAttribute(element: NativeNode, name: string): boolean;
    setText(node: NativeNode, text: string): void;
    getFirstChild(element: NativeNode): NativeNode | null;
    getLastChild(element: NativeNode): NativeNode | null;
    getNextSibling(node: NativeNode): NativeNode | null;
    insert(parent: NativeNode, element: NativeNode, anchor: NativeNode | null): void;
    remove(node: NativeNode): void;
    getParent(element: NativeNode): NativeNode | null;
    addEventListener(target: NativeNode, type: string, handler: any, options?: any): void;
    removeEventListener(target: NativeNode, type: string, handler: any, options?: any): void;
};
export default renderer;
