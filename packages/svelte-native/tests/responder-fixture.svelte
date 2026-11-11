<script>
  let { log, events } = $props();
  let pressed = $state(false);
  let slop = $state(0);
  export function setSlop(n) { slop = n; }
  export function isPressed() { return pressed; }
  export function removePress() { removed = true; }
  let removed = $state(false);
  const note = (name) => () => log(name);
</script>
<native-view testID="root">
  <native-pressable testID="a" onPress={note("a.press")} onPressIn={note("a.in")} onPressOut={note("a.out")} onLongPress={undefined} onPressChange={(v) => { pressed = v; log(`a.change ${v}`); }} hitSlop={slop}></native-pressable>
  <native-pressable testID="retained" pressRetentionOffset={100} onPress={note("retained.press")}></native-pressable>
  <native-pressable testID="rect" pressRectOffset={100} onPress={note("rect.press")}></native-pressable>
  <native-pressable testID="instant" minPressDuration={0} onPress={note("i.press")} onPressIn={note("i.in")} onPressOut={note("i.out")}></native-pressable>
  <native-pressable testID="evt" onPress={(e) => events.push(e)}></native-pressable>
  <native-pressable testID="lp" onPress={note("lp.press")} onLongPress={note("lp.long")} delayLongPress={300} onPressOut={note("lp.out")}></native-pressable>
  <native-pressable testID="lponly" onLongPress={note("lo.long")} onPress={removed ? undefined : note("lo.press")}></native-pressable>
  <native-view testID="outer" onPress={note("outer.press")}>
    <native-pressable testID="inner" onPress={note("inner.press")}></native-pressable>
    <native-pressable testID="innerDisabled" disabled={true} onPress={note("disabled.press")}></native-pressable>
  </native-view>
  <native-text testID="text" onPress={note("text.press")}>hello</native-text>
  <native-text testID="paragraph" onPress={note("paragraph.press")}>See <native-text testID="span" onPress={note("span.press")} onPressIn={note("span.in")} onPressOut={note("span.out")} onLongPress={undefined} onPressChange={(v) => log(`span.change ${v}`)} onTouchStart={note("span.touchStart")}>this link</native-text> here <native-text testID="plainSpan">plain</native-text> and <native-text testID="sibling" onPress={note("sibling.press")}>another</native-text></native-text>
  <native-text testID="evtParagraph" onPress={note("evtParagraph.press")}>Event <native-text testID="evtSpan" onPress={(e) => events.push(e)}>span</native-text></native-text>
  <native-text testID="holder">Hold <native-text testID="longSpan" onPress={note("longSpan.press")} onLongPress={note("longSpan.long")} delayLongPress={300}>this</native-text></native-text>
  <native-text testID="outerLink" onPress={note("outerLink.press")}><native-text testID="innerBold">bold <native-text testID="innerDeep">deeper</native-text></native-text> then <native-text testID="innerLink" onPress={note("innerLink.press")}>inner <native-text testID="innerLinkBold">bold</native-text></native-text></native-text>
  <native-view testID="plain"></native-view>
  <native-view testID="custom" onStartShouldSetResponder={() => true} onResponderGrant={note("custom.grant")} onResponderMove={note("custom.move")} onResponderRelease={note("custom.release")} onResponderTerminate={note("custom.terminate")} onTouchStart={note("custom.touchStart")}></native-view>
  <native-view testID="thiefA" onMoveShouldSetResponder={() => true} onResponderGrant={note("thiefA.grant")}>
    <native-view testID="victimA" onStartShouldSetResponder={() => true} onResponderTerminate={note("victimA.terminate")}></native-view>
  </native-view>
  <native-view testID="thiefB" onMoveShouldSetResponder={() => true} onResponderGrant={note("thiefB.grant")}>
    <native-view testID="victimB" onStartShouldSetResponder={() => true} onResponderTerminationRequest={() => false} onResponderTerminate={note("victimB.terminate")} onResponderMove={note("victimB.move")}></native-view>
  </native-view>
  <native-view testID="captor" nativeProps={{ onStartShouldSetResponderCapture: () => true }} onResponderGrant={note("captor.grant")}>
    <native-pressable testID="captured" onPress={note("captured.press")}></native-pressable>
  </native-view>
</native-view>
