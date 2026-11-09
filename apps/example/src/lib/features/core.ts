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
  { title: "Stack", summary: "Push and pop screens, native headers, route parameters", group: "Navigation", route: "/navigation/stack", also: ["/navigation/stack/[id]"] },
  { title: "Tabs", summary: "A tab bar whose tabs each keep their own stack", group: "Navigation", route: "/navigation/tabs", also: ["/navigation/tabs/feed", "/navigation/tabs/feed/[id]", "/navigation/tabs/profile"] },
  { title: "Sheet", summary: "A bottom sheet with detents and a grabber", group: "Navigation", route: "/navigation/sheet" },
  { title: "Modal", summary: "A screen that covers everything, with its own Close button", group: "Navigation", route: "/navigation/modal" },
  { title: "Links", summary: "Deep links, the launch URL and router.openURL", group: "Navigation", route: "/navigation/links" },
  { title: "Platform", summary: "Safe area, status bar, keyboard, appearance, device", group: "Platform", route: "/platform" },
  { title: "Internationalization", summary: "Languages, plurals, numbers and right-to-left layout", group: "Platform", route: "/i18n" },
  { title: "Accessibility", summary: "Labels, roles, states, grouping, live regions, actions", group: "Platform", route: "/accessibility" },
];
