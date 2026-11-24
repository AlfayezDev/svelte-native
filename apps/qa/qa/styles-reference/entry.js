// The reference of the box styles lab (qa/README "Box styles"): a plain React Native app. It draws the tiles of `src/lib/native/dev/styles-cases.ts` with React Native's own
// views (ReactViewGroup and the drawables of BackgroundStyleApplicator), where the lab page draws them with the engine, so the two can be laid side by side on the emulator.
// It is the QA app's native build with this file as the JavaScript bundle (`qa/styles-reference/build.sh`): the engine is installed by the Svelte host's first commit,
// which this app never makes, so React Native's own mounting draws every view.
//
// It reads the deep link the lab page is opened with: `?mode=shadow|border|origin|uniform|rect|views` (the same tiles), `&top=<dp>`, the space above the grid, so the grid starts where the
// lab page's does and both sit on the same pixel grid, and `&runtime=on|off`, the state of the input below the grid in `shadow`.
import "react-native/Libraries/Core/InitializeCore";
import * as React from "react";
import { AppRegistry, Image, Linking, Pressable, ScrollView, Text, View } from "react-native";
import { endStyle, focusRing, imageUri, modes, runtimeInput, runtimeLabel, scrollContent, tiles } from "../../src/lib/native/dev/styles-cases.ts";

const h = React.createElement;
const cell = { width: 168, height: 112, alignItems: "center", justifyContent: "center", backgroundColor: "#f4f4f5" };

function Tile({ tile }) {
  const style = endStyle(tile);
  let box;
  if (tile.kind === "image") box = h(Image, { source: { uri: imageUri }, style });
  else if (tile.kind === "scroll") box = h(ScrollView, { style, scrollEnabled: false, showsVerticalScrollIndicator: false }, ...scrollContent.map((part, i) => h(View, { key: i, style: part })));
  else if (tile.kind === "text") box = h(Text, { style }, tile.text);
  else box = h(View, { style }, tile.bar ? h(View, { style: tile.bar }) : null);
  return h(View, { style: cell }, box);
}

function Reference() {
  const [link, setLink] = React.useState(null);
  React.useEffect(() => {
    Linking.getInitialURL().then((url) => setLink(url ?? ""));
  }, []);
  if (link === null) return h(View, { style: { flex: 1, backgroundColor: "#ffffff" } });
  const query = new URLSearchParams(link.includes("?") ? link.slice(link.indexOf("?") + 1) : "");
  const mode = modes.find((name) => name === query.get("mode")) ?? "shadow";
  const top = Number(query.get("top") ?? 120);
  return h(
    View,
    { style: { flex: 1, backgroundColor: "#ffffff", paddingTop: top } },
    h(View, { testID: "styles.grid", style: { flexDirection: "row", flexWrap: "wrap", width: 336, alignSelf: "center" } }, ...tiles[mode].map((tile) => h(Tile, { key: tile.id, tile }))),
    mode === "shadow" &&
      // The input the lab page presses, in the state `&runtime=on` (the default, a focus ring) or `&runtime=off` (the shadow that is off) gives it: the lab's one input is pressed and compared
      // with each. The cell is centred and 24 dp below the grid, as the lab's is, so it sits where the lab's does and rounds to the same pixels.
      h(
        View,
        { testID: "styles.runtime", style: { ...cell, alignSelf: "center", marginTop: 24 } },
        h(Pressable, { onPress: () => {}, style: { ...runtimeInput, boxShadow: query.get("runtime") === "off" ? "0 0 0 0 transparent" : focusRing } }, h(Text, { style: runtimeLabel }, query.get("runtime") === "off" ? "Not focused" : "Focused")),
      ),
  );
}

AppRegistry.registerComponent("main", () => Reference);
