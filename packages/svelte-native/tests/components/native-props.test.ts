import { expect, test } from "bun:test";
import { mergeHostProps } from "../../src/native-props.ts";

test("host props merge direct attributes over nativeProps and leave out Svelte internals", () => {
  const ref = () => {};
  const onPress = () => {};
  expect(mergeHostProps({
    nativeProps: { testID: "legacy", accessible: true, style: { padding: 1 } },
    testID: "direct", nativeStyle: { padding: 2 }, style: "[object Object]", onPress, ref,
    children: () => {}, class: "x", id: "y", "data-id": "z", $$slots: {},
  })).toEqual({ testID: "direct", accessible: true, style: { padding: 2 }, onPress, ref });
  expect(mergeHostProps({ nativeProps: { style: { padding: 1 } }, style: { padding: 3 } }).style).toEqual({ padding: 3 });
  expect(mergeHostProps({ nativeProps: { ref: onPress }, ref: undefined }).ref).toBe(onPress);
  expect(mergeHostProps({})).toEqual({});
});

test("a lowered tag's press handlers (`nativeOnPress`...) are the props they stand for while they are functions, and none when they are not", () => {
  const go = () => {};
  const hold = () => {};
  expect(mergeHostProps({ nativeOnPress: go, nativeOnPressIn: go, nativeOnPressOut: go, nativeOnLongPress: hold, nativeOnPressChange: go })).toEqual({ onPress: go, onPressIn: go, onPressOut: go, onLongPress: hold, onPressChange: go });
  // `undefined` (an `onPress={enabled ? go : undefined}` that is not enabled) is no prop at all, and no key is left behind for the host to read as a handler.
  expect(mergeHostProps({ nativeOnPress: undefined, nativeOnLongPress: null, testID: "a" })).toEqual({ testID: "a" });
  // `nativeProps` has its own handler and the attribute has none: the object's stays; a function in the attribute wins over it.
  expect(mergeHostProps({ nativeProps: { onPress: go }, nativeOnPress: undefined })).toEqual({ onPress: go });
  expect(mergeHostProps({ nativeProps: { onPress: go }, nativeOnPress: hold })).toEqual({ onPress: hold });
});
