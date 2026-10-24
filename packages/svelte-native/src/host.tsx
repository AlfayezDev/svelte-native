import { createElement, Fragment, memo, useCallback, useLayoutEffect, useState, useSyncExternalStore, type ComponentType, type ReactNode } from "react";
import { ActivityIndicator, Image, KeyboardAvoidingView, Modal, Pressable, ScrollView, Switch, Text, TextInput, View } from "react-native";
import { SafeAreaProvider, SafeAreaView } from "react-native-safe-area-context";
import { Screen, ScreenStack } from "react-native-screens";
import { mount, unmount, type Component } from "svelte";
import renderer, { NativeNode, type NativeReference } from "./renderer.ts";

const components = {
  "native-view": View,
  "native-text": Text,
  "native-input": TextInput,
  "native-pressable": Pressable,
  "native-scroll": ScrollView,
  "native-image": Image,
  "native-switch": Switch,
  "native-spinner": ActivityIndicator,
  "native-modal": Modal,
  "native-safe-area": SafeAreaView,
  "native-keyboard": KeyboardAvoidingView,
  "native-screen": Screen,
  "native-stack": ScreenStack,
};

const NativeBranch = memo(function NativeBranch({ node }: { node: NativeNode }): ReactNode {
  const snapshot = useSyncExternalStore(node.subscribe, node.getSnapshot);
  const attributes = snapshot.props.nativeProps;
  const suppliedRef = attributes && typeof attributes === "object" && "ref" in attributes ? attributes.ref : undefined;
  const ref = useCallback((reference: NativeReference | null) => {
    node.reference = reference;
    if (typeof suppliedRef === "function") suppliedRef(reference);
    else if (suppliedRef && typeof suppliedRef === "object" && "current" in suppliedRef) suppliedRef.current = reference;
  }, [node, suppliedRef]);
  if (node.kind === "comment") return null;
  if (node.kind === "text") {
    if (!snapshot.text.trim() && node.parent?.name !== "native-text") return null;
    return snapshot.text;
  }
  const children = snapshot.children
    .filter((child) => child.kind !== "comment" && (child.kind !== "text" || node.name === "native-text" || child.getSnapshot().text.trim()))
    .map((child) => createElement(NativeBranch, { node: child, key: child.id }));
  if (node.kind === "fragment") return createElement(Fragment, null, children);
  const Component = components[node.name as keyof typeof components];
  if (!Component) throw new Error(`Unsupported native element: ${node.name}`);
  const props: Record<string, unknown> = attributes && typeof attributes === "object" ? { ...attributes } : {};
  for (const [type, handlers] of node.listeners) {
    props[`on${type[0]?.toUpperCase()}${type.slice(1)}`] = (...args: unknown[]) => {
      for (const handler of handlers) handler(...args);
    };
  }
  props.ref = ref;
  // The registry is heterogeneous; each public Svelte primitive owns its RN prop type.
  return createElement(Component as ComponentType<Record<string, unknown>>, props, ...children);
});

export function createNativeApp<Props extends Record<string, unknown>>(App: Component<Props>, props: Props) {
  return function SvelteApplication() {
    const [root] = useState(() => new NativeNode("fragment"));
    useLayoutEffect(() => {
      const instance = mount(App, { target: root, renderer, props });
      return () => { void unmount(instance); };
    }, [root]);
    return createElement(SafeAreaProvider, null, createElement(NativeBranch, { node: root }));
  };
}
