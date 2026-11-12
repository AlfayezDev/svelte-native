// The demo manifest: for each docs page that has a feature to show, the route of the showcase screen that shows it and how to record it. A screen
// opened with `?demo` plays its script once (`src/lib/demo.ts`):
//
//   adb shell am start -a android.intent.action.VIEW -d "svelte-native://<route>?demo" io.example.sveltenative.example
//   xcrun simctl openurl booted "svelte-native://<route>?demo"
//
// - `doc` is the page under `docs/`, or `null` for a screen that has a script and no page of its own (yet).
// - A page that several screens show has one entry for each of them (the native views); a screen that several pages use is in the manifest once per
//   page, with the same recording (the primitives, the inputs).
// - `durationMs` is the script's length: from `[demo] start <route>` to `[demo] end <route>` in the console (`adb logcat -s ReactNativeJS`),
//   measured on a build of the app on an Android emulator. Start the recording a moment before the link is opened and stop it a moment after the end line.
//   A script that closes its own screen (a push, a sheet, a modal) ends as the screen goes: the animation of the pop is in the last second.
// - `touch: true` says the recording needs touch input for part of it, and `touches` lists them (a real finger, or an injected touch, at those times).
//   Points are fractions of the screen, `[x, y]` from the top left, `[1, 1]` the bottom right, measured on a 411 x 914 point screen at the scroll offset
//   the script has reached at `at`. A finger that lands and lifts on the same point is a tap or a hold.
//
// Left out, because there is nothing to play: the getting started, build and deploy, appendix and reference pages (commands, configuration, guides);
// `20-core-concepts/30-loading-data.md` (the Remote functions screen needs a SvelteKit server, and this build has no host to call) and
// `40-native-features/10-native-libraries.md` (adding a library: no screen). Those have no entry, and `/remote` has no script.

export type DemoTouch = {
  /** What the finger does. */
  what: string;
  /** Milliseconds after the script starts (`[demo] start`) that the touch begins. */
  at: number;
  durationMs: number;
  /** One entry per finger: where it lands and where it lifts, as fractions of the screen. */
  fingers: readonly { from: readonly [x: number, y: number]; to: readonly [x: number, y: number] }[];
};

export type Demo = {
  /** The docs page, relative to `docs/`, or `null` when the screen has none. */
  doc: string | null;
  /** The link to open, a route of `src/routes` (registered in `core.ts` or `native.ts`). */
  route: string;
  durationMs: number;
  touch?: true;
  touches?: readonly DemoTouch[];
  /** What the recording shows, and what to know before taking it. */
  notes: string;
};

export const demos: readonly Demo[] = [
  // Core concepts
  { doc: "20-core-concepts/10-routing.md", route: "/navigation/stack", durationMs: 8700, notes: "Pushes item 1 and item 2 (the back arrow appears, the stack count grows) and pops both with router.back()." },
  { doc: "20-core-concepts/10-routing.md", route: "/navigation/tabs/feed", durationMs: 9200, notes: "Opens Post 2 inside the Feed tab, switches to Profile and back (the post is still open), then closes it. The link is the tab's own: the router drops the query of a link to /navigation/tabs." },
  { doc: "20-core-concepts/10-routing.md", route: "/navigation/sheet", durationMs: 6000, notes: "Shows the sheet for six seconds and dismisses it with router.back(). Open the app on any screen first and then the link: a sheet that is the first screen of the app (a cold link) has nothing under it and stays." },
  { doc: "20-core-concepts/10-routing.md", route: "/navigation/modal", durationMs: 6000, notes: "Shows the modal for six seconds and closes it with router.back(). Open the app on any screen first and then the link, as for the sheet." },
  { doc: "20-core-concepts/10-routing.md", route: "/navigation/links", durationMs: 7700, notes: "Opens the link to a stack item (it pushes the screen), comes back, then tries the link that matches no screen." },
  { doc: "20-core-concepts/20-styling.md", route: "/styling", durationMs: 11200, notes: "Selects the card (an array of styles), scrolls through the theme colours, the shadow and the transforms. The system's light and dark mode cannot be switched from the app: record the screen in each mode." },
  { doc: "20-core-concepts/20-styling.md", route: "/classes", durationMs: 11200, notes: "Selects the card (a class that depends on state), scrolls through the utilities, the layout classes, the safe area and the class and style example." },
  { doc: "20-core-concepts/40-state-management.md", route: "/state", durationMs: 11500, notes: "Counts up ($state, $derived), runs the timer ($effect), ticks a todo and adds one by typing it, asks again ({#await}), then puts it all back." },
  { doc: "20-core-concepts/50-html-elements.md", route: "/html", durationMs: 10100, notes: "Types a name and an address into the form, adds the contact to the list, then removes it through the dialog." },

  // Components
  { doc: "30-components/10-view.md", route: "/layout", durationMs: 11700, notes: "Walks through the values of justifyContent (the row moves), then scrolls down to alignItems, flexWrap, flex and absolute position, and back." },
  { doc: "30-components/20-text.md", route: "/text", durationMs: 10900, notes: "Scrolls to the inline spans, follows the link and holds the span link down (onPressChange), then on to the long text and the fonts." },
  { doc: "30-components/30-pressable.md", route: "/primitives", durationMs: 10900, notes: "Presses the Pressable twice (its pressed look and the count), slides the row of numbers, opens the Modal and closes it. The same recording serves the Image, ScrollView, Modal and ActivityIndicator pages." },
  { doc: "30-components/40-text-input.md", route: "/inputs", durationMs: 11500, notes: "Types into the echo field, flips the Switch, then fills in the form: the keyboard opens (focus() from code), the form rises above it, the errors show after the first submit and go when the fields are corrected. The soft keyboard shows only when the device has no hardware keyboard attached." },
  { doc: "30-components/50-switch.md", route: "/inputs", durationMs: 11500, notes: "The same recording as the TextInput page: the Switch is flipped at the start and at the end of the form." },
  { doc: "30-components/60-image.md", route: "/primitives", durationMs: 10900, notes: "The Image sits at the top of the screen while the script scrolls to the Pressable; the picture from a URL needs a network connection." },
  { doc: "30-components/70-scroll-view.md", route: "/lists", durationMs: 9300, notes: "Scrolls the plain ScrollView of 40 rows with its handle's scrollTo (a slow glide), then the windowed list beside it." },
  { doc: "30-components/80-list.md", route: "/lists", durationMs: 9300, notes: "Scrolls the windowed list of 5,000 rows, jumps to row 2,400 and scrolls on; the line above it says which rows are on screen." },
  { doc: "30-components/90-modal.md", route: "/primitives", durationMs: 10900, notes: "The Modal opens near the end (about seven seconds in) and closes after a second and a half." },
  { doc: "30-components/100-safe-area-view.md", route: "/platform", durationMs: 10600, notes: "Scrolls over the insets (top, bottom, left and right), opens and closes the keyboard (the insets store reports it), hides and shows the status bar." },
  { doc: "30-components/110-keyboard-avoiding-view.md", route: "/inputs", durationMs: 11500, notes: "The keyboard opens over the form of the Inputs screen and the KeyboardAvoidingView lifts it above it (from about three seconds in)." },
  { doc: "30-components/120-activity-indicator.md", route: "/primitives", durationMs: 10900, notes: "The ActivityIndicator is next to the Modal button, in view from the bottom scroll (about six seconds in)." },
  { doc: "30-components/130-screen.md", route: "/navigation/header", durationMs: 9800, touch: true, touches: [{ what: "Tap the search icon in the header, then type a name with `adb shell input text` (or the keyboard) to show the results the headerSearch snippet draws", at: 6500, durationMs: 100, fingers: [{ from: [0.93, 0.09], to: [0.93, 0.09] }] }], notes: "Presses the toolbar's two actions in turn (the line under the text names the last press). The search field in the header is the platform's and opens only on a touch: the script holds for three and a half seconds at the end for it." },
  { doc: "30-components/130-screen.md", route: "/navigation/sheet", durationMs: 6000, notes: "The sheet, as on the routing page: Screen's `sheet` option (detents, grabber). The user can drag it between its two heights, which the script does not do." },
  { doc: "30-components/140-stack.md", route: "/navigation/stack", durationMs: 8700, notes: "The same recording as the routing page." },
  { doc: "30-components/150-tabs.md", route: "/navigation/tabs/feed", durationMs: 9200, notes: "The same recording as the routing page: the tab bar with its badge, the post inside the Feed tab, the switch to Profile." },
  { doc: "30-components/160-blur-view.md", route: "/native-views/blur", durationMs: 10000, notes: "Steps the intensity from 0 to 100 and back to 60 over the striped views, then scrolls to the frosted caption over the photo. On Android 11 and older the blur is a tint only." },

  // Native features
  { doc: "40-native-features/20-native-views.md", route: "/native-views/image", durationMs: 9400, notes: "ExpoImage: scrolls to the placeholder example and loads the picture twice (the blurhash shows, then the picture fades in)." },
  { doc: "40-native-features/20-native-views.md", route: "/native-views/linear-gradient", durationMs: 9600, notes: "LinearGradient: goes through the three palettes, then scrolls to the directions and locations." },
  { doc: "40-native-features/20-native-views.md", route: "/native-views/conic-gradient", durationMs: 7900, notes: "ConicGradient: turns the wheel a full circle in eight steps of 45 degrees." },
  { doc: "40-native-features/20-native-views.md", route: "/native-views/video", durationMs: 8400, notes: "Video: plays the bundled clip, pauses it, plays on, and seeks back to the start (the position line shows it)." },
  { doc: "40-native-features/20-native-views.md", route: "/native-views/lottie", durationMs: 8600, notes: "LottieView: speeds the pulse up twice, pauses it with the player's handle and resumes it." },
  { doc: "40-native-features/20-native-views.md", route: "/native-views/pdf", durationMs: 7900, notes: "Pdf: opens the document, turns to page 2 with setPage and back to page 1." },
  { doc: "40-native-features/20-native-views.md", route: "/native-views/rive", durationMs: 8200, notes: "Rive: the file comes from Rive's CDN, so the device needs a connection (the first seconds show it loading). Pauses the animation and plays it again." },
  { doc: "40-native-features/20-native-views.md", route: "/native-views/shadow", durationMs: 7300, notes: "ShadowedView: raises the shadow's opacity, drops it to almost nothing and brings it back, beside a plain View." },
  { doc: "40-native-features/20-native-views.md", route: "/native-views/animateable-text", durationMs: 6600, notes: "AnimateableText: counts to 1000 in three seconds on the UI thread, then back to zero." },
  { doc: "40-native-features/20-native-views.md", route: "/native-views/view-shot", durationMs: 7500, notes: "ViewShot: captures the stripes into a picture next to them, clears it, captures again." },
  {
    doc: "40-native-features/20-native-views.md",
    route: "/native-views/date-time-picker",
    durationMs: 8900,
    touch: true,
    touches: [
      { what: "Tap Pick a date (Android: opens the dialog; on iOS use the compact picker of the screen instead)", at: 4600, durationMs: 100, fingers: [{ from: [0.5, 0.35], to: [0.5, 0.35] }] },
      { what: "Tap day 24 in the dialog", at: 5800, durationMs: 100, fingers: [{ from: [0.41, 0.61], to: [0.41, 0.61] }] },
      { what: "Tap OK", at: 6800, durationMs: 100, fingers: [{ from: [0.74, 0.75], to: [0.74, 0.75] }] },
    ],
    notes: "The picker is the platform's (a dialog on Android, a popover on iOS) and needs a finger. The script changes the date the screen holds twice, which the Picked line shows, puts it back, and holds for five seconds for the touches.",
  },
  { doc: "40-native-features/20-native-views.md", route: "/native-views/web-view", durationMs: 6900, notes: "WebView: presses the button inside the page from the app (a click event: the page posts its message back), then changes the page's text with injectJavaScript." },
  { doc: "40-native-features/20-native-views.md", route: "/native-views/map", durationMs: 8000, notes: "MapView: flies the camera to Paris and back to London with animateToRegion. Android draws no tiles without a Google Maps key at build time (GOOGLE_MAPS_API_KEY): record on iOS or with a key." },
  { doc: "40-native-features/20-native-views.md", route: "/native-views/any-expo-view", durationMs: 10600, notes: "defineExpoView: takes a picture with expo-camera's view when the camera permission is already granted (grant it before the take: `adb shell pm grant io.example.sveltenative.example android.permission.CAMERA`; the system prompt needs a touch), then calls the image view's reloadAsync." },
  { doc: "40-native-features/30-svg.md", route: "/native-views/svg", durationMs: 8800, notes: "Svg: the circle pulses by itself on the UI thread (animatedProps); scrolls down to the path and the SvgXml drawing and back." },
  { doc: "40-native-features/40-animation.md", route: "/animation", durationMs: 11600, notes: "Fades the box twice (withTiming), springs it right and back (withSpring), scrolls to the two loops, switches Big on and off (state into a shared value)." },
  { doc: "40-native-features/40-animation.md", route: "/animation/transitions", durationMs: 11400, notes: "Svelte's in:fly out:fade, transition:slide and scale, and animate:flip (a reversed order, an added and a removed row, reversed back), played on the UI thread." },
  {
    doc: "40-native-features/50-gestures.md",
    route: "/gestures",
    durationMs: 11700,
    touch: true,
    touches: [
      { what: "Drag the box right and a little down, and let go", at: 1000, durationMs: 800, fingers: [{ from: [0.21, 0.42], to: [0.48, 0.45] }] },
      { what: "Pinch out and turn the square with two fingers", at: 3600, durationMs: 1000, fingers: [{ from: [0.42, 0.38], to: [0.22, 0.31] }, { from: [0.58, 0.38], to: [0.78, 0.45] }] },
      { what: "Swipe the first row left past 100 points", at: 6400, durationMs: 400, fingers: [{ from: [0.8, 0.57], to: [0.25, 0.57] }] },
      { what: "Hold the button for 0.6 seconds", at: 8200, durationMs: 700, fingers: [{ from: [0.5, 0.9], to: [0.5, 0.9] }] },
    ],
    notes: "Gestures are recognised from a finger. Without one the script writes the shared values the gestures write: the box follows an invisible drag and springs back, the square pinches and turns, the first row slides away, the button is held down and counted. For a recording that shows the recognisers at work, play the same script with these touches at these times.",
  },
  { doc: "40-native-features/60-platform-apis.md", route: "/platform", durationMs: 10600, notes: "Scrolls over the device and safe area facts, opens and closes the keyboard, hides and shows the status bar." },
  { doc: "40-native-features/60-platform-apis.md", route: "/navigation/links", durationMs: 7700, notes: "The same recording as the routing page: a link opens a screen, comes back, and a link that matches nothing says so." },
  { doc: "40-native-features/70-updates.md", route: "/updates", durationMs: 7500, notes: "Scrolls to Check for an update and asks the server. This build has updates off, so the answer is immediate and negative; a recording of an available update needs a channel build." },

  // Screens with a script and no docs page
  { doc: null, route: "/i18n", durationMs: 8500, notes: "Switches to Arabic (the words, the digits and the layout direction change), steps through the plural forms (1, 2, 11, 3) and back to English." },
  { doc: null, route: "/accessibility", durationMs: 11000, notes: "Closes the message list, switches notifications on, opens the details, announces a count twice, archives the invoice, and resets. A screen reader's speech is not on the video." },
];
