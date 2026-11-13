<script lang="ts">
  import { Text, View } from "@alfayez/svelte-native";
  const probe = globalThis as unknown as { __htmlInherit: Record<string, unknown> };
  let color = $state("white");
  let big = $state(true);
  probe.__htmlInherit = {
    setColor: (value: string) => { color = value; },
    setBig: (value: boolean) => { big = value; },
  };
</script>

<!-- Text style set on an element with HTML in it reaches the text below it. A View (and a Text) from the package neither gives nor stops it. -->
<div testID="outer" style={{ color, fontSize: 20 }}>
  Bare text
  <section testID="inner" style="font-weight: 700; line-height: 1.5">
    <View testID="rn-view">
      <p testID="deep">Deep</p>
    </View>
    <p testID="own" style={{ color: "red" }}>Own</p>
  </section>
  <Text testID="rn-text">React Native text</Text>
  <input testID="field" />
</div>
<View testID="rn-parent" style={{ color: "blue" }}><p testID="rn-child">Child of a View</p></View>
<button testID="button" class="bg-blue text-white">Save</button>
<div testID="sized" class={big ? "text-lg" : "text-sm"}>
  <p testID="relative" class="leading-snug">Relative</p>
  <div class="leading-snug"><p testID="relative-deep">Relative deep</p></div>
  <p testID="inherited-factor">Factor</p>
</div>
<div style="font-size: 10px"><p testID="inline-relative" style="line-height: 2">Inline</p></div>
