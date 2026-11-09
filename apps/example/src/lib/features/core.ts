import type { Feature } from "./feature.ts";

/** The features of the core tour. Add one here and a folder of the same name under `src/routes`. */
export const coreFeatures: Feature[] = [
  { title: "Primitives", summary: "View, Text, Image, Pressable, ScrollView, ActivityIndicator, Modal", group: "Basics", route: "/primitives" },
  { title: "Text and fonts", summary: "Size, weight, spans, truncation, system and bundled fonts", group: "Basics", route: "/text" },
  { title: "State and reactivity", summary: "Runes driving native views: $state, $derived, $effect, await", group: "Basics", route: "/state" },
  { title: "Layout", summary: "Flexbox: rows, columns, wrap, alignment, flex, absolute", group: "Layout and style", route: "/layout" },
  { title: "Styling", summary: "Style objects, theme colours, dark mode, shadows, transforms", group: "Layout and style", route: "/styling" },
  { title: "Lists", summary: "A plain list beside a windowed list of 5,000 rows", group: "Lists and input", route: "/lists" },
  { title: "Inputs and forms", summary: "TextInput, Switch, validation and the keyboard", group: "Lists and input", route: "/inputs" },
];
