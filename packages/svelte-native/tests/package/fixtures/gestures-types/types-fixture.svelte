<script lang="ts">
  /* eslint-disable @typescript-eslint/no-unused-expressions -- reading a property is how this fixture checks that it exists and has its type */
  // Type-checked by `types.test.ts` (svelte-check): every builder method, the `gesture` attribute on each primitive and on host tags,
  // the sugar, and the exported types. Never run.
  import View from "../../../../src/components/View.svelte";
  import Text from "../../../../src/components/Text.svelte";
  import Pressable from "../../../../src/components/Pressable.svelte";
  import ScrollView from "../../../../src/components/ScrollView.svelte";
  import Image from "../../../../src/components/Image.svelte";
  import AnimatedView from "../../../../src/components/AnimatedView.svelte";
  import {
    Gesture, GestureDetector, GestureStateManager, gesture, State, Directions, PointerType, TouchEventType, ActionType, runOnJS, scheduleOnRN,
    type ComposedGesture, type GestureAttribute, type GestureStateChangeEvent, type GestureTouchEvent, type GestureUpdateEvent, type GestureStateManagerType, type GestureType,
    type PanGestureHandlerEventPayload, type TapGestureHandlerEventPayload, type PinchGestureHandlerEventPayload, type RotationGestureHandlerEventPayload,
    type LongPressGestureHandlerEventPayload, type FlingGestureHandlerEventPayload,
  } from "../../../../src/gestures/index.ts";

  const ref = { current: undefined as GestureType | undefined };
  const scroll = Gesture.Native().shouldActivateOnStart(true).disallowInterruption(true);
  const tap = Gesture.Tap().minPointers(1).numberOfTaps(2).maxDistance(10).maxDuration(250).maxDelay(200).maxDeltaX(5).maxDeltaY(5)
    .onBegin((e: GestureStateChangeEvent<TapGestureHandlerEventPayload>) => { e.x; })
    .onEnd((e, success) => { e.absoluteX; success satisfies boolean; });
  const pan = Gesture.Pan().activeOffsetX([-10, 10]).activeOffsetY(8).failOffsetX(5).failOffsetY([-5, 5]).minPointers(1).maxPointers(2).minDistance(4)
    .minVelocity(10).minVelocityX(1).minVelocityY(2).averageTouches(true).enableTrackpadTwoFingerGesture(true).activateAfterLongPress(300).manualActivation(true)
    .enabled(true).shouldCancelWhenOutside(false).hitSlop({ left: -20, vertical: 4 }).runOnJS(false).withRef(ref).withTestId("pan").cancelsTouchesInView(true)
    .onBegin(() => {}).onStart((e) => { e.state satisfies number; })
    .onUpdate((e: GestureUpdateEvent<PanGestureHandlerEventPayload>) => { e.translationX + e.translationY + e.velocityX; })
    .onChange((e) => { e.changeX + e.changeY; })
    .onEnd(() => {}).onFinalize((_event, success) => { success satisfies boolean; })
    .onTouchesDown((e: GestureTouchEvent, manager: GestureStateManagerType) => { e.allTouches[0]?.x; manager.activate(); manager.begin(); manager.fail(); manager.end(); })
    .onTouchesMove(() => {}).onTouchesUp(() => {}).onTouchesCancelled(() => {})
    .simultaneousWithExternalGesture(scroll, ref as never).requireExternalGestureToFail(scroll).blocksExternalGesture(scroll);
  const pinch = Gesture.Pinch().onUpdate((e: GestureUpdateEvent<PinchGestureHandlerEventPayload>) => { e.scale + e.focalX; }).onChange((e) => { e.scaleChange; });
  const rotate = Gesture.Rotation().onUpdate((e: GestureUpdateEvent<RotationGestureHandlerEventPayload>) => { e.rotation + e.anchorX; }).onChange((e) => { e.rotationChange; });
  const fling = Gesture.Fling().direction(Directions.LEFT | Directions.RIGHT).numberOfPointers(1).onEnd((e: GestureStateChangeEvent<FlingGestureHandlerEventPayload>) => { e.x; });
  const longPress = Gesture.LongPress().minDuration(400).maxDistance(10).numberOfPointers(1).onStart((e: GestureStateChangeEvent<LongPressGestureHandlerEventPayload>) => { e.duration; });
  const manual = Gesture.Manual().onTouchesDown((_e, manager) => { manager.activate(); });
  const hover = Gesture.Hover().onBegin(() => {});
  const composed: ComposedGesture = Gesture.Exclusive(Gesture.Race(tap, longPress), Gesture.Simultaneous(pinch, rotate), fling, manual, hover);
  const attribute: GestureAttribute = composed;
  const manager = GestureStateManager.create(1);
  manager.activate();
  State.ACTIVE satisfies number; PointerType.TOUCH satisfies number; TouchEventType.TOUCHES_DOWN satisfies number; ActionType.REANIMATED_WORKLET satisfies number;
  void runOnJS; void scheduleOnRN;
  void attribute;
</script>

<View gesture={pan} />
<Text gesture={tap}>text</Text>
<Pressable gesture={tap} />
<ScrollView gesture={scroll} />
<Image gesture={tap} source={{ uri: "x" }} />
<AnimatedView gesture={composed} />
<GestureDetector gesture={pan} style={{ width: 4 }}><Text>child</Text></GestureDetector>
<native-view gesture={pan} use:gesture={pan}></native-view>
<native-pressable gesture={tap}></native-pressable>
<native-scroll gesture={scroll}></native-scroll>
<native-text gesture={tap}></native-text>
<native-image gesture={tap}></native-image>
<native-animated-view gesture={composed}></native-animated-view>
<native-view gesture={undefined}></native-view>
