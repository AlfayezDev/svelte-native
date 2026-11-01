# svelte-engine: Android mounting layer spike (phase 0 of packages/svelte-native/PLAN.md)

Goal: replace React Native's Android mounting layer (FabricUIManager → MountItemDispatcher → SurfaceMountingManager → ViewManagers → AppCompat views) with a purpose-built one, while keeping Fabric's C++ shadow tree, Yoga and event emitters. Acceptance: the Fabric spike (`apps/platform/src/lib/native/dev/FabricSpike.svelte`, React-free Svelte host in `packages/svelte-native/src/fabric/host.ts`) renders and scrolls 300 rows, touches reach JavaScript, and the UI-thread mount of 300 rows costs ≤ 70 ms (React Native today: 145–200 ms; plain `FrameLayout`+`TextView` floor: 42–67 ms, see `modules/view-bench`).

This module is an Expo local module (autolinked from `apps/platform/modules/`), built like `expo-modules-core` and `react-native-reanimated`: Kotlin + C++ (CMake, prefab headers from `com.facebook.react:react-android`).

## How it hooks in

1. JavaScript calls `requireOptionalNativeModule("SvelteEngine")?.install()` once, before the first commit (from `startSurface` in `packages/svelte-native/src/fabric/host.ts`).
2. Kotlin `SvelteEngineModule.install()` gets Fabric's `FabricUIManager` (`UIManagerHelper.getUIManager(reactContext, UIManagerType.FABRIC)`), creates the fbjni hybrid `SvelteEngineNative(fabricUIManager, mountingManager)` and calls its native `install`.
3. C++: `JFabricUIManager::getBinding()->getScheduler()->getUIManager()->getShadowTreeRegistry().enumerate(...)` and for every shadow tree `getMountingCoordinator()->setMountingOverrideDelegate(ourDelegate)` (the same hook React Native uses for `enableLayoutAnimationsOnAndroid` and Reanimated uses for layout animations). Also hook surfaces started later if the registry offers it; for the spike the surface already exists at install time.
4. `OurDelegate::pullTransaction(surfaceId, number, telemetry, mutations)` encodes the mutations into one batch (below), hands it to Kotlin `MountingManager.onTransaction(...)` through JNI, and returns a `MountingTransaction` with an **empty** mutation list so React Native's Java mounting does nothing.
5. Kotlin posts the batch to the main thread and applies it to our own view tree, rooted in an `EngineRoot` `FrameLayout` overlay added to `activity.findViewById(android.R.id.content)` (same bounds as React Native's `ReactSurfaceView`, which still measures the surface and feeds Yoga its constraints).
6. Touches: `EngineRoot` hit-tests our tree and calls C++ `dispatchTouch`, which finds the shadow view's `TouchEventEmitter` (registry filled from mutations) and calls `onTouchStart/Move/End/Cancel`. Scroll: `EngineScroll` calls C++ `dispatchScroll` → `ScrollViewEventEmitter::onScroll`. `onLayout` needs nothing: Fabric emits it from the layout pass.

Resolved (NOTES.md §1): `disableViewPreallocationAndroid` is forced on through the Expo plugin (`androidFeatureFlags` in `apps/platform/app.config.ts`). Original note: React Native preallocates Android views when shadow nodes are created (`SchedulerDelegate::schedulerDidRequestPreliminaryViewAllocation` → `FabricMountingManager` → Java `preallocateView`). That must be switched off for our surface, or it keeps paying the old cost. Find the feature flag or the cleanest switch; our Expo config plugin already writes `ReactNativeFeatureFlags.dangerouslyForceOverride` into `MainApplication.kt` (`packages/svelte-native/src/expo.ts`).

## Batch encoding (C++ → Kotlin, one JNI call per transaction)

```kotlin
// expo.modules.svelteengine.MountingManager
fun onTransaction(surfaceId: Int, ops: IntArray, strings: Array<String>, objects: Array<Any?>)
```

`ops` is a flat stream of ints. Floats are stored inline as raw bits (`Float.floatToRawIntBits` in C++ via `memcpy`, `Float.fromBits(ops[i])` in Kotlin). Colors are ARGB ints. Strings are indices into `strings`, objects indices into `objects` (for Java-side objects such as a prepared text layout). All lengths in **pixels** (C++ multiplies Yoga points by `layoutMetrics.pointScaleFactor`).

Opcodes:

| op | payload | meaning |
|---|---|---|
| 1 CREATE | tag, kind, nProps, props… | kind: 1 View (`RCTView`, and any unknown component), 2 Text (`RCTText`/`Paragraph`), 4 ScrollView (`RCTScrollView`). `RCTRawText`/`RCTVirtualText` never produce views: their content is inside the Text's state. |
| 2 DELETE | tag | |
| 3 INSERT | parentTag, childTag, index | `parentTag == surfaceId` means the overlay root |
| 4 REMOVE | parentTag, childTag, index | |
| 5 UPDATE_PROPS | tag, kind, nProps, props… | full prop record of the new shadow view (not a diff; Kotlin may diff against what it holds) |
| 6 UPDATE_LAYOUT | tag, x, y, w, h, padL, padT, padR, padB, displayNone(0/1) | floats as bits, relative to the parent; padding is `layoutMetrics.contentInsets`, used by Text |
| 7 UPDATE_STATE | tag, kind, … | Text: same `20`/`21`/`22` records as props. ScrollView: nothing for the spike |
| 9 END | | |

Prop records: `propId, values…`

| id | values | applies to |
|---|---|---|
| 1 | backgroundColor: int | all |
| 2 | opacity: float | all |
| 3 | borderRadius TL, TR, BR, BL: 4 floats | all |
| 4 | borderWidth L, T, R, B: 4 floats | all |
| 5 | borderColor: int | all |
| 6 | transform: translateX, translateY, scaleX, scaleY, rotationDeg: 5 floats (decomposed from the 4×4 matrix in C++; identity = 0,0,1,1,0) | all |
| 7 | overflow: int (0 visible, 1 hidden/scroll) | all |
| 8 | pointerEvents: int (0 auto, 1 none, 2 box-none, 3 box-only) | all |
| 9 | elevation/zIndex: float | all |
| 10 | testID: string | all |
| 11 | accessibilityLabel: string | all |
| 14 | hitSlop: left, top, right, bottom: 4 floats (px); absent = 0 | all |
| 15 | Android view flags: 1 int, bit 1 `needsOffscreenAlphaCompositing`, bit 2 `renderToHardwareTextureAndroid`; absent = 0 | all |
| 20 | paragraph: textAlign (0 auto/left, 1 center, 2 right, 3 justify), numberOfLines (0 = unlimited), ellipsize (0 tail, 1 head, 2 middle, 3 clip) | Text |
| 21 | fragment: string, fontSize: float (px), color: int, fontWeight: int (100–900), fontStyle: int (0 normal, 1 italic), fontFamily: string or -1, letterSpacing: float, lineHeight: float (px, 0 = default). Repeats once per fragment of the attributed string, in order | Text |
| 22 | preparedLayout: object index, when React Native's prepared text layout (an `android.text.Layout`) is available in the paragraph state; Kotlin draws it directly | Text |
| 23 | paragraphExtra: breakStrategy (0 simple, 1 high quality, 2 balanced), includeFontPadding, hyphenation (0 none, 1 normal, 2 full), adjustsFontSizeToFit, minimumFontSize (float, NaN = unset), textAlignVertical (0 top/auto, 1 center, 2 bottom), rtl (layout direction). Follows record 20 | Text |
| 24 | fragmentExtra, follows each record 21: flags (1 underline, 2 line-through, 4 has background), textTransform (0 none, 1 upper, 2 lower, 3 capitalize), backgroundColor int, opacity float (NaN unset), shadow dx, dy, radius (floats px), shadow color, fontVariant bits | Text |
| 30 | horizontal: int | ScrollView |
| 31 | showsScrollIndicator: int | ScrollView |
| 32 | scrollEnabled: int | ScrollView |
| 33 | scrollEventThrottle: float (ms) | ScrollView |
| 34 | contentOffset: x, y floats (px); only when non-zero | ScrollView |
| 35 | snap: pagingEnabled, snapToInterval (float px), snapToAlignment (0 unset, 1 start, 2 center, 3 end), disableIntervalMomentum, snapToStart, snapToEnd | ScrollView |
| 36 | snapToOffsets: count, then count floats (px); only when non-empty | ScrollView |
| 37 | decelerationRate: float | ScrollView |
| 38 | keyboardDismissMode: int (0 none, 1 on-drag, 2 interactive) | ScrollView |
| 39 | overScrollMode: int (0 auto, 1 always, 2 never) | ScrollView |

Kotlin → C++ (`external fun` on `SvelteEngineNative`):

```kotlin
external fun install(fabricUIManager: FabricUIManager)
// type: 0 start, 1 move, 2 end, 3 cancel. Single touch for the spike; identifier is the pointer id.
external fun dispatchTouch(surfaceId: Int, type: Int, targetTag: Int, identifier: Int, pageX: Float, pageY: Float, localX: Float, localY: Float, timestampMs: Double)
// kind: 0 scroll, 1 beginDrag, 2 endDrag, 3 momentumBegin, 4 momentumEnd. All values in points (divide px by density).
external fun dispatchScroll(tag: Int, kind: Int, offsetX: Float, offsetY: Float, contentW: Float, contentH: Float, containerW: Float, containerH: Float)
```

C++ keeps `tag → SharedEventEmitter` from Create/Update mutations and drops entries on Delete. Touch coordinates in points; `pagePoint` = position in the root, `offsetPoint` = position inside the target view, `screenPoint` = same as page for the spike. Touch events bubble in JavaScript, not here.

## Views (Kotlin)

- `EngineRoot : FrameLayout` overlay. Children laid out at absolute frames. `dispatchTouchEvent` hit-tests the tree (reverse child order, honouring `pointerEvents`), calls `dispatchTouch`, then lets the normal Android dispatch continue so `EngineScroll` can scroll. When an `EngineScroll` intercepts (its `onInterceptTouchEvent` returns true), the root sends `cancel` for the active touch, like React Native's `NativeGestureUtil.notifyNativeGestureStarted`.
- A node that listens for `click` (every Pressable: the host declares `onClick` for nodes with press handlers, Fabric carries it in `ViewProps::events`, record 15 bit 4) is `clickable` with a click listener, so accessibility services get `ACTION_CLICK` and their activation (`performClick`) comes back through `SvelteEngineNative.dispatchClick` as the node's `click` event, which the host turns into the press. Engine views never receive touch events themselves (`EngineRoot` claims and forwards every gesture), so the listener changes nothing for touches; the pool resets it. Before this, uiautomator saw every Pressable as `clickable=false` (446 of P's "not actionable" elements).

- `EngineView : ViewGroup`. No measure/layout of its own: `onLayout` re-applies the stored child frames. Background via a `GradientDrawable` only when colour, radius or border are set. `overflow hidden` → `clipChildren` + outline clip for rounded corners. Transform → `translationX/Y`, `scaleX/Y`, `rotation`.
- `EngineText : View`. Draws an `android.text.Layout` (prepared layout from React Native when available, else a `StaticLayout` built from the fragments with a `TextPaint` that matches React Native's `TextLayoutManager`: `textSize` in px, typeface from weight/style/family, letter spacing in em, line height via `LineHeightSpan`), at the padding offset. Never a `TextView`, never AppCompat.
- `EngineScroll : android.widget.ScrollView` (`HorizontalScrollView` when horizontal). Its single child is the content `EngineView` whose frame comes from Yoga; `EngineScroll` must not re-measure it (override `onMeasure`/`measureChild` to keep the Yoga size). Scroll listener → `dispatchScroll` kind 0 on every scroll change, drag begin/end from touch events.
- `MountingManager`: registry `SparseArray<View>`; decodes a batch in one pass and applies it. Order inside a transaction follows the ops order. Wraps each transaction in `android.os.Trace.beginSection("SvelteEngine.mount")` and logs `Log.i("SvelteEngine", "surface=S ops=N create=C update=U layout=L insert=I remove=R delete=D decode=X.Xms apply=Y.Yms")`. That log line is the acceptance number.

Density: `resources.displayMetrics.density`; C++ already converts to px, so Kotlin never multiplies.

## Files

```
apps/platform/modules/svelte-engine/
  expo-module.config.json             platforms ["android"], module expo.modules.svelteengine.SvelteEngineModule
  android/build.gradle                 like expo-modules-core's: CMake external build, prefab consumer, react-android + fbjni deps, c++_shared
  android/CMakeLists.txt               target svelteengine (shared), links ReactAndroid::reactnative ReactAndroid::jsi fbjni::fbjni android log
  android/src/main/cpp/OnLoad.cpp      JNI_OnLoad → SvelteEngineNative::registerNatives()
  android/src/main/cpp/SvelteEngineNative.{h,cpp}   fbjni HybridClass, install, dispatchTouch, dispatchScroll, emitter registry
  android/src/main/cpp/MountingDelegate.{h,cpp}     MountingOverrideDelegate → batch encoder → JNI MountingManager.onTransaction
  android/src/main/cpp/PropsEncoder.{h,cpp}         ViewProps / ParagraphProps+State / ScrollViewProps → prop records
  android/src/main/java/expo/modules/svelteengine/SvelteEngineModule.kt   Expo module: install()
  android/src/main/java/expo/modules/svelteengine/SvelteEngineNative.kt   hybrid holder, external funs, System.loadLibrary("svelteengine")
  android/src/main/java/expo/modules/svelteengine/MountingManager.kt      batch decode + apply, registry, timing log
  android/src/main/java/expo/modules/svelteengine/views/EngineRoot.kt, EngineView.kt, EngineText.kt, EngineScroll.kt
  android/src/main/java/expo/modules/svelteengine/Props.kt                prop record decoding, drawable building, text layout building
  NOTES.md                              investigation findings with exact React Native file:line references
```

Build: `cd apps/platform/android && ./gradlew :svelte-engine:assembleRelease -PreactNativeArchitectures=x86_64,arm64-v8a --console=plain` (module only, fast) and the app: `SVELTE_NATIVE_FABRIC=1 node ../../packages/svelte-native/src/cli.ts sync` from `apps/platform` then `./gradlew :app:assembleRelease -PreactNativeArchitectures=x86_64`. The emulator is x86_64 (OVH, `localhost:5555` through an ssh tunnel); the Samsung phone is arm64 and must not be used by agents.

References to copy from, all in `node_modules`: `expo-modules-core/android/build.gradle` + `CMakeLists.txt` (same Gradle plugin, C++ with prefab), `react-native-reanimated/android/CMakeLists.txt` and `src/main/cpp/reanimated/android/NativeProxy.cpp` (`JFabricUIManager`, `getBinding()->getScheduler()`, `setMountingOverrideDelegate`), `react-native/ReactAndroid/src/main/jni/react/fabric/FabricMountingManager.cpp` (how React Native encodes the same mutations into its IntBuffer and reads `ViewProps`, `LayoutMetrics`, text state), `react-native/ReactCommon/react/renderer/mounting/{ShadowView,ShadowViewMutation,MountingOverrideDelegate,MountingTransaction}.h`, `react/renderer/components/view/{ViewProps,TouchEvent,TouchEventEmitter,ViewEventEmitter}.h`, `react/renderer/components/scrollview/ScrollViewEventEmitter.h`, `react/renderer/components/text/ParagraphState.h`, `react/renderer/attributedstring/{AttributedString,TextAttributes}.h`, `react/renderer/textlayoutmanager/platform/android/...` (prepared layout), `react-native/ReactAndroid/src/main/java/com/facebook/react/views/text/{ReactTextView.java,ReactTextViewManager.kt,TextLayoutManager.kt}` (how React Native builds the Spannable and Layout, for parity), `views/scroll/ReactScrollView.kt`, `uimanager/JSTouchDispatcher.kt` + `TouchTargetHelper.kt` (touch target semantics), `fabric/mounting/SurfaceMountingManager.kt`.


## Phase 2 additions: text input, switch, spinner, image, modal (merged from SPEC-views.md)

## svelte-engine: view kinds 5..9 (TextInput, Switch, ActivityIndicator, Image, Modal)

Additions to SPEC.md (merge into its kind / prop tables). Same batch encoding: records are `propId, values...`, floats as raw bits, colours ARGB ints, strings and objects as side-table indices, lengths in pixels. Every kind carries the common records 1..11 first; the records below follow.

### Kinds

| kind | component name(s) mapped in `kindForComponent` | Kotlin view | C++ props / state / emitter |
|---|---|---|---|
| 5 TextInput | `AndroidTextInput` | `EngineInput : android.widget.EditText` | `AndroidTextInputProps`, `AndroidTextInputState` (`textinput/platform/android/.../androidtextinput/`), `AndroidTextInputEventEmitter` (a placeholder: events go through `EventEmitter::dispatchEvent`, like `EventEmitterWrapper::invokeEvent`) |
| 6 Switch | `AndroidSwitch` | `EngineSwitch : android.widget.Switch` | `AndroidSwitchProps`, `AndroidSwitchEventEmitter::onChange` (generated, `FBReactNativeSpec/Props.h`, `EventEmitters.h`) |
| 7 ActivityIndicator | `AndroidProgressBar` | `EngineSpinner : android.widget.ProgressBar` | `AndroidProgressBarProps` (generated) |
| 8 Image | `Image`, `RCTImageView` | `EngineImage : android.widget.ImageView` | `ImageProps` (`components/image/ImageProps.h`, `sources`, `resizeMode`, `tintColor`), `ImageEventEmitter` |
| 9 Modal | `ModalHostView`, `RCTModalHostView` | `EngineModal : ViewGroup` (host frame) + `ModalLayer : EngineView` (an overlay layer of the `EngineRoot`, no window) holding `ModalContent : EngineView` | `ModalHostViewProps`, `ModalHostViewState` (generic `State::updateState(folly::dynamic)`), `ModalHostViewEventEmitter` |

`UPDATE_STATE` is sent for kinds 2 and 5 (`kindHasState`). The Modal's `State` is kept in C++ per tag (`noteViewState` / `forgetViewState` in `PropsEncoderViews.cpp`, called from `MountingDelegate`).

### Prop records

| id | values | kind |
|---|---|---|
| 40 | textStyle: fontSize px (float, includes fontSizeMultiplier and scale), hasColor, color, fontWeight, fontStyle (0/1), fontFamily string or -1, letterSpacing px, lineHeight px (0 default), textAlign (0 auto/left, 1 center, 2 right, 3 justify) | 5 |
| 41 | textProp: text string, mostRecentEventCount from the props. Only the initial text on CREATE | 5 |
| 42 | placeholder: string or -1, hasColor, color | 5 |
| 43 | behavior: secureTextEntry, multiline, editable (`editable && !readOnly`), maxLength (-1 = none) | 5 |
| 44 | keyboard: keyboardType (0 default, 1 numeric, 2 number-pad, 3 decimal-pad, 4 email-address, 5 phone-pad, 6 visible-password, 7 url), autoCapitalize (0 none, 1 characters, 2 words, 3 sentences, also the default), autoCorrect (1 on, -1 unset) | 5 |
| 45 | returnKey: returnKeyType (0 done, 1 go, 2 next, 3 none, 4 previous, 5 search, 6 send), submitBehavior resolved by C++ (`getNonDefaultSubmitBehavior`): 1 submit, 2 blurAndSubmit, 3 newline | 5 |
| 46 | colors: hasSelectionColor, selectionColor, hasCursorColor, cursorColor | 5 |
| 47 | flags: autoFocus, selectTextOnFocus, caretHidden | 5 |
| 48 | stateText: string, mostRecentEventCount. Only in `UPDATE_STATE` (concatenated fragments of `AndroidTextInputState::attributedStringBox`) | 5 |
| 60 | value: int (`value \|\| on`) | 6 |
| 61 | enabled: int (`enabled && !disabled`) | 6 |
| 62 | thumb: hasColor, color (`thumbColor`, else `thumbTintColor`) | 6 |
| 63 / 64 | trackColorForFalse / trackColorForTrue: hasColor, color | 6 |
| 65 | trackTintColor: hasColor, color | 6 |
| 70 | styleAttr: int (0 Normal, 1 Small, 2 Large, 3 Horizontal, 4 Inverse, 5 SmallInverse, 6 LargeInverse). Fixed at creation | 7 |
| 71 | animating: int | 7 |
| 72 | color: hasColor, color | 7 |
| 73 | progress: indeterminate (int), progress (float 0..1, Horizontal only) | 7 |
| 80 | source: uri string or -1, width, height, scale (floats; `sources[0]`) | 8 |
| 81 | resizeMode: int (0 cover, 1 contain, 2 stretch, 3 center, 4 repeat, 5 none) = `ImageResizeMode` | 8 |
| 82 | tintColor: hasColor, color | 8 |
| 83 | headers: n, then n x (name string, value string). Only when `sources[0].headers` is not empty | 8 |
| 100 | modal: animationType (0 none, 1 slide, 2 fade), transparent, statusBarTranslucent, navigationBarTranslucent, hardwareAccelerated, visible | 9 |

Ids 49..59, 66..69, 74..79, 84..99, 101..109 stay free.

### Events (Kotlin to C++, `ViewEvents`, `InputEvents.cpp`)

Static JNI methods on the Kotlin object `expo.modules.svelteengine.ViewEvents`, registered from `SvelteEngineNative::registerNatives` (`registerViewEventNatives`); the C++ side finds the emitter of `tag` in the mounting delegate's map (`setViewEventsDelegate`). Any thread.

| method | emitted | payload (as React Native's Java events) |
|---|---|---|
| `input(tag, INPUT_CHANGE, text, eventCount, selStart, selEnd)` | `topChange` | `{target, text, eventCount, selection:{start,end}}` |
| `input(.., INPUT_FOCUS ..)` / `INPUT_BLUR` | `topFocus` / `topBlur` | `{target}` |
| `input(.., INPUT_END_EDITING, text ..)` | `topEndEditing` (after blur, like RN) | `{target, text}` |
| `input(.., INPUT_SUBMIT, text ..)` | `topSubmitEditing` | `{target, text}` |
| `input(.., INPUT_KEY_PRESS, key ..)` | `topKeyPress` | `{key}` (one char, `Enter`, `Backspace`) |
| `input(.., INPUT_SELECTION, .., selStart, selEnd)` | `topSelectionChange` | `{selection:{start,end}}` |
| `switchChange(tag, value)` | `AndroidSwitchEventEmitter::onChange` = `topChange` | `{value, target}` |
| `image(tag, IMAGE_LOAD_START ..)` | `ImageEventEmitter::onLoadStart` | |
| `image(.., IMAGE_LOAD, w, h, uri ..)` | `onLoad` | `{source:{uri,width,height}}`, size = original source pixels |
| `image(.., IMAGE_ERROR, .., error)` | `onError` | `{error}` |
| `image(.., IMAGE_LOAD_END ..)` | `onLoadEnd` | |
| `modal(tag, MODAL_REQUEST_CLOSE)` | `ModalHostViewEventEmitter::onRequestClose` | back key and back gesture while the modal's layer is the front-most overlay |
| `modal(tag, MODAL_SHOW)` | `onShow` | the layer's first frame after a show has been laid out |
| `modal(tag, MODAL_DISMISS)` | `onDismiss` | the layer came off the screen after `visible = false` (not sent when the host is deleted) |
| `modalSize(tag, widthDp, heightDp)` | `State::updateState({screenWidth, screenHeight})` | not an event: the Modal's state size (the layer's content frame) |

### Behaviour

#### TextInput: controlled-text protocol

`EngineInput.nativeEventCount` is React Native's `nativeEventCount`: every user edit (`afterTextChanged`, not while `settingText`) increments it and is reported as `topChange` with that count. Text from JavaScript comes through two entry points, both ending in `maybeSetText(text, eventCount)` = `ReactEditText.maybeSetText`:

1. `UPDATE_STATE` (record 48): the text and `mostRecentEventCount` of `AndroidTextInputState`. The shadow node writes it after layout whenever the React tree text (`text` prop plus children) changes, with `mostRecentEventCount = props.mostRecentEventCount` (0 when only the layout manager changed). On CREATE the `text` prop (record 41) is applied once as the initial text.
2. `EngineInput.setTextAndSelection(eventCount, text?, start, end)` for the `setTextAndSelection` view command (the controlled-rejection path of React Native's `TextInput.js`).

Rule: ignore the update when `eventCount < nativeEventCount` (JS answered an older value than what the user typed since), skip when the text is equal, otherwise replace the text with `settingText = true` (no `topChange`), keeping the caret (`min(oldCaret, newLength)`); an empty text uses `setText(null)` (clears keyboard composing text). `secureTextEntry` with equal text is a no-op (same as RN, falls out of the equality check).

Other behaviour: `inputType` is recomputed from keyboardType, autoCapitalize, secureTextEntry, multiline, autoCorrect (as `ReactTextInputManager`), the typeface is re-applied after it changes; `editable=false` disables the view; `maxLength` via `InputFilter.LengthFilter`; `returnKeyType` to `imeOptions`; submit/blur on the IME action follows `shouldSubmitOnReturn` / `shouldBlurOnReturn`; `selectionColor` sets `highlightColor`, `cursorColor` tints cursor and handles (API 29+); padding comes from the layout insets (`syncPadding`, called from `applyLayout`). Commands for the other agent's `dispatchCommand`: `focus()` (requestFocus + show keyboard), `blur()` (moves focus to the parent, then hides the keyboard), `setTextAndSelection(eventCount, text, start, end)`.

#### Switch

`value` always goes through `setOn` (no `onChange`, re-arms user input). After a user toggle `allowChange` is false (`ReactSwitch.setChecked`): further user toggles are rejected until JavaScript answers with a props update, which the `Switch.js` onChange handler guarantees (`setNativeProps({value})` clones the props, so `UPDATE_PROPS` arrives even when the value is unchanged). Colours: `PorterDuff.MULTIPLY` filter on thumb and track drawables like `ReactSwitch`.

#### ActivityIndicator

Style drawable is chosen at creation from record 70; the frame is Yoga's (React Native measured the same style through the view manager). `animating=false` stops drawing. `color` tints the indeterminate drawable.

#### Image

`ImageLoader`: 3 daemon threads, `HttpURLConnection` (http/https, source headers, redirects), `file://` and absolute paths, `data:` (base64), `asset:/path` (AssetManager), `res:/id`, bare drawable names (lower-cased, `-` to `_`, as `ResourceDrawableIdHelper`), `content://`; `BitmapFactory` with `inSampleSize` for the view's frame; `LruCache` of 1/8 heap (4..32 MB) keyed by `uri|WxH`. The load starts once the frame is known and is not repeated when a later frame is covered by the decoded bitmap. Event order: `loadStart`, `load` | `error`, `loadEnd`; stale loads (new uri/size) are dropped. `resizeMode`: cover CENTER_CROP, contain FIT_CENTER, stretch FIT_XY, center CENTER_INSIDE, repeat tiled `BitmapDrawable`, none MATRIX; `tintColor` via `imageTintList`; the max corner radius clips with an outline provider (unless `overflow: hidden` already installed one).

#### Modal

`EngineModal` is the host frame in the tree (`pointerEvents` forced to none so the overlay hit test never walks into it). Like `ReactModalHostView` it forwards `addView/removeView/removeViewAt/getChildAt/getChildCount` to its `ModalContent`, so `INSERT parentTag == modalTag` lands in the layer's content. `visible` puts a full-screen overlay layer on top of the `EngineRoot`; there is no `Dialog` and no window (the dialog, its spare dialogs and the `SvelteEngineDialog` themes are gone). The layer, its insets, animation, back key, touch and accessibility rules, and what the device runs must show, are in "Modal as an overlay layer" at the end of this file. The Modal's state size (`screenWidth`, `screenHeight` in `ModalHostViewState`, as `DialogRootViewGroup.updateState` writes it) is the layer's content frame, reported through `modalSize`; without it the Android `ModalHostViewScreenSize()` is 0x0 and the children lay out empty.

### Gaps

- TextInput: `autoCorrect=false` cannot be told apart from "unset" in the C++ props (no `NO_SUGGESTIONS` flag is set); `showSoftInputOnFocus`, `contextMenuHidden`, `inlineImageLeft`, `textShadow*`, `textDecorationLine`, `underlineColorAndroid`, `numberOfLines`, `disableFullscreenUI`, `importantForAutofill`, `returnKeyLabel`, `textBreakStrategy` are not applied; `contentSizeChange` and `scroll` events are not sent; text attributes of children (nested `<Text>` inside the input) are not rendered; `selectionHandleColor` shares the cursor tint.
- Switch: no ripple background (`backgroundColor` uses the common GradientDrawable).
- Image: no `blurRadius`, `fadeDuration`, `defaultSource`, `loadingIndicatorSource`, `overlayColor`, `capInsets`, `progressiveRenderingEnabled`, `onProgress`/`onPartialLoad`; no vector XML drawables; images with a 0-size frame never load. The C++ `ImageShadowNode` still asks React Native's image manager to prefetch, which is untouched.
- Modal: no `onOrientationChange`, no `supportedOrientations`, `hardwareAccelerated` is ignored (the layer is part of the activity's window); a new size after a rotation or a keyboard change reaches JavaScript one layout later.
- Nothing here was run on a device or emulator; only the build was checked.


### Mount reporting and dropped-node writes (integration findings, 25 Oct evening)

- After every applied batch the Kotlin side calls `SvelteEngineNative.reportMount(surfaceId)` → `Scheduler::reportMount`. Without it Fabric's `UIManagerMountHook`s never fire; Reanimated's mount hook is where it drops removed nodes, so CSS animations of unmounted tiles kept writing forever (one `RetryableMountingLayerException` per frame per tile once the write fell through to React Native, which pinned the emulator at 600% CPU and flooded logcat).
- `reportMount` is posted to the next main-looper message, never called inside the batch: a commit made on the main thread (`ReactSurfaceView.onMeasure` on a size change, a rotation) runs the batch inline from Fabric's `MountingCoordinator::pullTransaction` with the coordinator's mutex held, and `UIManager::reportMount` takes that mutex again. Found as an ANR ("Input dispatching timed out") on every rotation, with the landscape layout never applied.
- After `reportMount` the batch induces Fabric's asynchronous event beat (`EventBeat.kt`): `onLayout` and the other events a commit queues drain only on `EventBeatManager.tick()`, which React Native calls from its event dispatcher's Choreographer callback, one frame after the mount (iOS induces it before the main run loop sleeps, right after the mount). The beat manager is reached once through the dispatcher's private batch-listener list and ticked after every mounted batch; without that field the frame of latency stays.
- `MountingManager.applyAnimated` returns `true` for unknown tags (after logging the first three). A mapper or CSS animation can outlive its view by a few frames; letting those writes reach React Native's `updatePropsSynchronously` throws for every engine tag.

- `EngineInput` reports no text changes until creation finished (`created`): the input-type, hint and initial-text setters fire `afterTextChanged` with an empty string, and such a stray `change` reached JavaScript after the first bound update, dropping one of 120 pushed characters in the lab (`input-120`, both devices).

## Phase 2 additions: multi-touch, hit testing, scroll events, commands, accessibility (merged from SPEC-input.md)

## svelte-engine: input, events, commands, accessibility (phase 2 additions, to be merged into SPEC.md)

References are in NOTES.md sections 5, 6, 7 and 9. Changes to the SPEC.md contracts are marked **changed**.

### Touch (changed: `dispatchTouch`)

```kotlin
// Kotlin -> C++ (SvelteEngineNative.kt, implemented in cpp/TouchDispatch.cpp)
external fun dispatchTouch(
  surfaceId: Int, type: Int, changedIndex: Int, count: Int,
  targets: IntArray, identifiers: IntArray,
  pageX: FloatArray, pageY: FloatArray, localX: FloatArray, localY: FloatArray,
  timestampMs: Double,
)
```

One call per `MotionEvent`. The per-pointer arrays hold `count` (max 32) active pointers in the order they went down:
`targets[i]` = tag hit at that pointer's DOWN (fixed for the gesture), `identifiers[i]` = `MotionEvent` pointer id, page = relative to the
engine root, local = relative to the pointer's target view (ancestor scroll offsets and inverse transforms applied, like
`TouchTargetHelper`). All coordinates in points (`px / density`). `timestampMs` = `MotionEvent.getEventTime()`; C++ sets
`Touch.timeStamp` from it on the steady clock and the deprecated `Touch.timestamp` in seconds. `screenPoint` = page point.

| type | emitted to | `touches` | `changedTouches` |
|---|---|---|---|
| 0 start | target of `changedIndex` | all pointers | `[changedIndex]` |
| 1 move | every distinct target once | all pointers | all pointers |
| 2 end | target of `changedIndex` | all except `changedIndex` | `[changedIndex]` |
| 3 cancel | every distinct target once | empty | all pointers |

`targetTouches` = the `touches` whose target equals the event's target. `changedIndex` is -1 for move and cancel.
With a single target this equals React Native's `TouchesHelper` output; with several targets each target receives its own
event (W3C style).

`EngineRoot` (views/EngineRoot.kt) claims a gesture that starts on an engine view (hit test at DOWN): it returns true for every
event of it, so `ReactSurfaceView` never sees them; a gesture that starts on no engine view returns false untouched. A
`POINTER_DOWN` that hits no engine view is ignored. When a scroll view intercepts, `ScrollBridge.onIntercepted` calls
`EngineRoot.cancelActiveTouch()`: JavaScript gets one cancel for all active pointers and nothing more until the next DOWN
(`NativeGestureUtil` semantics). `EngineView.onTouchEvent` consumes touches that land on it unless `pointerEvents` is
none/box-none (like `ReactViewGroup`), so scroll ancestors always take over through `onInterceptTouchEvent`.

### Hit testing and z-order (views/HitTest.kt, views/EngineView.kt)

`HitTest.find(root, x, y)` is a port of `findTouchTargetView`: children topmost first, point mapped per child with
`x + parent.scrollX - child.left` and the inverse of `child.matrix` (non-invertible: skipped), bounds check
`0 <= x < width`, invisible children skipped. Clipping: a parent with `overflow: hidden/scroll` (and any `EngineScroll`) rejects
points outside its bounds; with overflow visible children outside the parent still hit. `pointerEvents`: none = view and subtree
excluded, box-only = the view only, box-none = descendants only, auto = descendants then the view.

Stacking, **changed prop 9**: `elevation/zIndex` becomes two floats `zIndex` (0 when absent), `elevation` (**px**, `elevation * pointScaleFactor`).
Absent record = both 0. Kotlin: `NodeState.zIndex`, `NodeState.elevation`.
- `EngineView` enables `isChildrenDrawingOrderEnabled` while any child has a non-default value and draws children in stable
  `zIndex` order (`getChildDrawingOrder`).
- `View.elevation` is set from `elevation` only (never from `zIndex`).
- Hit order is the topmost-first reverse of (elevation, zIndex, insertion index), the same order Android draws
  (custom order, then its Z sort). `EngineView.hitChildIndex(rank)`.
- `hitSlop` (record 14, px) grows the view's own touch rect in `HitTest.hitView` (also the clip test of its children), like `ReactHitSlopView` in `TouchTargetHelper`.

### Scroll (views/EngineScroll.kt: `ScrollBridge`)

`dispatchScroll` **changed**: two extra params `velocityX, velocityY` (points/ms, only read for kind 2) and `timestamp` is now in seconds as `ScrollEvent` expects.

| kind | when |
|---|---|
| 0 scroll | every `onScrollChanged`, throttled like `ReactScrollViewHelper.emitScrollEvent`: dropped while `scrollEventThrottle >= max(17, now - last)` |
| 1 beginDrag | scroll view intercepts the gesture (including catching a fling on DOWN) |
| 2 endDrag | ACTION_UP/CANCEL while dragging; carries release velocity (`VelocityTracker`, px/ms / density) and `targetContentOffset` = current offset |
| 3 momentumBegin | right after endDrag and at the start of an animated `scrollTo`/`scrollToEnd` (React Native's `handlePostTouchScrolling`) |
| 4 momentumEnd | when no scroll change happened for 3 consecutive 20 ms checks (React Native's idle runnable); also when a touch stops a running momentum phase |

Props: new prop 33 `scrollEventThrottle: float` (ms). `scrollEnabled` (32, intercept and touch return false; programmatic scrolling still works),
`showsVerticalScrollIndicator`/`showsHorizontalScrollIndicator` (31, per orientation) as before. `pointerEvents` of the scroll view follows
`PointerEvents.canBeTouchTarget/canChildrenBeTouchTarget`. Horizontal (`EngineHScroll`) has the same code path.
Nested scroll views rely on Android's intercept protocol (inner scroll disallows ancestor interception while dragging).

Fabric state: `SvelteEngineNative.updateScrollState(tag, offsetX, offsetY)` (cpp/Commands.cpp) updates `ConcreteState<ScrollViewState>.contentOffset`
(points) from the UI thread with `ConcreteState::updateState`; the delegate keeps the latest `State::Shared` of each ScrollView (`MountingDelegate::scrollStateFor`).
No Java `StateWrapper` is needed, so `measure`/`measureInWindow` of descendants of a scrolled ScrollView stay correct. Pushed: on scroll change
(deduped, at most every 50 ms), at drag end, and when momentum settles. Gaps: (contentOffset and snapping are now implemented, see "Scroll props")
no `scrollToTop`, no momentum events for fling sources other than touch and `scrollTo(animated)` (e.g. mouse wheel), `contentInset` is always 0.

### Commands, setNativeProps, measure (Commands.kt, SvelteEngineModule.kt)

React Native's `dispatchCommand` cannot reach engine views, so JavaScript calls the Expo module for engine tags:

```ts
const engine = requireNativeModule("SvelteEngine");
engine.dispatchCommand(tag: number, name: string, args: unknown[]): boolean   // fire and forget, runs on the main thread
engine.setNativeProps(tag: number, props: Record<string, unknown>): boolean   // same
engine.measure(tag: number): { x, y, width, height, pageX, pageY } | null     // synchronous, all dp
```

All three return false when the engine is not installed. Calls are posted to the main thread in order, behind mounting batches already posted.
`measure` blocks the calling thread up to 500 ms for the main thread and returns null on timeout or for an unknown or detached tag; `x, y, width, height` come
from the Yoga frame relative to the parent, `pageX/pageY` are the transformed, scrolled position relative to the engine root (views, not the shadow tree).

Commands (args as React Native's `ScrollViewNativeComponent` commands; lengths in dp):
- `scrollTo`: `[x, y, animated]`; `scrollToEnd`: `[animated]`; `flashScrollIndicators`: `[]`. Animated scrolls report momentum events.
- `focus`, `blur`: `[]`. Calls public `focus()` / `blur()` on the view if its class has them (EngineInput), else `requestFocus()` / `clearFocus()`.
- anything else logs a warning.

`setNativeProps` keys (also under `style`, object or array of objects): `opacity`, `backgroundColor`, `borderColor` (processColor int or "#rrggbb"),
`borderRadius` (+ the four `border*Radius`), `borderWidth`, `transform` (array of `translateX/Y`, `scale`, `scaleX/Y`, `rotate`/`rotateZ`
as "45deg"/"1rad"/number, or a 16-number matrix; decomposed like prop 6, order-insensitive), `overflow`, `pointerEvents`, `zIndex`, `elevation`,
`accessibilityLabel`, `testID`, `accessible`, `accessibilityRole`, and for scroll views `scrollEnabled`, `showsVertical/HorizontalScrollIndicator`,
`scrollEventThrottle`. Implementation: the view's current values are read back into a `PropSet`, the given keys are laid over it and `Props.applyCommon`
runs (full-record semantics preserved). Fabric still owns the props: the next commit that changes them overwrites native values.

### Accessibility (A11y.kt)

- `accessibilityLabel` (11) -> `contentDescription`.
- New prop 12 `accessible: int` -> `isFocusable`, and `importantForAccessibility = YES` (otherwise AUTO).
- New prop 13 `accessibilityRole: string` -> an `AccessibilityDelegateCompat` that sets the node class (`button` Button, `imagebutton`, `image`, `checkbox`, `radio`, `switch`),
  `isHeading` (`header`) or `roleDescription` (`link`, `search`, `tab`, `alert`).
- `testID` (10) -> `view.tag` and `AccessibilityNodeInfo.viewIdResourceName` through the same delegate (uiautomator `resource-id`, as React Native does). It is NOT copied into
  `contentDescription`, because TalkBack would read it and it would shadow text; `A11y.TEST_ID_AS_CONTENT_DESCRIPTION = true` makes it the fallback when there is no label.
- `EngineText` is `IMPORTANT_FOR_ACCESSIBILITY_YES`, class name `android.widget.TextView`, and `onInitializeAccessibilityNodeInfo` sets `info.text` to the visible text, so uiautomator dumps show
  `text="Row N"`.

### Files

New: `cpp/TouchDispatch.cpp`, `cpp/Commands.cpp`, `java/.../Commands.kt`, `java/.../A11y.kt`, `java/.../views/HitTest.kt`, `SPEC-input.md`.
Rewritten: `views/EngineRoot.kt`, `views/EngineScroll.kt`. Edited (small): `views/EngineView.kt` (stacking, onTouchEvent, NodeState fields), `views/EngineText.kt` (accessibility),
`Props.kt` (prop 9, 12, 13, 33, stacking, a11y call), `MountingManager.kt` (`viewFor`, `scrollThrottle`), `SvelteEngineModule.kt` (functions), `SvelteEngineNative.kt/.h/.cpp`
(signatures, `updateScrollState`), `PropsEncoder.cpp` (props), `MountingDelegate.h/.cpp` (scroll state registry).

## Animation (phase 3, Android)

Reanimated drives engine views from the UI thread without React Native's ViewManagers.

- Wiring: `patches/react-native-reanimated@4.5.1.patch` adds `com.swmansion.reanimated.SvelteEngineHook { @JvmStatic var updater: ((viewTag: Int, props: ReadableMap) -> Boolean)? }` and `NativeProxy.synchronouslyUpdateUIProps` calls it first (before the `applySimpleProps` fast path and React Native's string dispatch). `SvelteEngineModule.install` sets it through reflection (no Gradle dependency on Reanimated) to `MountingManager.applyAnimated(tag, props)`: registry lookup, `false` for unknown tags (React Native views keep their path), otherwise `AnimatedProps.apply`. Main thread only (Reanimated calls it on the UI thread).
- Fast-path props (`AnimatedProps.kt`, direct setters, `hasKey` lookups, no allocation for `{opacity, transform}`): `opacity`; `transform` (array of single-key `translateX|translateY|scale|scaleX|scaleY|rotate|rotateZ` entries, dp and radians/"deg"/"rad", accumulated like `setNativeProps`; or a 16-number matrix decomposed exactly like prop 6: translation m12/m13, `hypot` of rows 0/1, `atan2(m1, m0)`); `backgroundColor` (processColor int); `borderRadius` (dp, all corners); `zIndex`, `elevation` (dp); on `EngineText` `color` and `fontSize` (dp; layout rebuilt only when a value changed; not for prepared layouts; applied to every fragment; ignores the font scale multiplier). `width`, `height`, `shadowOpacity` and any other key are ignored (layout goes through the shadow tree). Transforms pivot at the view centre through `Props.setTransform`, shared with `applyCommon`.
- Committed props win: the animated write only mutates the Android View (and `NodeState` for bg/radii/stacking). When the next Fabric commit carries props for that view, `applyCommon` writes the committed opacity/transform/background over them, exactly as with React Native plus Reanimated (Reanimated's own props registry re-applies its values on its next frame / commit).
- Layout animations (entering, exiting, layout): our `SurfaceHook` no longer attaches the delegate at install; it appends it on each surface's first commit seen by our commit hook. Reanimated's hook (registered when its module proxy is created, at JS import, before `install`) runs earlier in the same commit and has already appended its `LayoutAnimationsProxy`, so the order is [Reanimated, ours]: the proxy rewrites the real mutations (holds back Remove/Delete of exiting views, inserts entering views, frames go through `synchronouslyUpdateUIProps` to `AnimatedProps`) and we mount the result. Late Deletes are fine: emitter/state erases are idempotent and Kotlin lookups are nullable. JS passes `reanimatedReady` to `install`; the first transaction per surface logs `SvelteEngine: delegate order: <reanimated|ours> first` (inferred from that flag; the coordinator's delegate list is private). If Reanimated loads after install the order is [ours, Reanimated] and layout animations silently do nothing, as before. JS side: `entering`/`exiting`/`layout` on `AnimatedView` (`src/fabric/animation.ts`). Shared element transitions are not supported.
- Benchmark: module function `SvelteEngine.benchAnimated(tag: Int, iterations: Int): Double` applies `{opacity, transform: [{translateX}]}` (alternating values, 200 warm-up calls) on the main thread and returns microseconds per call, -1 if the tag is unknown. Target <= 5 us.
- Still through React Native for engine tags: nothing in `synchronouslyUpdateUIProps`. Reanimated's non-synchronous path (`ReanimatedModuleProxy` commit of updated props via `UIManager::updateShadowTree` / `cloneShadowTree`) goes through Fabric commits, which our delegate mounts; `scrollTo`/`measure`/`dispatchCommand` Reanimated helpers (`scrollTo`, `measure`, `setNativeProps` worklets) still use React Native's `UIManager` and do not find engine tags.

- Lazy Reanimated (boot): the Fabric host imports Reanimated on the first node with `animatedStyle`, `entering`/`exiting`/`layout` or CSS animation/transition keys, not at start (≈ 90 ms of boot on the A16). Reanimated's commit hook then registers after ours, so its `LayoutAnimationsProxy` would land behind our delegate. `SvelteEngineModule.reanimatedLoaded()` → `SvelteEngineNative::reanimatedLoaded()` fixes the order: it marks every seen surface for re-attach in two commits and runs two empty commits per surface (`ShadowTree::commit` with an unchanged root clone). During the first, Reanimated's hook appends its proxy; during the second, `SurfaceHook` appends a fresh `DelegateHandle` (the chain holds delegates as `weak_ptr`, so the old handle drops out). The animated commit that triggered the load then already runs proxy-first. When Reanimated was present at install (`install(reanimatedReady = true)`), nothing changes.

## Insets and keyboard (phase 5, Android)

`Insets.kt` reports the overlay's safe-area and keyboard insets to JavaScript. No view, no C++ record, no prop ids.

- Module surface: `Events("insets")` and `Function("getInsets")` (synchronous, main-thread blocking up to 500 ms; `null` before the overlay is attached to a window). `install()` creates the tracker after the overlay is attached.
- Payload, all numbers dp: `{ top, right, bottom, left, keyboardHeight, keyboardVisible, frame: { x, y, width, height } }`. `top/right/bottom/left` are `systemBars() | displayCutout()`; `keyboardHeight` is how much of the overlay the IME covers (0 when hidden); `frame` is the overlay in window coordinates, so `frame.height - keyboardHeight` is the keyboard's top edge in overlay coordinates (the coordinate space of the host's `measureInWindow`). Emitted only when the record changes.
- Source: `ViewCompat.getRootWindowInsets(root)`, never the listener's argument. Each edge is reduced by the overlay's own gap to that window edge. Edge-to-edge (`edgeToEdgeEnabled=true` today): the overlay fills the window, so the values are the real bars and cutout. Legacy layout: the decor pads the content view, the gap equals the bar, and the values are 0. Both are correct without any mode check.
- Triggers: an `OnApplyWindowInsetsListener` on `EngineRoot` (returns the insets unchanged, consumes nothing), a layout-change listener, and attach. During an IME animation (`WindowInsetsAnimationCompat.Callback`, `DISPATCH_MODE_CONTINUE_ON_SUBTREE`) per-frame dispatches are ignored: the end state is emitted at `onPrepare` (root insets already hold it) and again at `onEnd`, so JavaScript lays out once per change, not per frame.
- JavaScript: `src/fabric/insets.ts` (`subscribeInsets`, payload types, padding math), `src/insets.svelte.ts` (`insets` store, `connectInsets`), `SafeAreaView` (padding = style's own padding + inset on `edges`, default all), `KeyboardAvoidingView` (`padding`, `height`, `position`, `keyboardVerticalOffset`, `enabled`, measured with `measureInWindow`). The React host path is unchanged (registry components).
- Gaps: no keyboard animation on the JS side (the padding steps once at animation start); a `Modal`'s layer insets its own content frame by the bars (unless it is translucent under them), so a `SafeAreaView` inside a modal that is not translucent pads a second time, as in React Native; API 24-29 IME values depend on the compat shim; no device verification yet.

### Insets and keyboard on iOS (`SvelteInsets`)

Until iOS wave 4 the store was Android-only: `subscribeInsets` looked for the `SvelteEngine` module, which iOS does not have, so on an iPhone every inset was 0 (no safe area, no keyboard avoidance, `Screen` sized its sheet box from nothing). The module `apps/platform/modules/svelte-insets-ios` (Swift, Expo) has the same surface, under its own name because `SvelteEngine` being present tells the host that the Android engine is installed: `Events("insets")` and the synchronous `getInsets()`, same payload in points (`top/right/bottom/left` = `UIWindow.safeAreaInsets`; `keyboardHeight` = how much of the window the keyboard's end frame covers, from `keyboardWillChangeFrame`/`keyboardWillHide`, sent at the start of the animation; `frame` = the window). A zero-alpha probe view in the key window hears `safeAreaInsetsDidChange` and layout (rotation); a value is sent only when it changed. `fabric/insets.ts` looks for `SvelteEngine` first and `SvelteInsets` second.


### Activity recreation

The overlay (`EngineRoot`) is added to the Activity's content view at install. A recreated Activity (a font-scale or locale change; rotation is handled in place through `configChanges`) gets a new content view and a new surface: React Native's lifecycle listener (`onHostResume`, not an Expo hook, since the module is registered lazily after the hooks are collected) moves the overlay to the current Activity, and `EngineRoot.surfaceId` follows the surface that mounts, so touches go to the live surface. Before this the recreated window stayed black. A stack that leaves the window with a transition in flight lands it (`EngineStack.land`): the screen takes the transition's end values and the end's work runs (the removal of a popped view, `exited`, `dismissed`), so nothing JavaScript waits for goes with the animator.

The JavaScript runtime survives a recreation (the `ReactHost` is the application's), the React surface does not: the old Activity's `onDestroy` makes `ReactDelegate.unloadApp` stop its surface (`stopSurface` reaches `RN$stopSurface`, `fabric/hmr.ts` `stopApplication`) and the new one's `onCreate` starts another (`AppRegistry.runApplication("main", { rootTag, initialProps })`, `launchSurface`). That pair is how recreation is recognised, and the root router's state goes across it exactly as across a hot update: every navigator's stack and tab selection come back, and the launch link in the Activity's unchanged intent is not opened a second time. The order of the pair is not fixed (`ReactActivityDelegateWrapper.onDestroy` posts the stop to the main looper, while the new Activity's `onCreate` runs in the same message as the old `onDestroy`, so the new surface may start first); both orders are handled. See "Navigation state across recreation and process death" in the route-tree section; the same state also survives the process being killed.

## Navigation (stack container)

The Svelte router renders `native-stack` / `native-screen`. On the engine they are plain `RCTView` shadow nodes (no codegen component); the Fabric host (`packages/svelte-native/src/fabric/navigation.ts`) sets `nativeID` and default styles. No react-native-screens.

### Kinds and props

| kind | recognised by | Kotlin view | Yoga |
|---|---|---|---|
| 10 Stack | `RCTView` with `nativeID == "svelte:stack"` (`kindForView`, `PropsEncoderNav.cpp`) | `EngineStack : EngineView` | `flex: 1` |
| 11 Screen | `RCTView` with `nativeID` starting `svelte:screen` | `EngineScreen : EngineView` | `position: absolute` filling the stack |

The screen props travel in the `nativeID` because `RCTView` has no codegen props for them and `Props::rawProps` depends on feature flags: `svelte:screen;a=<activityState>;p=<push|modal|transparentModal>;g=<0|1>;s=<stackAnimation>;b=<0|1>`. C++ decodes it into one record:

| id | values | kind |
|---|---|---|
| 110 | activityState (0 detached/inactive, 1 transitioning, 2 active), stackPresentation (0 push, 1 modal, 2 transparentModal), gestureEnabled (0/1, default 1), stackAnimation (0 default, 1 none, 2 fade, 3 slide_from_right, 4 slide_from_bottom), nativeBackButtonDismissalEnabled (0/1, default 1) | 11 |

Ids 111..119 stay free. The common records (1..13) still arrive; on a screen the engine ignores `transform` (6) and `opacity` (2) because the stack owns its translation and alpha.

### Events

`NavEvents.dismissed(tag)` (Kotlin object, native in `PropsEncoderNav.cpp`) calls `EventEmitter::dispatchEvent("dismissed", { dismissCount: 1, target })` on the screen's emitter: `topDismissed`, which the Fabric host's `dispatchEvent` maps to the `onDismissed` attribute (no view config entry needed: unknown `topX` falls back to `onX`). `onAppear` / `onDisappear` are not sent.

### Behaviour

- Top screen: the last live (not leaving) screen with `activityState == 2`. Only it takes touches (`EngineScreen.touchable`, honoured by `HitTest`). Lower screens stay visible under a modal; a settled push screen under another settled push screen is hidden (`EngineScreen.setHidden`: alpha 0, `IMPORTANT_FOR_ACCESSIBILITY_NO_HIDE_DESCENDANTS`, focus cleared; the view, its subtree and every display list stay — `INVISIBLE` was dispatched to every descendant and re-recorded the whole screen when it came back, 5–13 ms per pop). The stack owns screen visibility (`refresh()`); `MountingManager.applyLayout` hands `display: none` to `EngineScreen.displayNone` instead of setting `visibility`.
- Push: an INSERT of a screen above at least one other live screen, with the stack laid out, plays 250 ms (decelerate): translationX width to 0 for push, translationY height to 0 for modal, alpha 0 to 1 for transparentModal; `stackAnimation` overrides, `none` skips. The first screen of a stack never animates.
- Pop (JavaScript removed it): `MountingManager` routes REMOVE of a screen child to `EngineStack.removeScreen`. When the screen is topmost, others remain, the stack is laid out and the animation is not `none`, the view stays attached, is marked `leaving` (no longer live: the screen below becomes top and touchable at once) and slides out (reverse of its entry); the view is detached when the animation ends. Fabric's DELETE follows REMOVE in the same batch and only drops the registry entry, so the exiting view (and its subtree) is simply held by the stack. Other removals in the same batch (several screens popped at once), removals with nothing below, and removals of a `dismissed` screen detach immediately. A re-INSERT of a leaving tag cancels its exit.
- Back button: `EngineStack` registers an `OnBackPressedCallback` on the activity's dispatcher (found with `findViewTreeOnBackPressedDispatcherOwner`; added after React Native's, so it runs first). Enabled while the top screen is not the first and `nativeBackButtonDismissalEnabled` is true; false leaves back to JavaScript (`BackHandler`). Pressed: the exit animation plays (from the current position), then `onDismissed` is sent, and the screen is marked `dismissed` (leaving) the whole time, so the removal the router performs afterwards detaches it without animating again. If JavaScript does not remove it within 1.5 s the screen slides back in.
- Predictive back (API 34+, `handleOnBackStarted/Progressed/Cancelled`): while the system gesture is in progress the top screen follows the progress (translationX up to 20 % of the width, scale down to 0.92) and the screen below shows; cancel animates back, commit continues as a pressed back. Needs `gestureEnabled`.
- Edge swipe back: `EngineStack.onInterceptTouchEvent` takes a horizontal drag that starts within 24 dp of the left edge (push presentation, `gestureEnabled`, a screen below); `EngineRoot.cancelActiveTouch()` sends JavaScript the touch cancel, as a scroll does. The top screen tracks the finger; past a third of the width or a fling over 800 dp/s it completes (exit, then `onDismissed`), otherwise it springs back in 150 ms.
- `activityState` 0 hides the screen (the same alpha-0 hiding) and removes it from touch; 1 shows it without touch.

### Files

`cpp/PropsEncoderNav.{h,cpp}` (kinds, record 110, `dismissed` native), `PropsNav.kt` (`NavProps`, `PropsNav.decode`, `NavEvents`), `views/EngineStack.kt`, `views/EngineScreen.kt`. Small edits elsewhere: `Kind` enum and `encodeProps` (PropsEncoder), `kindForView` in `MountingDelegate.cpp`, `emitterForTag` in `InputEvents`, `registerNavEventNatives` in `SvelteEngineNative.cpp`, `PropSet.nav` / record dispatch / screen exemption from opacity and transform in `Props.kt`, create/insert/remove/layout cases in `MountingManager.kt`, the screen filter in `HitTest.kt`, and `androidx.activity` in `build.gradle`.

### Not done

Device verification of every transition; `onAppear` / `onDisappear`; header/title (`native-stack` has none); `fullScreenSwipeEnabled`, `sheet` and `formSheet` presentations; swipe-down dismissal of modals; `transparentModal` keeps the screen below visible but not touchable only through the top screen's own area.

## Text parity (views/EngineText.kt, TextLayouts.kt, PropsEncoder.cpp records 20-24)

`TextLayouts.build(spec, width, height)` mirrors `TextLayoutManager` (React Native 0.8x) so the draw equals what Yoga measured through it.

- Spans: one `FragmentSpan` (a `MetricAffectingSpan`) per fragment applies, in React Native's order, foreground colour, background colour, opacity, letter spacing (px / pixel size, in em), size (`ceil` of the scaled size, as `TextAttributeProps.setFontSize`), typeface by weight/style/family (`ReactFontManager`, `Typeface.create(..)`), the linear/subpixel paint flags only for a fragment with an explicit weight, style or family as React Native's `CustomStyleSpan` does (default text keeps the hinted paint so its advances match what React Native measured; otherwise text sized exactly to its measured width wraps), underline, strike-through and shadow. `LineHeight` (a `CustomLineHeightSpan` copy) per fragment with a line height. Span flags as the optimized builder: first fragment `INCLUSIVE_INCLUSIVE`, others `EXCLUSIVE_INCLUSIVE`. A single plain fragment (no decoration, transform, opacity, shadow, variant) skips spans and uses the base paint.
- Layout: `StaticLayout` with `includeFontPadding`, break strategy, hyphenation frequency from record 23 (the `ParagraphAttributes`), `setUseLineSpacingFromFallbacks`, justification inter-word for `textAlign: justify`, `maxLines` + ellipsize (head/middle/tail; clip = none) only when `numberOfLines > 0` (ellipsized with spans like React Native). No `BoringLayout` (same output, one class fewer).
- `textTransform`: C++ keeps the raw string on Android (the Java builder applies it), so Kotlin applies it per fragment (`TextTransform.apply`: upper/lower with the default locale, capitalize per word via `BreakIterator`), record 24.
- Alignment: `getTextAlignment` with paragraph direction (record 23 `rtl`, the view's Yoga layout direction) versus script direction (`FIRSTSTRONG_LTR`): normal and opposite swap when they disagree; `center`, `right` as React Native; `auto`/`left` follow the swap, so `textAlign: auto` follows layout direction.
- `adjustsFontSizeToFit`: `adjustSpannableFontToFit` ported (binary search, ratio-scaled sizes, minimum 4 dp or `minimumFontSize` read as px like React Native, stops on lines/height/single-glyph width); the box height is the view frame minus padding, so the layout is rebuilt on height change (`EngineText.heightMatters`).
- `textAlignVertical`: `getVerticalOffset` (center/bottom, 0 when the text is taller than the box), added to the top padding when drawing.
- Prepared layouts (record 22): when the paragraph state carries React Native's `PreparedLayout` (`enablePreparedTextLayout`), it is drawn as is (`layout.draw`) at padding + its own `verticalOffset`; our layout is skipped. Reflection: class `com.facebook.react.views.text.PreparedLayout` (Kotlin `internal`, public JVM class, `@DoNotStrip`), methods `getLayout()` and `getVerticalOffset()` (`PreparedLayout.kt` constructor vals), fallback to the private fields `layout` and `verticalOffset`; resolved once, failures yield no layout.
- Props-only text updates (e.g. only the background changed, so no new state) keep the last fragments and prepared layout; before, the text vanished until the next state.
- `onTextLayout`: Fabric's `ParagraphShadowNode::layout` already calls `TextLayoutManager.measureLines` (`FontMetricsUtil`) and `ParagraphEventEmitter::onTextLayout` when the prop is set, independent of the mounting layer, so no engine work (the host maps `topTextLayout` to `onTextLayout`).
- Gaps: `selectable` (long-press selection needs a `TextView`; not done), links/`ClickableSpan` and inline views (attachments), `fontVariant` beyond the listed bits, `lineBreakStrategyIOS`, `dynamicTypeRamp`. A pressed `<Text onPress>` is handled by touch dispatch to the shadow node, not spans.

## Scroll props (views/EngineScroll.kt `ScrollBridge`, records 33-39, 14)

- `contentOffset` (34): initial offset, applied once from `onLayout` as soon as the content child has its Yoga frame (only on creation).
- `scrollTo(animated=false)` jumps immediately after aborting any running fling/snap; `scrollToEnd(animated)` goes through `scrollToPx`, so animated calls emit momentum begin (3) and, after three idle 20 ms checks, momentum end (4), as does a programmatic `scrollTo`.
- Snapping: `pagingEnabled`, `snapToInterval`, `snapToOffsets`, `snapToAlignment`, `snapToStart/End`, `disableIntervalMomentum` (record 35/36). The JS ScrollView already sets `pagingEnabled` on Android whenever snap props are used; `snapping` is also true for an interval or offsets alone. `fling()` of both views calls `ScrollBridge.flingAndSnap` (port of `flingAndSnap`/`smoothScrollAndSnap`/`predictFinalScrollPosition` for both axes, using a temporary `OverScroller` with the view's friction for the prediction and the view's own `mScroller` (reflection, like React Native) flung with min = max = target); a release with no fling velocity page-aligns from the post-touch runnable (once, like `mSnappingToPage`). Without `mScroller` it falls back to `smoothScrollTo`.
- `decelerationRate` (37): friction `1 - rate` on `mScroller`; 0.998 (Fabric default and 'normal') leaves Android's friction, because the default cannot be told from an explicit value.
- `keyboardDismissMode` (38): `on-drag` and `interactive` hide the IME at drag start (`EngineInput.blur()` on the focused engine input, else `hideSoftInputFromWindow`). `keyboardShouldPersistTaps` is JavaScript-only (the host handles it).
- `overScrollMode` (39): auto (default; was hard-coded never before) = `OVER_SCROLL_IF_CONTENT_SCROLLS`, always, never. `bounces` and other iOS props are ignored.
- Gaps: `maintainVisibleContentPosition` not implemented; snapping to children (`snapToAlignment` without interval/offsets; Fabric cannot tell an unset alignment from `start`) falls back to page snapping; RTL horizontal scroll not mirrored; `scrollTo`/`flingAndSnap` for `contentInset`/`snapToStart` edge cases as in React Native.

## Screen API contract (header, sheet, tabs)

Status: contract for the native lanes (NA: Android engine views, NI: iOS UIKit bridges); the JavaScript side exists and is tested. Sources of truth, in order: this section, then `packages/svelte-native/src/fabric/navigation.ts` (pure encoders and the reference decoder `decodeRecords`), `src/components/Screen.svelte`, `src/components/Tabs.svelte`, and the golden vectors in `tests/navigation.test.ts`. A native decoder is correct when it produces the same records as `decodeRecords` for every vector. It extends "Navigation (stack container)" above (record 110, kinds 10 and 11) and specifies what that section lists under "Not done" (header, `sheet` and `formSheet`, `onAppear`/`onDisappear`); nothing there changes except two new `stackPresentation` codes.

Both platforms expose one API. The encoders are platform-neutral: iOS uses the same `nativeID` strings (the iOS components are `ViewProps`-derived and read `nativeId` from the base props; no codegen props, no `navigation.ios.ts` encoder fork). Until the native views land, every new tag maps to `RCTView` on both platforms (`viewNames` in `fabric/host.ts`) and renders as a plain view; NI changes the iOS names in that table.

### API

```svelte
<Screen title="Inbox" subtitle="3 unread" header={{ large: true }} canGoBack
        statusBar={{ style: "dark" }} onAppear={...} onDisappear={...}>
  {#snippet headerRight()}<Pressable onPress={compose}>…</Pressable>{/snippet}
  <ScrollView>…</ScrollView>
</Screen>
```

| prop | type | default | meaning |
|---|---|---|---|
| `title`, `subtitle` | string | none | native title (one line, tail ellipsis) and the smaller line under it |
| `header` | `{ hidden, large, translucent, hideBack, backTitle, tint, background, hideShadow }` | `{}` | see below |
| `headerLeft`, `headerCenter`, `headerRight` | snippet | none | custom content of the slots; `headerCenter` replaces the native title and subtitle |
| `headerSearch` | snippet | none | content shown over the screen while the search is active (suggestions, results) |
| `search` | `{ value, placeholder, onChangeText(text), onSubmit(text), onCancel() }` | none | adds a search field to the header; `value` absent = uncontrolled |
| `presentation` | `push \| modal \| transparentModal \| sheet \| formSheet` | `push` | how the screen enters; changing it after mount is not supported |
| `sheet` | `{ detents, initialDetent, grabber, dismissible, backdrop }` | see below | `sheet` and `formSheet` only |
| `statusBar` | `{ style: auto \| light \| dark, hidden }` | `auto`, shown | `light` = light icons (for a dark background); `auto` follows the system appearance |
| `navigationBar` | `{ color, style }` | transparent, `auto` | Android only (iOS ignores it) |
| `animation`, `gestureEnabled`, `nativeBackButtonDismissalEnabled`, `activityState` | as in "Navigation" | | stack plumbing the router sets; `activityState` 0 on a live screen means "leave", see "Screen exit" |
| `canGoBack` | boolean | false | the stack has a screen below; the router sets it (`entries.length > 1`, index > 0) |
| `style` | style | none | the screen view (a background color goes here) |
| `onAppear`, `onDisappear`, `onDismiss`, `onExited`, `onDetentChange({ index, fraction })` | functions | none | see "Events"; `onExited` is the router's (see "Screen exit") |

`header`: `hidden` no header node at all; `large` large title (a second row of 56 dp / 52 pt) that collapses with the screen's first scroll view; `translucent` the header overlays the content; `hideBack` no back button; `backTitle` iOS back button label (Android: accessibility label of the arrow); `tint` icons, back button and title text; `background` bar color (default: the system surface); `hideShadow` no divider. `sheet`: `detents` fractions in (0, 1] of the space below the top inset or `"auto"` (content height), ascending, at most 4, default `[0.5, 1]`; `initialDetent` one of `detents`, default the first; `grabber` default true (`formSheet`: false); `dismissible` default true (drag down, backdrop tap, back); `backdrop` `dim` (default) or `none` (no scrim, the screen behind stays interactive).

Exports: `useHeader()` (`Screen.svelte` module script) returns `{ height, inset }`, reactive, of the nearest screen's header (0 without one). `inTabPane()` is true inside a tab pane, which ends at the tab bar and so covers the bottom inset (a page pads the bottom inset itself only outside a pane). `Tabs` (below). The integration lane adds `Screen`, `Tabs`, `useHeader` and the option types of `fabric/navigation.ts` (`ScreenOptions`, `HeaderOptions`, `SheetOptions`) and of `Tabs.svelte` (`TabItem`, `TabHandle`) to `src/index.ts`, and typed entries for the new tags to `elements.d.ts` (until then the tags take any attributes).

#### Defaults decided here

- The header is opt-in: shown when `title`, `subtitle`, `header`, a header snippet or `search` is given and `header.hidden` is not true (existing routes keep their look).
- The back button is drawn by the engine when `canGoBack`, the presentation is `push`, `hideBack` is not set and there is no `headerLeft` (a custom left slot replaces it, as in UIKit and Material). Modals, sheets and transparent modals get no automatic close button: the arrow means "pop", and the screen's own `headerLeft`/`headerRight` carries the close button. The system gestures (back key, edge swipe, swipe down, VoiceOver escape) always dismiss unless `dismissible: false` or `gestureEnabled: false`.
- Title alignment: iOS centered (large title start-aligned), Android start-aligned after the back button. A `headerCenter` slot follows the same alignment.
- The header divider shows once the first scroll view has scrolled under the header, and always when there is no scroll view (UIKit's scroll edge behaviour and Material's scrolled state).
- `formSheet` is one fixed detent (1) below the top inset, grabber off; phones only in v1 (no iPad centered card).
- A tab press switches at once and the owner's `selected` decides afterwards; back at a tab's root leaves the app (no tab switching); the tab bar stays visible when a tab pushes screens; modals and sheets presented on the root stack cover it; switching tabs has no animation.
- Colors on the wire are `rrggbbaa`; accepted inputs are `#rgb`, `#rgba`, `#rrggbb`, `#rrggbbaa`, `rgb()`, `rgba()`, `transparent` and React Native's processed numbers. Named colors and platform colors are ignored (the system theme applies).

### Layout rules (both platforms)

Constants (`fabric/navigation.ts`, dp on Android, pt on iOS): header bar 56 / 44, large title row 56 / 52, tab bar 64 / 49, back button width 48, tab icon 24. The status bar inset (header) and the bottom inset (tab bar) come from the insets store.

- Header band: `native-header` is a Yoga node of `height = inset + bar (+ large row)` with `paddingTop = inset` and `paddingStart = 48` when the back button is shown, `flexDirection: row`, `alignItems: center`. It is in flow (content starts below it) unless `large` or `translucent`, then it is `position: absolute` over the content. The native side draws the chrome (background, title, back arrow, divider) in that band and reports its real size with `onMetrics { height, inset }` (dp; after the first layout and whenever either changes). JavaScript uses the estimate until the first report and applies a report only for the `large` state it was measured in. On Android the estimate is exact; on iOS it covers the common case and the report corrects dynamic type and the Dynamic Island.
- Under an in-flow header, content must not pad the top inset again (`SafeAreaView edges` without `top`). Under a `large` or `translucent` header the screen's first scroll view (first `native-scroll` in document order, the lists included) is inset natively by the header's current height: never pad it. Scroll offsets seen by JavaScript are measured from the inset-adjusted rest position on both platforms (0 at rest). Other content pads itself with `useHeader().height`.
- Slots: `native-header-left|center|right` are Yoga rows (`alignItems: center`; `center` has `flex: 1` and `justifyContent` center on iOS, flex-start on Android). Yoga sizes them; the iOS bridges take only the size from Yoga and place the view in the bar, Android places them at their Yoga frames. `native-header-search` is absolute from the header's bottom edge (`top: 100%`) to the surface bottom; it hosts the `headerSearch` content and is shown only while the search is active.
- Sheet box: `native-screen` with `p=sheet` is bottom-anchored (`position: absolute; left/right/bottom: 0`) with `height = tallest fractional detent × available`, `available = surface height − top inset` in dp; with an `"auto"` detent the height follows the content (`minHeight` the tallest fraction) and `maxHeight` is `available`. `formSheet`: `top = top inset`, full width, down to the bottom. The native side moves and clips that box between detents; it never resizes the Yoga frame. Fraction 1 is the top inset line on both platforms (UIKit's detent resolver uses `fraction × (container height − safeAreaTop)`).
- Tab panes: `native-tab` is `position: absolute; top/left/right: 0; bottom: tab bar height` (inset included). All panes stay laid out; the engine shows the selected one and hides the rest (no touch, no accessibility). `native-tabs` is `flex: 1`; the bar is drawn in the band below the panes and reports `onMetrics { height, inset }` (inset = bottom inset).

### Screens, headers and tabs in the tree

```
native-stack
  native-screen          nativeID svelte:screen;…       (kind 11)
    native-header        svelte:header;…                (12)  absent when the header is not shown
      native-header-left | -center | -right  svelte:header-left …  (13) only the slots given
      native-header-search                   svelte:header-search;… (13) only with `search`
    native-view          content, flex: 1
native-tabs              svelte:tabs;…                  (14)
  native-tab             svelte:tab;…                   (15)  one per item, in order; its pane
    native-tab-icon      svelte:tab-icon                (16)  only for a snippet icon
    …pane content (the tab's own native-stack)
```

Nested `Screen`s: the outermost `Screen` of a stack entry renders `native-screen`, the header and the content view; a `Screen` inside another (a page inside the router's screen, a page inside a layout's) renders only its content and registers its options with the outer one (`mergeScreenOptions`: the inner value wins per option, object options merge key by key, `onAppear`/`onDisappear`/`onDismiss`/`onDetentChange` all run, outer first). The router renders the outer `<Screen presentation={route.presentation} canGoBack={index > 0} onDismiss={() => router.dismissed(key)}>` around each route (replacing its inline `native-screen`); a page configures it with its own `<Screen>`. `Tabs` resets the screen context for its panes, so a pane's stack renders real screens of its own; so does `Modal` for its content (a layer of its own, which also clears the tab pane: a modal covers the tab bar and pads its own bottom inset), where a `Screen` is the outermost one: its header is drawn inside the modal and its title is not handed to the screen around the `<Modal>` (test: "a Screen inside a Modal"). iOS draws a screen's header only under a `native-stack` (`SvelteStackView` is the one caller of `SvelteScreenView update`), so the outermost `Screen` of a subtree no stack holds (a `Modal`'s content, the app shell's startup pages) renders inside a one-entry `<Host name="native-stack">` of its own (`canGoBack` false, no exit contract); a `native-stack` host marks its subtree (`IN_STACK_CONTEXT`), `Modal` and `Tabs` clear the mark (test: "a Screen with no stack above it is a one-entry stack"). `Screen` and `Tabs` take snippets and keep component state (merging, context, the select count), so they are components and are not in `LOWERED_TAGS` (`lower.ts`); the lowering preprocessor leaves them alone (test: "Screen and Tabs stay components").

### Tabs

- Drawing: `TabItemView` rounds the icon, pill and badge origins to whole pixels (half-pixel origins anti-alias differently from one layout to the next; the parity suite saw icons 1 px apart between launches). The label's direction is baked in when it is built: `onRtlPropertiesChanged` drops it so a direction resolved after the first build (the view inherits it once attached) rebuilds the label and lays the bar out mirrored.

```svelte
<Tabs items={[{ key: "home", title: "Home", icon: homeAsset, selectedIcon: homeFilled },
              { key: "inbox", title: "Inbox", icon: glyph, badge: 3 }]}
      selected={current} onSelect={(key) => (current = key)} tint="#0a84ff">
  {#snippet content(tab)}<TabStack {tab} />{/snippet}   <!-- creates its router with { scope: tab.key, active: () => tab.selected } -->
</Tabs>
```

`items[]`: `key`, `title`, `icon` (an asset: `require` number or `{ uri }`, drawn as a template image and tinted; or a snippet `(selected: boolean)`), `selectedIcon` (asset), `badge` (text, a number, or `true` for a dot; numbers above 99 read "99+"), `disabled`, `accessibilityLabel` and `testID` (these two label the tab bar item, not the pane). Props: `selected` (key), `onSelect(key)`, `content(tab)` snippet with `tab = { key, selected }` (`selected` reactive), `lazy` (default true: a pane mounts on first selection, then stays mounted), `tint`, `inactiveTint`, `background`, `labels` (`always` | `never`). Snippet icons are alpha masks: Android draws the live snippet at 24 dp and tints it; iOS snapshots it to a 24 pt template `UIImage` (`UIGraphicsImageRenderer`, `.alwaysTemplate`; once per commit that changes the `native-tab-icon` subtree) because `UITabBar` takes images only.

Controlled selection: a press switches the bar and shows that pane immediately, emits `topSelect { key, index }`, and `Tabs` increments the select count `sc` on every press. The native side applies `sel` from the props whenever `sel` or `sc` changed, so an owner that ignores `onSelect` puts the bar back with the next commit.

Router scope (implemented in `router.svelte.ts` and `Router.svelte` by the integration lane after B1; type `RouterScopeOptions` in `fabric/navigation.ts`): `createRouter(tree, initial, { scope, active })` (a hand-made pane gives a one-stack tree) names a router (`"root"` for the outermost one by default) and registers it under that name as well as in the nearest-router context; `useRouter(scope?)` returns the nearest router, or the nearest ancestor named `scope`, so a screen inside a tab can push a modal on the root stack with `useRouter("root").goto(...)`. The hardware back key and links are the outermost router's alone (one registration, see "Route tree" Decisions): the key goes to the innermost active router (`router.active()`, default true, a hand-made tab's own stack while its tab is selected), and a router with one entry hands the pop outward and returns false at the root so the next handler runs; the engine disables the Android back callback of a stack whose tab is not selected. Hot-reload state is kept per scope (`hmrState` key = scope). Each tab's router is created inside its pane (a component under the `content` snippet), so each has its own stack; the root route that renders `Tabs` is one entry of the root stack.

### nativeID grammar and prop records 120–139

`nativeID = "svelte:" kind *(";" key "=" value)`. Values are `encodeURIComponent` output (no raw `;`, `=`, `,`, `%`), a list is its items encoded and joined by `,`, keys are unique per kind, a missing key means its default, unknown keys are ignored, and an empty value is meaningful only for `bd` (`bd=` is a dot; encoders never emit another empty value). `kindForView` recognises the kind by the prefix; the engine view kinds are 10 stack, 11 screen (existing), 12 header, 13 header slot, 14 tabs, 15 tab, 16 tab icon. Record values use the batch encoding of this file (ints, floats as bits in px or unitless fractions, colors ARGB ints preceded by a `hasColor` flag where optional, strings as `strings` indices with -1 for absent). The meaning column gives the default of an absent key.

| kind | keys (wire) | meaning, default |
|---|---|---|
| `screen` | `a p g s b` | as record 110 (always present, in this order); `p` also takes `sheet`, `formSheet` |
| | `dt` | detents, list of fractions or `auto` (sheet; default `0.5,1`) |
| | `di` | initial detent index (default 0) |
| | `gr` | grabber: `0` off (sheet, default on), `1` on (formSheet, default off) |
| | `dm=0` | not dismissible (sheet, formSheet) |
| | `bd=1` | no backdrop (sheet, formSheet) |
| | `ss`, `sx=1` | status bar style `l`/`d` (default auto), hidden |
| | `nc`, `ns` | navigation bar color, style `l`/`d` (default auto) |
| `header` | `t st bt` | title, subtitle, back title |
| | `l=1 tl=1 bk=1 hs=1` | large, translucent, back button shown, no divider |
| | `tc bg` | tint, background (default system) |
| | `sl` | slots present: bit 1 left, 2 center, 4 right, 8 search |
| `header-left`, `header-center`, `header-right` | none | slot identity only |
| `header-search` | `ph v ec` | placeholder; value (absent = uncontrolled); acknowledged event count (default 0) |
| `tabs` | `sel sc` | selected index (default 0), select count (default 0) |
| | `tc uc bg` | tint, inactive tint, background |
| | `lb=1` | no labels |
| `tab` | `k t` | key, title |
| | `ic is` | icon uri, selected icon uri (`resolveAssetSource` uri: `asset:/`, `file://`, `data:`, https, `res:`) |
| | `iv=1` | icon is a snippet (child `native-tab-icon`) |
| | `bd` | badge text; present and empty = dot; absent = none |
| | `ds=1` | disabled |
| `stack`, `tab-icon` | none | |

Records (C++ `encodeNavProps` emits them after the common records 1..13, in this order per node; ids 111..119 and 128..139 stay free):

| id | values | kind |
|---|---|---|
| 110 | activityState, stackPresentation (0 push, 1 modal, 2 transparentModal, **3 sheet, 4 formSheet**), gestureEnabled, stackAnimation, nativeBackButtonDismissalEnabled | 11 |
| 120 | header: flags (1 large, 2 translucent, 4 back button, 8 no divider), title string, subtitle string, backTitle string, hasTint, tint, hasBackground, background | 12 |
| 121 | header slots: mask (1 left, 2 center, 4 right, 8 search) | 12 |
| 122 | sheet (present for `sheet` and `formSheet`): count (1..4), count × detent (fraction of available height, -1 = auto; formSheet: one detent 1), initialIndex, grabber, dismissible, backdrop (0 dim, 1 none) | 11 |
| 123 | tabs: selectedIndex, selectCount, hasTint, tint, hasInactiveTint, inactiveTint, hasBackground, background, labels (0 always, 1 never) | 14 |
| 124 | tab item: key string, title string, iconUri string, selectedIconUri string, iconIsView, badgeKind (0 none, 1 dot, 2 text), badgeText string, disabled | 15 |
| 125 | system bars (present when any `ss sx nc ns` key is): statusStyle (0 auto, 1 light, 2 dark), statusHidden, hasNavColor, navColor, navStyle (0 auto, 1 light, 2 dark) | 11 |
| 126 | header slot: slot (0 left, 1 center, 2 right, 3 search, 4 toolbar center) | 13 |
| 127 | header search: placeholder string, value string, eventCount | 13 |

The common records still arrive. On a screen the engine ignores `transform` and `opacity` (the stack owns them, as before); the header, slots, tabs and panes honour all common records (`accessibilityLabel`, `testID` on a `tab` belong to its tab bar item).

### Events

Native emits `top<Name>` on the node's emitter (`EventEmitter::dispatchEvent`, payload plus `target`); the host maps it to the `on<Name>` attribute, and the components unwrap `nativeEvent` before calling user handlers.

| node | event (host attribute) | payload | when |
|---|---|---|---|
| screen | `topAppear` (`onAppear`) | `{}` | the screen became visible and its transition finished; the first screen after its first layout |
| screen | `topDisappear` (`onDisappear`) | `{}` | the screen stopped being visible: covered by an opaque screen (`push`, `modal`), its tab deselected, or removed; not for `transparentModal`, `sheet`, `formSheet` above it |
| screen | `topDismissed` (`onDismissed`, public `onDismiss`) | `{ dismissCount: 1 }` | the user dismissed it (back key, edge swipe, swipe down, backdrop, header back button), after the exit transition; never for a JavaScript-initiated pop |
| screen | `topExited` (`onExited`) | `{}` | iOS only for now (see "Screen exit"): JavaScript set the screen's `activityState` to 0 and the stack finished taking it away: after its exit transition, or at once when nothing animates; sent once |
| screen | `topDetentChange` (`onDetentChange`) | `{ index, fraction }` | a user drag settled on another detent; `fraction` is the resolved height over `available` (for `auto`, the measured fraction) |
| header, tabs | `topMetrics` (`onMetrics`) | `{ height, inset }` dp | the first layout, and whenever either value changes |
| header-search | `topChange` (`onChange`) | `{ text, eventCount }` | the user edited the text; `eventCount` counts native edits |
| header-search | `topSubmitEditing` (`onSubmitEditing`) | `{ text }` | the keyboard's search action |
| header-search | `topCancel` (`onCancel`) | `{}` | the search was dismissed (cancel button, back key) |
| tabs | `topSelect` (`onSelect`) | `{ key, index }` | a tab press (also on the selected tab) |

Order at the end of a transition: the new top screen's `onAppear`, then the leaving screen's `onDisappear`, then its `onDismissed` if the user caused it, or its `onExited` if JavaScript did (`activityState` 0). Search text: native owns the field; `v` is applied only when `ec >= the native edit count` (the rule of TextInput's `mostRecentEventCount`), so a rejected edit is put back by the next commit.

### Screen exit (`activityState` 0 and `topExited`)

Status: implemented on iOS (iOS wave 4, 26 Oct 2026) and on Android (integration, 27 Oct 2026: `EngineStack.exitScreen`, below). `EXIT_REPORTED` in `fabric/navigation.ts` is the per-platform switch, both true. Measured on the iPhone SE 3 with the rest of the wave (five launches each, before wave 4 -> now): navigation-8 1.52 -> 0.00 % dropped, sheet-8 1.16 -> 0.00 %; the retention itself costs header-8 about 0.4 point ("Where the time goes"), and a `reset` or `back()` over a presented sheet, form sheet or modal takes it away 1.2 s later (probes `reset-*`, `back-*`).

Why: when JavaScript popped a screen the router removed its `native-screen`, so the page's whole subtree was unmounted in the mounting transaction that also started the exit transition. On iOS that is React Native's `unmountChildComponentView` of every descendant plus UIKit's own work on the popped view, one long frame at the start of every pop (navigation-8 and header-8 dropped a frame per pop). The fix is to keep the screen mounted until its exit transition has ended, and to unmount it afterwards, in a frame where nothing moves.

Contract:

1. **JavaScript.** An entry that leaves a router (`back`, `goto` with `replaceState` or `reset`, `replaceBase`) is not removed from the tree on a platform with `EXIT_REPORTED`. The router keeps its `Screen` mounted with `activityState={0}` and passes `onExited`; `router.entries` (what `back`, `goto` and `current` work on) is the live stack, `router.screens` is what the router renders: the entries and the leaving ones, each where it was (a screen pushed while another leaves goes below it). A page therefore lives up to one exit transition longer than before (about 0.35 s for a push, 0.5 s for a sheet); its `onDestroy` and effects run then. If `topExited` does not arrive within `EXIT_TIMEOUT_MS` (2.5 s) the router removes the entries anyway and logs a warning. A **user** dismissal (`topDismissed`) is not retained: the platform already took the screen away, so `router.dismissed` drops it and the ones above it at once.
2. **Native stack.** A mounted screen whose `a` (record 110 `activityState`) becomes 0 leaves the stack exactly as a removed screen would have: a pushed screen on top pops (with its `stackAnimation`, interactive gestures aside), covered screens go without animation, a presented screen (modal, sheet) is dismissed. The view tree stays mounted (the platform may swap its picture in for the animation, but must not unmount or detach the views). When the stack is at rest again it sends `topExited` once per screen: after the transition for the screen it animated, in the next run-loop turn for a screen that had nothing to animate (not on top, `animation: none`, no window, nothing else live), and never before a transition in progress has ended. `topExited` is sent after the lifecycle events of the same transition (`appear` of the new top, `disappear` of the leaving screen).
3. **Why a turn later.** The event is sent in the turn after UIKit's completion work, and JavaScript's removal comes back asynchronously after that, so the unmount lands in a frame of its own, not in the last frame of the transition.

Android (`EngineStack.exitScreen`, called from `EngineScreen.apply` when `activityState` drops to 0, and from `insertScreen` for a screen mounted already inactive): the screen is marked `leaving` (out of the live list, not touchable, kept visible for its animation), the top pushed screen plays its exit transition as `removeScreen` would, anything else (covered, first, `none`, never appeared, not laid out) has nothing to animate; at the end the screen is marked `exited`, which `refresh` keeps hidden (alpha 0, out of accessibility) while the view tree stays attached, `refresh` sends `appear` of the new top and `disappear` of this screen, and `NavEvents.exited` (`topExited { target }`) is posted to the next main-looper turn. The REMOVE that JavaScript sends afterwards finds a leaving screen and detaches it without a second animation. A user dismissal (`dismissTop`) that JavaScript retires meanwhile (its own back at the same moment) reports `exited` at the end of the dismissal instead of `dismissed` and is never restored; a screen popped while still entering stops its enter transition and reports at once. The text that follows was the adoption note: (a) a live screen at `activityState` 0 was hidden at once (alpha 0, "leaves the stack" in the section "Navigation"); make it instead "animate out as `removeScreen` does for an unremoved view, keep the view attached, then detach it", and send `NavEvents.exited(tag)` (`topExited`, payload `{}`) when the animation ends, or at once when there is nothing to animate (the first screen, `none`, not laid out); (b) a screen that is already `leaving` or `dismissed` is not animated again; (c) `activityState` 0 on a screen that is not on top, or that was never shown, is hidden as today and reports `exited` immediately; (d) then set `EXIT_REPORTED.android = true`. Until then the router removes entries on Android as before and the existing tests ("on Android the router removes a popped screen at once") keep that honest.

### Behaviour

- Header: draws on the screen's view tree, so it moves with the screen in push, pop, predictive back and edge swipe (Android); on iOS `UINavigationController` animates the bar. Large title: while the first scroll view scrolls from rest, the large row collapses over 56 dp (Android) / 72 pt (iOS, measured on the iPhone SE 3: the expanded bar is 126 pt, the collapsed one 54) (title cross-fades into the inline title, the divider appears when collapsed); nothing relayouts in JavaScript. Search: a search icon (hit area 48 dp) in the right slot area expands to a field on Android; iOS shows `UISearchController` below the title (large) or in the bar; both show `headerSearch` content while active; back key or `onCancel` closes it.
- Sheet: drag between detents; release snaps to the nearest detent, a fling over 1000 dp/s goes to the next one in its direction; below the lowest detent by more than a quarter of its height, or a fast fling down, dismisses when `dismissible`. A scroll view inside the sheet scrolls first and hands the drag to the sheet when it is at its top. The scrim is 32 % black (`dim`); `none` has no scrim and touches outside the sheet box reach the screen below. The back key dismisses when `dismissible`, otherwise nothing. Entering is the stack's slide from the bottom, 250 ms. Sheets do not resize for the keyboard (use `KeyboardAvoidingView` inside).
- System bars: the top live screen's `statusBar` and `navigationBar` apply; popping restores the screen below's. Android is edge-to-edge: `style: light` means light icons, `hidden` hides the status bar with `WindowInsetsControllerCompat`, `color` paints the (transparent by default) navigation bar background. iOS maps `style` to the status bar style of the top view controller and `hidden` to `prefersStatusBarHidden`.
- Tabs: Android shows a bar of 64 dp + bottom inset (icon 24 dp, label 12 sp, badge top-end of the icon, dot 8 dp), iOS a `UITabBar` (49 pt + home indicator). `disabled` items ignore presses and are announced as disabled. `lb=1` hides labels.

### RTL and accessibility

- `left`/`center`/`right` slots are start/center/end: Yoga rows flip with the layout direction, and the native chrome follows `View.layoutDirection` (Android) or `semanticContentAttribute` (iOS). The back arrow and the sheet grabber's chevrons are mirrored in RTL; the title aligns to the start side; the tab bar order mirrors; `paddingStart` reserves the back button on the correct side.
- Reading order in the header, on both platforms, start to end (mirrored in right-to-left): the back button, the left slot, the title (or `headerCenter`) as a heading, the right slot, the search field, then the content. That is the order of the native bars (UIKit's: back button, title or center slot, trailing items, search, content; Material's toolbar: navigation icon, title, actions), so the title is the first stop after the back button and the left slot, before any content. While the search is open its field takes the title's place in the order (it is drawn there). The large title is the bar's second row, read after the back button and before the end controls: the one step of the order that goes up. On Android the order is the node tree's, which neither the child order nor `accessibilityTraversalBefore/After` sets: the framework sorts a view's children by their bounds (above, then the start edge, then the top, then the taller view first; `ViewGroup.ChildListForAccessibility`), so `EngineScreen.addChildrenForAccessibility` lists the header's stops before the content's on every header (a `large` or `translucent` header is absolute over a content view that fills the screen, starts at the same corner, and the taller content view won the tie: the title, back button and slots came after the last row), `EngineHeader.addChildrenForAccessibility` lists the bar in the order above (`readingOrder`), and the Fabric child order and the header's `zIndex` stay what they are for drawing and hit testing. The title that is a stop is the one that shows: a view at alpha 0 is not visible to the user and a service skips it, so under a large title the large title is the heading and the inline title becomes it once the collapse passes its half.
- Hit areas are at least 48 dp (Android) and 44 pt (iOS): the back button (48 × bar height), the search icon, tab items, the tab icon slot's item. Slot content is the app's responsibility: slots are rows of bar height, so a `Pressable` with `minWidth: 48, minHeight: 48` is fully hittable; hit slop is not added.
- Roles: the title is a heading; the back button is "Back" (or `backTitle`) button, Android "Navigate up" when no `backTitle`; the tab bar is a tab list, each item a tab with a selected state, position ("Tab 2 of 3") and its badge in the label (`accessibilityLabel` overrides); a dot badge is announced as "new items". Sheets and modals trap focus: content behind is `importantForAccessibility=no-hide-descendants` (Android) / `accessibilityViewIsModal` (iOS); an escape gesture (TalkBack back, VoiceOver two-finger Z) dismisses when `dismissible`. A new screen's title receives accessibility focus when its transition ends.
- Large text: slots and chrome use scalable text; the title is one line with tail ellipsis, so the Android bar height stays 56 dp; iOS reports its larger large-title area through `onMetrics`.

### What Android must do (NA)

Views `EngineHeader`, `EngineSheet`, `EngineTabs` (new, in `views/`), small edits in `EngineStack`, `EngineScreen`, `PropsNav.kt`, `PropsEncoderNav.cpp`, `MountingManager.kt`, `HitTest.kt`, `A11y.kt`, `Props.kt` (records 120–127), `kindForView` and the `Kind` enum (12..16).

- C++: parse the grammar (percent decoding, lists, unknown keys ignored), emit records exactly as `decodeRecords` does; send `topAppear/Disappear/DetentChange/Metrics/Change/SubmitEditing/Cancel/Select` through `NavEvents` and `ViewEvents` like `dismissed`.
- `EngineHeader : EngineView` as a child of its `EngineScreen`: draws the background (default the theme surface), the divider, the back arrow (24 dp icon in a 48 dp target; pops through the stack's dismissal path, `onDismissed` after the exit), the title and subtitle with `TextLayouts` (single line, `tc` tint), and places slot children at their Yoga frames; `sl` decides whether to draw the native title before the children exist. Large title: find the first `EngineScroll` in the screen, add the header's expanded height as top padding (`clipToPadding = false`) so JavaScript's offset 0 is rest, translate the header up by `min(offset, 56 dp)` and cross-fade the title. Search: expanding field (`EngineInput` inside the header), results view `header-search` shown while active. Report `onMetrics` after layout.
- `EngineSheet : EngineView` host for `p=sheet|formSheet`: own drag with `VelocityTracker` snapping (the engine tree has no `CoordinatorLayout`, so `BottomSheetBehavior` is not used; its settle and fling rules are copied), scrim view in the stack, detents from record 122 against `available = stack height − top inset`, `auto` from the screen's Yoga height, back callback while `dismissible`, nested scroll hand-off from `EngineScroll`, `onDetentChange` on settle. A sheet or `formSheet` counts as non-covering for `onDisappear`.
- `EngineTabs : EngineView`: bar of icon + label items (24 dp icons from `ImageLoader` as template with `tint`/`inactiveTint`, or the live `native-tab-icon` subtree drawn through a `SRC_IN` tint), badges, selected state, 48 dp targets, `Role.Tab` accessibility; panes shown and hidden by `sel` (`INVISIBLE` plus `no-hide-descendants`, touches and the stack's back callback disabled in hidden panes); apply `sel` when `sel` or `sc` changed; report `onMetrics` after layout.
- System bars from record 125 through the activity window (`WindowInsetsControllerCompat`), restored when the screen leaves; `onAppear`/`onDisappear` per the visibility rule above.

### What iOS must do (NI)

New module `apps/platform/modules/svelte-screens-ios/**` with `ViewProps`-derived Fabric components for the tags (kinds above), registered under the names `viewNames` maps on iOS; each reads `props.nativeId` and parses the same grammar (golden vectors from `tests/navigation.test.ts`).

- Stack: `UINavigationController` (existing plan); the screen's view controller view extends under the bar (`edgesForExtendedLayout = .all`, `extendedLayoutIncludesOpaqueBars = true`) so Yoga's header band is drawn over by the bar and the screen's Yoga frame stays the full container.
- Header: `UINavigationItem` per screen. Record 120 → `title`, `subtitle` (iOS 26; a two-line `titleView` below), `largeTitleDisplayMode`/`prefersLargeTitles`, `UINavigationBarAppearance` (`backgroundColor`, `shadowColor` cleared for `hs`, scroll edge appearance transparent when `translucent`), `tintColor`, `hidesBackButton` unless `bk`, `backButtonTitle` from `bt`. Slots → `UIBarButtonItem(customView:)` in `leftBarButtonItems`, `titleView` (center) and `rightBarButtonItems`; the custom view takes its size from the slot's Yoga frame and is reparented from the Fabric view into the bar, so attach an `RCTSurfaceTouchHandler` to each slot container (the bar is outside the surface root view). Search: `UISearchController` with `UISearchBar` (`preferredSearchBarPlacement = .stacked` on iOS 26, else the field goes to the bottom of the screen), `searchResultsController` hosting `header-search`'s view inside the safe area it reports; `searchBar` text events as `topChange` with `eventCount`, `topSubmitEditing`, `topCancel`. Send `topMetrics` with `navigationBar.frame.maxY` and the safe-area top after layout and on dynamic type/rotation.
- Sheets: `UISheetPresentationController`, `modalPresentationStyle = .pageSheet` for `formSheet`; detents from record 122 as `.custom(identifier:)` with resolver `fraction × (window height − window top safe inset)` limited by UIKit's `maximumDetentValue` (`auto`: the screen's Yoga height clamped); the sheet resolves its detents again once it is in a window, `selectedDetentIdentifier` from `di`, `prefersGrabberVisible = gr`, `isModalInPresentation = !dm`, `largestUndimmedDetentIdentifier = last detent` for `bd=1`, `prefersScrollingExpandsWhenScrolledToEdge = true`; `sheetPresentationControllerDidChangeSelectedDetentIdentifier` → `topDetentChange`; swipe-down or backdrop dismissal → `topDismissed`. `transparentModal` is `.overCurrentContext`, `modal` `.fullScreen`.
- Tabs: `UITabBarController` with one child per `native-tab` (the pane is the child's view, absolute frame from Yoga), `UITabBarItem(title:image:selectedImage:)` from `ic`/`is` (template rendering) or the snapshot of `native-tab-icon`, `badgeValue` (`""` for the dot, text otherwise), `isEnabled`, `titlePositionAdjustment`/nil title for `lb`, bar `tintColor`/`unselectedItemTintColor`/`backgroundColor`; `tabBarController(_:didSelect:)` → `topSelect`; apply `sel` when `sel` or `sc` changed; do not push `hidesBottomBarWhenPushed`.
- Interactive pop (`g=0` disables the gesture), `nativeBackButtonDismissalEnabled`, `onAppear`/`onDisappear` from `viewDidAppear`/`viewDidDisappear` (suppressed for non-covering presentations), status bar from record 125 via `preferredStatusBarStyle`/`prefersStatusBarHidden`, VoiceOver per "RTL and accessibility" (a presented screen and a pushed screen answer the escape gesture: `accessibilityPerformEscape` dismisses or pops as a swipe down or the back button does, unless that is forbidden).

### Not in this contract

iPad centered form sheets, tab bars on the side or top, nested tab bars, header buttons as a native menu (`UIMenu`, popup), per-tab bar hiding, shared-element transitions, `fullScreenSwipeEnabled`, header height animation by JavaScript. Device verification of every behaviour above is the integration lane's.

## Route tree: layouts as navigators (SvelteKit-native file routing)

Status: implemented (JS), 27 Oct 2026: `packages/svelte-native/src/route-tree.ts` (pure core), `build.ts` (generator), `router.svelte.ts`, `Router.svelte`, `RouteView.svelte`, `NavigatorScreen.svelte`, `NavigatorPane.svelte`, `TabPanes.svelte`, `Root.svelte`, `components/Stack.svelte`, `components/Tabs.svelte`; tests `route-tree*.test.ts`, `navigation.test.ts`, `hmr.test.ts`, `entry.test.ts`; not run on a device. Sources of truth, in order: this section, then `packages/svelte-native/src/route-tree.ts` (pure: the tree from a file list, the resolution of an href, the navigation plan) and the golden vectors in `tests/route-tree.test.ts`; then `build.ts` (the generator), `router.svelte.ts`, `Router.svelte`, `components/Stack.svelte`, `components/Tabs.svelte`. It replaces the flat route table: a `+layout.mobile.svelte` can be a navigator the way an Expo Router `_layout` is, and the directory tree decides which stack or tab pane a page belongs to.

### Files

| file | role |
|---|---|
| `+mobile.svelte` | a page: one screen of the nearest navigator above it. Its module script may `export const presentation` (a literal: `push`, `modal`, `transparentModal`, `sheet`, `formSheet`; `push` by default), read at build time as today. Everything else about the screen (title, header, slots, search, sheet, system bars, toolbar) is set at run time with `<Screen …>` inside the page. |
| `+layout.mobile.svelte` with `export const navigator = "stack" \| "tabs"` in its module script (a literal) | a **navigator layout**: its directory is one screen of the parent navigator, and the pages and navigators below it are its own. |
| `+layout.mobile.svelte` without that export | a **content layout**: wraps the content of every screen in its subtree (pages and navigator screens alike), outermost first, as today. The root `+layout.mobile.svelte` is the app shell: it wraps the root navigator itself and receives `children` (the navigator) instead of `routes`. |
| `+error.mobile.svelte` | unchanged. |
| `(group)` | transparent for paths, as today; a group directly under a tabs node is flattened, its child directories become panes. |

### The tree

```
RouteNode  = StackNode | TabsNode
StackNode  = { kind: "stack", id, path, layout?: Loader, routes: (PageRoute | RouteNode)[] }
TabsNode   = { kind: "tabs",  id, path, layout: Loader, panes: Pane[] }
Pane       = { key, stack: StackNode }                           // key = the pane directory's name
PageRoute  = { kind: "page", id, path, presentation, load: Loader, file?, layouts? }
Loader     = () => Promise<{ component: Component, layouts: Component[] }>   // a page and its content layouts; a navigator layout and the content layouts around its screen
```

- The root is an implicit stack (`id ""`, `path "/"`), with the root layout as the app shell around it (not as `layout`).
- A page belongs to the nearest navigator above it. Content layouts between them are the page's `layouts` (outermost first), including content layouts above the navigator (the root layout excluded).
- A navigator layout directory is one route of its parent navigator: a screen whose path is the directory's path (groups removed) and whose content is the navigator layout's component. A `+mobile.svelte` next to a navigator layout is a build error (the layout is the screen).
- Under a tabs node, every immediate child directory (after group flattening) is a pane: an implicit stack (`id` the directory's id) whose base entry is the pane's index page (`<dir>/+mobile.svelte`, required: a build error names a pane without one). A pane directory may hold its own content layout, which then wraps its pages, and may not be a navigator layout itself (no tab bars inside tab bars, "Not in this contract").
- A page directly under a tabs node (not in a pane directory) is a build error: it has no pane to show in.
- Within a navigator, routes sort as today (static segments before parameters, deeper first); matching goes through the whole tree so a resolved href names exactly one page and the chain of navigators above it.
- `routes.ts` exports `tree: RouteNode`; `createRouter(tree, initial)` replaces `createRouter(routes, initial)`.

### Resolution and the navigation plan (`route-tree.ts`, pure)

`resolve(tree, href)` returns `{ page, params, chain }` where `chain` lists, from the root down, `{ node, select?: paneKey }` for every navigator on the way, or `null` when no page matches. `plan(state, target, navigation)` turns the current state (`{ [nodeId]: { entries: hrefs[] | selected: paneKey } }`) and a resolved target into operations, one per navigator on the chain, in root-first order:

| navigator | operation |
|---|---|
| a tabs node on the chain | `select(paneKey)` (no animation; a reselect is a no-op; with `reset` it is always listed) |
| the owning stack (the last of the chain) | `push(href, presentation)`, unless the stack already holds that href: then `popTo(href)` to that entry (nothing when it is the top), as Expo Router's `navigate` does; `replace` with `replaceState` (unchanged: the top is replaced); `reset` keeps only the owner's base (a pane's index page, as the instance it is) and the target |
| a stack above the owner | if the chain's next screen is in its entries: `popTo(thatScreen)` (a modal over the tabs goes away when a tab route is navigated to); else `push(thatScreen)` (a deep link into tabs that are not on the stack yet pushes the tabs screen first, then selects and pushes); with `reset`: `reset(thatScreen)` whether or not it is on the stack, the stack keeps only that screen (the instance it has, panes and nested stacks mounted, else a new one) |

`back()` asks the innermost active navigator first: a stack pops when it has more than one entry (a tabs router's own stack is the selected pane's); a pane stack at its base does not pop and does not switch tabs (the decision in "Defaults decided here" stands); then the stack above it; the root at a single entry returns `false` (Android leaves the app). The Android key is the root router's alone (see "Decisions"): it asks the innermost active router and that router's `back()` falls outward. `current` is the deepest shown entry. `useRouter()` is the nearest navigator's router, `useRouter("root")` the root's; a pane's router is named by the pane's key, a nested navigator's by its id. Links open through the root (`openURL` → `goto`). A navigation that does not resolve throws as today. Hot reload keeps every navigator's stack and every tabs node's selection by node id (`hmrState().scopes`), and so does a recreated Android Activity (see "Navigation state across recreation and process death").

The owner of a modal, sheet or form sheet is the stack its page belongs to: a modal that must cover the tab bar lives outside the tabs directory (at the root or in a root-level group), as in Expo Router.

### Navigator layout components

```svelte
<!-- routes/(workspace)/[slug]/(tabs)/+layout.mobile.svelte -->
<script lang="ts" module>export const navigator = "tabs";</script>
<script lang="ts">
  let { panes, children } = $props();           // panes: [{ key: "home" }, { key: "inbox" }], from the directory
  const items = [{ key: "home", title: t("home"), icon: home }, { key: "inbox", title: t("inbox"), icon: inbox, badge: unread }];
</script>
<Tabs {items} tint={theme.foreground}>{@render children()}</Tabs>
```

```svelte
<!-- routes/(workspace)/[slug]/(tabs)/inbox/+layout.mobile.svelte (optional; the pane is a stack without it) -->
<script lang="ts" module>export const navigator = "stack";</script>
<Stack header={{ large: true }} animation="slide_from_right">{@render children()}</Stack>
```

- `children` is the navigator's content: for a stack, its screens (`Router.svelte` renders them); for tabs, the panes (`native-tab` per pane with the pane's stack). A navigator layout that renders `{@render children()}` without `<Stack>`/`<Tabs>` gets the defaults.
- `<Stack>` props are screen defaults merged under each screen's own options (`mergeScreenOptions`, the screen wins): `header`, `animation`, `gestureEnabled`, `statusBar`, `navigationBar`, `style`, plus `loading` (snippet shown while a route's modules load).
- `<Tabs>` in a navigator layout owns no selection: the router's tabs node does (a press selects at once and the owner can override it by navigating, the `onSelect` prop still reports). `items` keys must be the pane keys; an item for a key that is no pane, or a pane without an item, is a development error logged once. The component mode (`selected`/`onSelect`/`content`) stays for tabs outside the route tree (the lab).
- Pages keep `<Screen …>` for their options; `export const presentation` stays static.

### Decisions the implementation settled

- A tree is data plus loaders: `buildTree` returns the files each route comes from (`file`, `layouts`, `layoutFile`, `shellFile`, golden vectors), the generated `routes.ts` adds `load` and `layout`, a hand-written tree (the lab's tab panes) gives `load` itself. A navigator layout's loader also carries the content layouts around its screen (a pane's stack has none: its pages carry them).
- `resolve` also returns the entry `href` (a tabs screen path resolves to its first pane's index page, whose own path it is). Any single-segment href matches a tabs screen at `/[slug]`, so `resolve(tree, "/nowhere")` finds the first pane when a tabs node sits at `/[slug]`: the vector that expects `null` there contradicts the vector that resolves `/acme` the same way and is not satisfied.
- The navigation state belongs to the navigator screen that hosts it (`NativeLocation.navigator`), not to the node id: two workspaces' tabs on one root stack keep a stack each, a popped tabs screen takes its panes with it, a new visit starts new ones. `plan` still reads a state keyed by node id; the router builds it for the chain of the target. Hot reload therefore saves the state nested along the entries (`StackSnapshot`: the route id, href, presentation, and for a navigator screen its stack or its selection and panes' stacks) and restores each entry by its route id, falling back to the first route of the stack whose path matches the href when the id is gone or no longer matches (a page and a navigator of one stack can share a path, and navigation resolves only pages inside navigators, so the href alone can rebuild a different route than the one navigated to); a node or route that is gone is dropped and the router starts from its initial screen. `hmrState().scopes` still holds the hand-made named routers.
- A router loads a route when a navigation pushes it or when its screen renders, not when it is created: the root router exists before the shell shows its configuration screen, and the first page must not evaluate before the shell asks for it. A navigation also loads the layout of every navigator on its chain that has one and is not loaded, and again one whose load failed (a pane's layout is no route of any stack, so no push would do it).
- A pane's stack layout is given the `params` and `url` of the tabs screen that hosts the pane, like every other layout, and loads through the router's slots like a route. Until it is in, the pane shows the placeholder of the `<Router>` around the tabs (its `loading` prop, else the `loading` of the `<Stack>` around that router; the layout's own `<Stack loading>` is not known yet), nothing when there is none; a failed load is thrown where the pane renders.
- The Android key and links belong to the root router's `<Router>` alone (`connectHost`, the one that is not nested): one `hardwareBackPress` registration while it is mounted, one `url` listener, and the launch link read once per router (a session reset that unmounts and mounts the root `<Router>` while the app keeps its router does not open it again). Routers register with the router above them while their component lives (`inner`), and the handler goes to the innermost active one (the newest active router at each level, hand-made named routers included); its `back()` hands the pop outward. Registering one handler per `<Router>` made the order depend on mount order: children mount first, so after a reset with warm modules the root's handler was the newest and popped the root while a pane still had depth.
- `back()` on a tabs router pops the selected pane's stack first, then the stacks above; a pane that is at its base hands the pop up and never pops its sibling (the tabs router's shown pane is tried only by the tabs router itself).
- The launch link (`Linking.getInitialURL`, read once per router) is opened with `reset`: a direct load has no history, as SvelteKit's first page has none, so the link's screen is the base of the root stack and shows no back arrow (before this, `/__dev` opened by a link gave `[login, /__dev]` with an arrow the lab's references do not expect). Links that arrive while the app runs (`url` events) are plain `goto`s, and `router.openURL(href, navigation)` takes `goto`'s options. A link no screen matches is ignored.
- A `goto` to an href the owning stack already holds goes back to that entry instead of stacking a copy (27 Oct 2026: "Workspace settings" from Home with a section open on the settings pane planned `select` and `push`, giving `[settings, profile, settings]`). The entry stays (nothing remounts) and what is above it is popped; an href with another query or hash is another entry and stacks. `replaceState` and `reset` are unchanged. A screen that wants a second copy of a page navigates to a different href (the lab's `?depth=`).
- `reset` is a new root for the whole chain (27 Oct 2026, after the platform app's adoption found that a reset into tabs left the workspace list under them: `[workspaces, tabs]`, so back from the home pane's base returned to the list and the create-workspace flow left its form under the new workspace). `plan` with `reset` lists, root first, `reset(screen)` for every stack above the owner, `select(pane)` for every tabs node (also when the pane is shown), and `reset(target)` for the owner; `replaceState` stays owner-only. The router applies a stack's `reset` keeping the instance of the screen it keeps: the root `[workspaces, tabs]` resets to the same tabs entry, its panes and their stacks stay mounted and nothing is created (a screen that is not on the stack yet is created, and what is below it starts empty); anything else on the stack, a modal included, goes. A pane that the chain does not name is left alone. `canGoBack` follows the move: a kept nested stack navigator's first screen goes back through its own screen only while that screen has one below it, so after a reset the root's only entry and a pane's base show no arrow, and a screen pushed after it does.
- A screen's `canGoBack` (the header's back arrow) is true when a screen is below it in its stack, or when it is the first screen of a nested stack navigator whose own screen can go back (a screen below it in the parent, or the parent's first screen going back itself): its first back pops the navigator's screen from the stack above. A pane's base stays false.
- `<Stack animation>` is the default of push screens only; a modal, a transparent modal, a sheet and a form sheet keep the platform's animation. The other `<Stack>` defaults apply to every screen.
- `createRouter` takes the route tree and throws at once, naming the contract, for anything else (the array of routes of the flat table fails with a message instead of "undefined is not iterable").
- `current` is the deepest shown entry; `entries` and `screens` are the router's own stack (a tabs router's: the selected pane's). `goto` on any router navigates over the whole tree. A pane router is active while its tabs router is, its tab is selected and its tabs screen is the top of its stack, so a modal over the tabs takes the back key first. `replaceBase` replaces the first entry of the router's own stack with a page of that stack.
- A nested stack navigator has no base page (its layout is its screen): its stack starts with the route that opened it, and the first back pops its screen from the parent.
- The app is `createFabricApp(RootLayout, { tree })`: `Root.svelte` creates the router above the layout, which receives the root navigator as `children`.

### Navigation state across recreation and process death

Status: implemented (JS and the Android host), 27 Oct 2026: `src/hmr-state.ts` (`NavigationState`, `parseNavigation`), `src/router.svelte.ts` (`createRouter`, `openLaunchURL`), `src/Root.svelte`, `src/fabric/hmr.ts` (`launchSurface`, `stopApplication`), `src/fabric/host.ts` (`saveNavigation`, `hostFinishing`), `src/expo.ts` (`applyMainActivity`), `NavigationState.kt` and `SvelteEngineModule.kt` (`saveNavigation`, `finishing`); tests in `tests/hmr.test.ts` and `tests/expo-headless.test.ts`. Not run on a device: the check is the resilience suite (`qa/commands/resilience.ts`: the header screen pushed from the lab menu, then font scale 2.0, 0.85, 1.0, `am kill` and return), which fails when the stack is not back.

Before this, a recreated Activity (font scale, locale) and a process killed in the background both came back on the launch link: the new surface's root router started from `initial`, and the intent that launched the app, which an Activity reports again, opened the link with `reset`, so the screen the user was on was gone.

- **What is kept** is the snapshot a hot update keeps (`StackSnapshot`, nested along the entries and recorded by route id, restored by id, else by href, a route that is gone dropped and the router started from its initial screen), plus the launch link the router has acted on: `NavigationState = { stack, launch? }`. The live root router publishes `hmrState().navigation()`; the name is the hot-reload state's, which now also serves recreation (the file and `hmrState()` keep it, the fields say what they hold).
- **Recreation** (the JavaScript runtime lives, "Activity recreation" above): `stopApplication` takes `navigation()` into `hmrState().restore` when the last running surface stops, in release builds too (before this only `remountSurfaces` did, in development), and the next root `createRouter` adopts and clears it. A surface that starts while another still runs (the new Activity first) takes the running router's state, and the stop that follows leaves nothing, since a surface still runs. An Activity that is **finishing** (the user left: Back on Android 11 and below, a swipe from Recents; Android 12 and above move the task to the background and destroy nothing) leaves nothing: `SvelteEngine.finishing()` (`Activity.isFinishing`, recorded by `MainActivity.onDestroy` before React Native stops the surface) is read when the surface stops, so a launch while the process still lives starts from the first screen, not from a screen the user closed.
- **Process death** (Android): the root router writes `JSON.stringify(state)` through `hmrState().save` after every change, from an effect in `createRouter` (effects run once per batch of changes, after the flush that made them: a navigation that settles writes once, nothing is written when nothing changed, no timer). `createFabricApp` sets `save` to `SvelteEngine.saveNavigation(json)`, which `NavigationState` (a Kotlin object) keeps. The Activity the app owns hands it to Android: `MainActivity` is generated by prebuild, so the config plugin patches it (`applyMainActivity`, idempotent, marked blocks): `onSaveInstanceState` puts the latest JSON under `svelte.navigation` (not above 100,000 characters: a Bundle travels through a Binder transaction), `onCreate` reads the saved bundle before the template's `super.onCreate(null)` (which drops it for React Native), and the `ReactActivityDelegate`'s `getLaunchOptions()` passes it as `initialProps.navigation` (a string). `launchSurface` merges it into the root component's props, `Root.svelte` reads it with `parseNavigation` (anything that is not such a state is ignored) and gives it to `createRouter` as `options.restore`. Android keeps the bundle for a recreated Activity and for a process killed while the app is in the background; an Activity started fresh (no saved state) gets none. The hand-made named routers (the lab's tab panes) are kept in memory only, as for a hot update.
- **Which state wins**: `hmrState().restore` (the stop's, fresher) over `initialProps.navigation` over `initial`. A state whose routes no longer exist (an update shipped between the save and the restore) is dropped and the router starts from `initial`, as for a hot update; a restored entry is found by route id, else by href.
- **The launch link** keeps its rule: the link of a *new* launch resets, and a restored state does not change that. A router that adopted a state also adopted `launch`, the link its previous router opened; `Linking.getInitialURL()` returning that same link is the unchanged intent of a recreated or restored Activity (its `Intent` is the one it was started with; `onNewIntent` does not replace it) and is not opened again. A different link, as when a deep link starts the app after a kill, is a new launch: it is opened with `reset` over the restored state, and the router records it. A launch with no saved state (cold start, or after the user left) opens its link as before. A link that arrives while the app runs (`url` events) is a plain `goto` as before. Two launches by the same link with a restored state in between cannot be told apart by the link alone (a restored Activity that is started again by the same URL shows the restored screen); Android delivers a link that reaches a live task through `onNewIntent`, which is a `goto`.
- **iOS** is not part of this: the iPhone restarts at the launch link after the process is killed (there is no `SvelteEngine` module there, so `save` and `finishing` do nothing, and its surface stops only when the host reloads); `NSUserActivity` state restoration is a later item.
- **Not verified**: no device or emulator ran this change (the Gradle build compiles the Kotlin and the prebuild patch; the JavaScript side is covered by `tests/hmr.test.ts`). To confirm on a device: the order of the surface stop and start on recreation (both are handled), that `getLaunchOptions` reaches `initialProps` through `ReactActivityDelegateWrapper`'s reflection (`ReactActivityDelegate.getLaunchOptions` is the method it calls), and the process-death restore with `am kill` while the app is in the background.

### Toolbar (kinds 17 `toolbar`, 18 `toolbar-item`; records 128, 129)

A bar of actions at the bottom of a screen (iOS `UIToolbar`, Material bottom app bar), declared by the screen:

```svelte
<Screen title="Thread" toolbar={{ items: [{ key: "reply", title: t("reply"), icon: reply }, { key: "archive", title: t("archive"), icon: archive, badge: 2 }], onPress: (key) => … }}>
  {#snippet toolbarCenter()}…{/snippet}       <!-- optional custom content between the items -->
```

| option | meaning |
|---|---|
| `toolbar.items[]` | `key`, `title`, `icon` (asset, drawn as a template image and tinted; or a snippet `(pressed: boolean)`, drawn and never pressed: a `Pressable` inside it does not fire, presses reach `toolbar.onPress(key)` only), `badge` (as tabs), `disabled`, `accessibilityLabel`, `testID`; `{ key, spacer: true }` is flexible space |
| `toolbar.hidden`, `translucent`, `tint`, `background` | as the header's |
| `toolbar.onPress(key)` | a press |
| `toolbarCenter` snippet | custom content in the bar between the items (a composer, a segmented control) |

Tree and layout: `native-toolbar` (`svelte:toolbar;hd=1;tl=1;tc;bg;sl`, kind 17) is the last child of `native-screen`, a Yoga row of `height = bar + bottom inset` (bar 56 dp Android, 44 pt iOS), `paddingBottom = inset`, `paddingHorizontal = edge` (below), in flow below the content view (`flex: 1`) unless `translucent`, then `position: absolute` at the bottom; its children are one `native-toolbar-item` per item, in order (`svelte:toolbar-item;k;t;ic;iv=1;bd;ds=1;sp=1`, kind 18, record 129; a snippet icon renders inside it, Yoga-sized, placed by the native side), and `native-toolbar-center` (kind 13, slot 4 in record 126) when the `toolbarCenter` snippet is given (`sl` bit 1). Keys: `k` key, `t` title, `ic` icon uri, `iv=1` icon is a snippet (child content), `bd` badge text (present and empty = dot), `ds=1` disabled, `sp=1` flexible space (no other key). Inside a tab pane the bar sits above the tab bar (the pane's bottom is the tab bar). One row geometry: Yoga and both native sides lay the row out by `TOOLBAR_METRICS` of `fabric/navigation.ts`, `{ edge, item, gap }` = Android `{ 4, 48, 0 }` dp, iOS `{ 16, 44, 4 }` pt. The band's `paddingHorizontal` is `edge`; every item node (spacers excepted) has `width: item` (fixed, not a minimum) and `marginHorizontal: gap`, so an iOS item occupies `item + 2 * gap` = 52 pt and the band's edges take 32; a spacer is `flexGrow: 1`, or `0` when the screen has a center slot (the center takes all the free width natively, so Yoga must not share it with the spacers); the center is `flex: 1`. The center's Yoga width is therefore `band width - 2 * edge - (item + 2 * gap) * (items that are not spacers)`, the free span between the items on both platforms, and the native sides use it as it is. `useToolbar()` returns `{ height, inset }` of the nearest screen's toolbar (0 without one), reactive, for content under a translucent bar.

| id | values | kind |
|---|---|---|
| 128 | toolbar: flags (1 hidden, 2 translucent), hasTint, tint, hasBackground, background, slots (1 center) | 17 |
| 129 | toolbar item: key string, title string, iconUri string, iconIsView, badgeKind (0 none, 1 dot, 2 text), badgeText string, disabled, spacer | 18 |

Events: `toolbar` emits `topPress { key, index }` (`onPress`, the component calls `toolbar.onPress(key)`) and `topMetrics { height, inset }` like the header. Android (`views/EngineToolbar.kt`): `EngineToolbar` (kind 17) is the last child of its `EngineScreen` like the header (`EngineScreen.toolbar`), so it moves with the screen in push, pop, predictive back and edge swipe. It draws the band's background over its whole Yoga frame (`bg`; else the tab bar's surface-container color; transparent when `translucent`; a hairline on top unless transparent) and lays out its children itself in the 56 dp bar row at the bottom of the band, above the inset (`SafeArea.bottom`, Yoga's `paddingBottom` until the window reports; zero inside a tab pane, whose bottom is the tab bar, so there the first `topMetrics { height, inset }` corrects JavaScript's estimate; sent after layout once per change, never while hidden). Items (`EngineToolbarItem`, kind 18, one per item node, spacers included; Yoga's frame of an item is ignored) are 48 dp high targets packed from the start edge (mirrored in RTL) after a 4 dp edge (`EDGE_DP`), each exactly 48 dp wide (`ITEM_DP`, the width Yoga gives the item node; a label is ellipsized within the item, less 4 dp each side, as the tab bar's; only a row with more items than the bar holds, more than seven on a 360 dp phone, makes them give up equal shares, and Yoga's numbers no longer hold there); a spacer takes an equal share of the free width; the center slot (`native-toolbar-center`, an `EngineHeaderSlot` of slot 4) takes the place of the first spacer (after the last item when there is none) and all the free width (other spacers are then zero), at its Yoga height up to 56 dp; it keeps the width Yoga gave it, which is the free span (`band width - 2 * 4 dp - 48 dp * items`: Yoga and the row agree, so nothing is measured or clamped) and sits at the span's start edge with its content already centered in it by Yoga, so a content-sized center (a segmented control) is centered between the items and a `flex: 1` composer fills the span; the slot lets touches through where it has no content. An item draws a 24 dp icon (`ic` through `ImageLoader`, `SRC_IN` tinted with `tc`, else on-surface-variant), the 12 sp label under it (icon and label centered as one block) and the badge (`BadgeDrawer`, shared with the tab bar); a snippet icon (`iv=1`) is the item's Yoga-sized child, drawn as it is (not tinted), centered where the icon would be and cropped to the item's 48 dp. The item is its own control: bounded ripple, a press sends `topPress { key, index }` on the toolbar node (`index` counts item nodes, spacers included), role Button, `enabled` false and everything drawn at 38 % when disabled (not clickable), label = the node's `accessibilityLabel`, else the title plus ", new items" or ", <badge>" (the key when both are absent), `testID` on the item, spacers hidden from accessibility; a snippet icon is drawn, not pressed: the item node has `pointerEvents: "box-only"`, so JavaScript's touch dispatch ends at it (it has no press handler) and a `Pressable` inside the snippet never fires; presses reach `toolbar.onPress(key)` only, as on iOS. Accessibility order is row order, the center slot at its place. The QA accessibility suite finds the band by resource id, because the uiautomator tree shows no toolbar class: every item's node info carries `svelte-toolbar:<key>`, the center slot and what it holds `svelte-toolbar:center`, and a `testID` is appended after it (`svelte-toolbar:<key>:<testID>`; `A11y.TOOLBAR_ID`, `EngineView.onInitializeAccessibilityNodeInfo`, `EngineToolbarItem`). `hd=1` makes the band `GONE`; `translucent` only clears the default background (JavaScript puts the band out of flow). In a sheet the band follows the sheet's visible bottom, not the box's ("Native screens, Android", Sheet: `EngineSheet.syncToolbar`; compiled, not run on a device). Not pooled (`ViewPool` pools exact classes only, like the header); `NavProps` fields `toolbar*` (record 128) and `item*` (record 129), slot 4 in `slot`. Compiled (release build, x86_64) and checked on the host for records 128, 129 and slot 4 against `decodeRecords`; not run on a device. iOS (NI, built; "Native screens, iOS", Toolbar): `SvelteToolbar`, `SvelteToolbarItem` and `SvelteToolbarCenter` (`Views/SvelteToolbarView.{h,mm}`) read the same `nativeID`s; the screen's controller gets `toolbarItems` (a `UIBarButtonItem` per item: UIKit's own button for an image or a title, a control as its `customView` for a snippet icon, an image with a title and anything with a badge, `UIBarButtonSystemItemFlexibleSpace` for a spacer, the center slot as a custom view in the place of the first spacer), and the stack's `UINavigationController` shows its own `UIToolbar` while the screen on top declares a toolbar (shown and hidden with the push or pop transition); the `native-toolbar` band draws nothing and the `UIToolbar` is drawn over it, at the bottom of the navigation controller's view, where Yoga laid the band out; `tc`, `bg` and `tl` become the bar's tint and `UIToolbarAppearance`; `topPress { key, index }` and `topMetrics { height, inset }` come from the toolbar node, the metrics being the bar's frame height (home indicator included) and the bottom safe-area inset. JavaScript (`packages/svelte-native`): `fabric/navigation.ts` holds the encoders (`TOOLBAR_KEYS` and `TOOLBAR_ITEM_KEYS` are the attributes `native-toolbar` and `native-toolbar-item` consume), `decodeRecords` for kinds 17 and 18 and the center slot (records 128, 129 and 126 with slot 4), `NAV_KINDS` (`toolbar: 17`, `"toolbar-item": 18`, `"toolbar-center": 13`), `TOOLBAR_BAR` (56, 44) with `toolbarHeight(platform, inset)`, `TOOLBAR_METRICS` (the row geometry above), `useToolbar`, and `mergeScreenOptions` merges `toolbar` key by key like `header` (the inner `items` and `onPress` replace the outer ones); golden vectors and the rendering tests are in `tests/navigation.test.ts` (`tests/toolbar-fixture.svelte`, `tests/toolbar-tabs-fixture.svelte`). `Screen.svelte` renders `native-toolbar` last in `native-screen` when `toolbar` or a `toolbarCenter` snippet is given and `toolbar.hidden` is not true (a hidden toolbar has no node, so `hd=1` is never sent by `Screen`), its children are the item nodes in order and then `native-toolbar-center`, and the lab pages are `/__dev/screens?mode=toolbar` and `?mode=toolbar-center`. Yoga styles (`Screen` passes the platform to the band and to every item as `toolbarPlatform`, and `centered` to a spacer when it has a center slot): the toolbar is `flexDirection: row`, `alignItems: center`, `height`, `paddingBottom: inset`, `paddingHorizontal: edge` (and `position: absolute; left/right/bottom: 0` when translucent); an item is a centered row of `width: item` and `marginHorizontal: gap`, with `pointerEvents: "box-only"` (a snippet icon is its child, drawn and never pressed; it receives `pressed`, which is always `false` until a pressed-state event exists), a spacer is `flexGrow: 1` (`0` beside a center), the center is `flex: 1`; the native side decides the real placement (the center takes the place of the first spacer, after the last item without one, and `index` of `topPress` counts spacers). `Screen` sends `height = bar + inset` with `inset` the bottom inset, or 0 inside a `Tabs` pane (`Tabs` marks its panes; the pane ends at the tab bar) until `topMetrics` corrects it. The host does not make a navigation tag a pressable: `native-toolbar`'s `onPress` is the engine's event, so it gets neither `onClick`, `accessible` nor Pressability. iOS names (`navigation.ios.ts`, static configs in `view-configs.ts`): `native-toolbar` is `SvelteToolbar` (events `topPress`, `topMetrics`), `native-toolbar-item` `SvelteToolbarItem`, `native-toolbar-center` `SvelteToolbarCenter`; on Android all three are `RCTView` and the engine reads the `nativeID`.

### App adoption (platform app)

Status: done in JavaScript on 27 October 2026, not run on a device (no phone, emulator or Mac in that session). The route tree of `apps/platform/src/routes`, pinned by `packages/svelte-native/tests/app-tree.test.ts` (it builds the tree from the real files):

```
+layout.mobile.svelte                    app shell (startup states, the session, the confirmation dialog), around the root navigator
(public)/auth/login, onboarding/profile, workspaces, workspaces/create    root stack pages
(account)/account                        presentation "modal", a root page: it covers the workspace's tab bar
(workspace)/[slug]/+layout.mobile.svelte navigator "tabs": panes home, settings (the tab bar belongs to the workspace)
  home/+mobile.svelte                    pane home, base page; "Workspace settings" is goto(`/${slug}/settings`), which selects the settings tab
  settings/+mobile.svelte                pane settings, base page: the sections of the account settings, one row each
  settings/[section]/+mobile.svelte      one section, pushed within the pane (profile, preferences, devices, workspaces, danger; the web's `organization` is workspaces)
__dev/**                                 the lab: `__dev/tree` is the route-tree lab; `/__dev/screens` keeps its component-mode tabs
```

- `Page` (`src/lib/native/components/Page.svelte`) renders `<Screen title>` around the same SafeAreaView and ScrollView (padding, `direction`); the drawn title and the drawn back link are gone, `description` is the first block, and there is no `back` prop (the native back button follows `canGoBack`). A modal gets no arrow, so a modal page passes `close` and the header carries a Close button at its start (`headerLeft`). The bottom inset is padded outside a tab pane only (`inTabPane()`); the header covers the top one.
- The account settings are one component (`components/AccountSettings.svelte`, one `section` at a time): the account modal shows all five behind a strip of buttons and switches in place, a settings section page shows one. Its email-change `Modal` holds a `Page` of its own: that `Page`'s `Screen` is the modal layer's own (above) and its Close button replaces the drawn back link.
- Tab icons are drawn by snippets (two `View` shapes, alpha masks the bar tints): the repo has no native icon set (nothing under `assets/native`, and `@lucide/svelte` is web DOM). Titles come from the catalog (`mobile.home`, `shell.modules.settings`), `tint` is `theme.foreground`, no badge.
- `reset` is a new root for the whole chain (see "Decisions"), so the picker and the create-workspace flow open a workspace with `goto("/slug", { reset: true })` and the root stack is `[tabs]`: `router.entries[0]` is the tabs screen with `params.slug`, Android back from the home pane's base returns false (the app leaves), and nothing is left under the workspace. `enforceSession` (`src/lib/native/session-guard.ts`, run by `Session.svelte`) reads that base slug: when it is no longer the user's the base is replaced by the list (`replaceBase("/workspaces")`, so the account modal that deleted the workspace stays up) or, with nothing above it, `goto("/workspaces", { reset: true })`; a workspace pushed over other screens by a link is dealt with when it is the shown one. The other guards are by `router.current.url.pathname` (the deepest shown entry: `/acme/home`, `/acme/settings`, `/account`) and did not change.
- Not verified, for the device session: the shell's startup and session states are `Page`s outside every navigator, and the email-change modal's `Page` sits in a modal layer: each `Screen` there is the outermost one and gets a one-entry `native-stack` of its own (see "Screen API contract"), whose header and Close button have to be seen on both platforms; the tab icons' size and tint in both states; the Close button at the start edge in RTL.
- The lab pages that use `Page` (`/__dev`, `/__dev/screen`) draw their title in the native header and lose their drawn Back link (the launch link is opened with `reset`, see "Decisions": `/__dev` opened by it is the base of the stack and has no arrow, which is how the QA matrix's deep links reach it). `qa/lib/screens.ts` declares them, the login and the two startup states as `header` layouts without the `Back` control; the parity references of those screens (and the a11y reading order of the header) are to be taken again. The signed-in screens stay outside the suites until a QA session exists (`notCovered`).

## Expo modules at boot

Every Expo package the app imports (secure store, crypto, application, constants, file system, fetch, splash screen, localization) and the engine module itself are Expo modules, so `expo-modules-core` runs inside the headless host. Its Kotlin module registry used to sit on both boot critical paths. On the Samsung (`.rasheed/native-qa/2026-10-25/runs/boot-lazy/`):

- the instance-init pool thread spent 15 ms of `ReactInstance.initialize#initTurboModules` (41.7 ms) registering eight modules, 4 ms on the first `ModuleDefinition`, and about 15 ms constructing the `AppContext`, before JavaScript could start;
- the JavaScript thread then loaded `libexpo-modules-core.so` (17 ms, which pulls in `libworklets.so`), registered five more modules and built nine JavaScript module objects (≈ 18 ms) while the bundle was being evaluated, before the first commit.

`patches/expo-modules-core@57.0.23.patch` (the lazy registry `MainApplication` switches on with `expo.modules.lazy=true`) takes all of that off both paths. No module behaves differently; each is built earlier, on another thread.

### What the patch does

- **Every module is lazy.** `LAZY_MODULE_NAMES` maps module class to JavaScript name for each Expo module in the app plus `SvelteEngine` and `ViewBench`; `NativeModulesProxy` and `ExpoModulesCoreJSLogger` are registered by name through `registerLazily`. Nothing is registered or defined while `initTurboModules` runs. A lazy module is built on first lookup by name or type and replays `OnCreate` and `RegisterActivityContracts` when the startup round has already happened. Modules with foreground, background, intent or view hooks must not be listed, because those rounds are not replayed; `packages/svelte-native/tests/expo-lazy-modules.test.ts` checks every entry's name and hooks against the module sources.
- **The `AppContext` is built off the pool thread.** `NativeModulesProxy` creates its `KotlinInteropModuleRegistry` (whose construction creates the `AppContext`, a handler thread, the coroutine scopes and the services) on first use instead of in its constructor; `ModuleRegistryAdapter.createNativeModules` starts the prewarm thread once the other registry is complete, and whoever needs the interop registry first (`getConstants()` on the JavaScript thread, `ExpoBridgeModule`) waits at its lock. With `expo.modules.lazy` off the registry is built in the constructor as before.
- **A prewarm thread builds what the app needs.** `expo-modules-prewarm` loads `libexpo-modules-core.so`, creates the `AppContext`, builds the core module's JavaScript object, then registers each name in `PREWARM_MODULE_NAMES` and builds its JavaScript object, in the order the bundle reaches them (crypto, file system and fetch, which only some screens import, come last). The JavaScript thread finds modules ready, or waits only for the one it needs. A failure is logged (`ExpoModulesCore`, "Prewarm") and reappears with its stack at the first real use.
- **Localization stays at startup.** Its `OnCreate` sets the RTL flags before JavaScript reads them, so `postOnCreate` materializes `STARTUP_MODULE_NAMES` first; the prewarm thread has normally built it by then.
- **No JSI off the JavaScript thread.** Building a module's JavaScript object runs its `Constants` block. `NativeModulesProxy` exports `NativeUnimoduleProxy.getConstants()`, which installs the JSI interop, so it is prewarmed definition-only (`DEFINITION_ONLY_MODULE_NAMES`); every other prewarmed module's `Constants` block is pure. `MainRuntime...install` must stay on `mqt_v_js` in a trace.
- **Locks.** A gate per module name serialises its creation; a read/write lock makes `postOnCreate` (write) and creation (read) exclusive, so a module is either in the registry before `MODULE_CREATE` is sent or replays it. A module stays `pending` until it is complete, so lookups on other threads wait at its gate and `getModule<T>()` skips holders that are still pending.
- `MainRuntime.coreModule` is `by lazy`: the first `ModuleDefinition` (Kotlin DSL class loading) is paid on the prewarm thread.

### Native view adapter and `NativeModulesProxy`

`NativeViewManagerAdapter.native.tsx` (reached through the host's `deps-expo.ts` import of `expo-modules-core`) imported `NativeComponentRegistry` at the top, which evaluates `getNativeComponentAttributes` and `UIManager` at boot (the JavaScript boot lane measured `UIManager.js` at 43 ms and `BridgelessUIManager.js` at 9 ms of self time on the emulator). The patch requires the registry inside `requireNativeComponent`, on the first Expo native view; `tests/expo-lazy-modules.test.ts` fails if the top-level import comes back.

`NativeModulesProxy.native.ts` stays as it is. Its top-level read of `NativeModules.NativeUnimoduleProxy` is what runs `NativeModulesProxy.getConstants()`, and that call installs `globalThis.expo` and sends `OnCreate` to the modules before `EventEmitter.ts` reads `globalThis.expo.EventEmitter` (`requireNativeModule.ts` imports it first). The proxy object it builds is always empty, because the Java proxy exports no methods and no constants, but the 35 ms the boot lane saw there are that native start-up work (the JSI install is 11 ms on the emulator, then the `OnCreate` round and the legacy registry), not the construction. Skipping the read would need `ExpoBridgeModule.installModules()` to start the modules and an explicit install before `EventEmitter.ts`, and would pay the same work through the same module interop.

### The React Native shim

`src/fabric/react-native-lite.ts` stands in for the `react-native` index for the Expo packages. Its `codegenNativeComponent` export evaluated the view-config registry and the style attribute processors when the shim loaded: with a boot mark after each import (emulator, four launches) that one import took 109–151 ms of the 160 ms `expo-core` phase, and only Reanimated's `SharedTransitionBoundary` calls it. `StyleSheet`, `codegenNativeComponent`, `processColor`, `PixelRatio`, `Appearance`, `useColorScheme`, `StatusBar` and `Networking` are now required on first use (`lazyObject` and `lazyFunction`, forwarding to the real module). `tests/react-native-lite.test.ts` checks that loading the shim evaluates only the seven modules the first screen needs and that each lazy export loads its module once, on first use. `StyleSheet` is still used before the first commit (a boot mark on first use fires in the `fabric` import phase; `expo/src/errors/AppEntryNotFound.tsx` calls `StyleSheet.create` at import), so it loads then.

### Measured (OVH emulator `localhost:5555`, release x86_64, interleaved launches, medians)

Three builds from one tree, 6 launches each (`base` is the registry before this patch):

| | base | lazy + prewarm | + `AppContext` off the pool thread |
|---|---|---|---|
| `ReactInstance.initialize#initTurboModules` | 107 ms (53–148) | 54.5 ms (19–113) | 20.7 ms (8–85) |
| `[ExpoModulesCore] ModuleRegistry.register` slices inside it | 8 | 0 | 0 |
| pool-thread CPU inside it | 75 ms | 11.9 ms | 3.2 ms |
| `ReactInstance.initialize` ends, so the bundle starts loading, at | 465 ms | 377 ms | 355 ms |
| first `SvelteEngine.mount` | 785 ms | 779 ms | 791 ms |

The host was loaded during that run (the base `initTurboModules` is three times its usual value), and the emulator's four vCPUs are saturated by `RenderThread`, the activity start and the prewarm thread together: the bundle starts 90–110 ms earlier, the JavaScript phase then takes about as much longer, and the first mount does not move. An earlier, quieter run of base against lazy + prewarm (same bundle, 5 launches) gave `initTurboModules` 33.3 ms to 17.7 ms, Expo work on the JavaScript thread before the first mount (library load, register, `jsObject`, install) 52.4 ms to 11.4 ms, and first mount 776 ms to 670 ms. Moving work to another thread only shortens the boot where a core is idle, as on the phone (eight cores, the JavaScript thread nearly the only busy one in `boot-lazy`); that needs a phone trace. `-Dexpo.modules.prewarm=false` (set next to `expo.modules.lazy` in `MainApplication`) keeps the lazy registry and drops the thread, to compare.

Lazy shim exports (5 interleaved launches, same bundle, lazy + prewarm in both): `[Svelte boot]` total 361 ms to 279 ms, shorter in all five pairs; this one removes work instead of moving it.

A third build with the lazy registry but no prewarm thread and no deferred `AppContext` (`-Dexpo.modules.prewarm=false`) builds the modules the app uses on the JavaScript thread, as they are first needed (`[Svelte boot]` total 253 and 335 ms against 197 and 203 ms for base, two launches); the thread takes that work off the JavaScript thread.

`ModuleRegistry.register` slices still appear before the first mount, all on `expo-modules-prewarm`. For the Samsung the work taken off the critical paths is about 70 ms of CPU (15 + 4 + 15 on the pool thread, 17 + 18 on the JavaScript thread, from the `boot-lazy` trace), plus the `codegenNativeComponent` import; that is a projection until the phone is traced.

### Direct JSI functions: not built

The plan asked for the boot-time Expo calls as direct JSI host functions. With the registry off both paths there is nothing left for them to win. What remains on the critical path is `MainRuntime.install` (5.4 ms on the phone; it needs the Hermes runtime and the JavaScript thread) and the JavaScript evaluation of `expo-modules-core`. Direct functions cannot reach those: the bundle still imports `expo-modules-core` (`EventEmitter`, `SharedObject` and `NativeModule` are read from `globalThis.expo` when it is evaluated) and the engine module is itself an Expo module. They would also duplicate the Keystore path of `expo-secure-store`.

### What would cut further (outside this patch)

- Passing a `BindingsInstaller` to `getDefaultReactHost` would install the JSI interop before the bundle is evaluated, taking `MainRuntime.install` off the evaluation path (the generated `MainApplication`, `packages/svelte-native/src/expo.ts`).
- `libhermesvm.so` and `libhermestooling.so` load on the pool thread before `initTurboModules` (26 ms on the phone, 34 ms on the emulator); starting that load from `MainApplication.onCreate` on a background thread overlaps it with the rest of the application start (same file).
- Imports that pin modules at boot and cost JavaScript evaluation: `expo-crypto` (`class AESEncryptionKey extends` the native class, imported by `session.svelte.ts` for `randomUUID`), `expo-file-system` (`File`) and `expo/fetch` (both from `files.ts`). Lazy route modules take the last two off the first screen.

### Checking a change

Take a boot trace (`.rasheed/native-qa/2026-10-25/tools/boot_trace.sh`) and look for: no `[ExpoModulesCore] ModuleRegistry.register` slice inside `ReactInstance.initialize#initTurboModules`; `ModuleRegistry.prewarm` on `expo-modules-prewarm`; `MainRuntime...install` on `mqt_v_js`; no "Prewarm" error in logcat. After an Expo upgrade, regenerate the patch against the new files, run `pnpm install`, then `bun test tests/expo-lazy-modules.test.ts`: it fails when a name in the lists no longer matches the source, or when `node_modules` does not carry the patch.

## Boot on the phone: the slow launches, `BootBoost`, what the JavaScript thread still pays (28 October 2026, Samsung A16)

Measured with the harness (`boot --warm 30`, `Start proc` to `Displayed`, `am start -W`), Perfetto traces of single launches (`sched`, `freq`, `am`, `dalvik`, `app` slices, started 1.5 s before `am start`) and `simpleperf` on the profileable QA build. Build 86a2de13e before; the same tree plus the changes below after.

**One launch in four ran its start-up at half speed.** The 30 warm launches of `boot-R58Y90KNGRP-20261027T173424Z` had 21 at 86 to 96 ms of `[Svelte boot]` JavaScript and 9 at 110 to 181 ms (p90 172); the same launches show `Displayed` at 289 to 321 ms and 382 to 490 ms (p90 438). Twelve traced launches (two slow): the slow ones ran `mqt_v_js` for 173 and 196 ms of CPU against 94 to 101 ms, 9 to 14 ms of it on the big cores against 66 to 71 ms. The clocks were not the difference (the launch boost holds both clusters at 2.0 and 2.2 GHz for the whole start-up, and the little cores ran at 2.0 GHz); the core type was: an A55 at 2 GHz does about half the work of an A76 at 2.2. The scheduler places a thread that has just started on a little core unless a big one is idle, and in both slow traces both big cores were taken by something else: `system_server`'s `HeapTaskDaemon` (212 and 403 ms of a big core inside the launch) on one, and on the other the shell's own JVM (`am start -W` runs `app_process`, 200 to 460 ms of a big core in every traced launch). `cmd activity start-activity -W`, which has no JVM, leaves the distribution as it was (30 interleaved pairs of the build before these changes: 6 and 7 slow launches of 30, `Displayed` p90 437 and 460), so the shell is not the tail; the system's own GC is, and that is the phone's. What is ours is that nothing asks for the big cores.

**`BootBoost` (`BootBoost.kt`, `Affinity.kt`, `boot/Affinity.cpp`).** The Application pins its own thread to the big cores (`sched_setaffinity`; the cores whose `cpu_capacity` is at least half of the largest, 6 and 7 here; a device with alike cores is left alone) around `reactHost.start()` (generated into `MainApplication` by `applyHeadlessApplication`). A new thread inherits the affinity of its creator, so the pool thread that initializes Hermes and the TurboModules and the JavaScript thread it starts begin on the big cores, with no polling and no window. The first transaction applied on the main thread (`MountingManager.apply`), or 3 s, gives every thread whose mask lies inside the pinned one the mask the Application had (threads the pinned ones created in the meantime inherited it too: `Affinity.reopen`; the pinned mask is read back after pinning, because `sched_setaffinity` intersects the request with the cpuset). A process started for something that is not on screen (importance above visible: a push message, a job) pins nothing, and a device whose `svelteaffinity` library cannot be loaded runs without the boost. The cores are those whose `cpu_capacity` is at least half of the largest, over the indexes of `/sys/devices/system/cpu/possible` (up to 63); `BigCores.kt` holds the rule and `tests/big-cores.test.ts` runs it on the layouts of a 2 + 6, a 1 + 3 + 4 and an all-alike phone, with a core offline and with more cores than a mask holds. Variants, 30 warm launches each (JavaScript p90 / `Displayed` p90): none 172 / 438; a watcher thread pinning the pool and JavaScript threads by name, polling `/proc/self/task` (a thread carries its creator's name for a few milliseconds, so some were pinned late) 104 / 354; the JavaScript thread only 113 / 383; the JavaScript thread only at priority -8 111 / 370; both threads at -8 115 / 369; inherited affinity, the version that ships, 72 / 346. Priority did nothing the affinity did not.

**`libexpo-modules-core.so` is loaded off the JavaScript thread.** `MainRuntime.install` was 18.5 ms on `mqt_v_js`, 10 to 14 ms of it `SoLoader.loadLibrary` (`libexpo-modules-core.so`, which pulls `libworklets.so`). `BootBoost.begin()` starts that load on a thread of its own while Hermes starts; SoLoader answers the JavaScript thread's request from the same table. The `updates` phase (it is the evaluation of `expo-modules-core`, its first importer: `loadNative()` itself is 0 ms and the module's constants 1 ms, so passing the launch record through `getLaunchOptions` would save nothing, and the record would go stale after `reloadAsync`, whose surface keeps the first launch's props) went from 28.5 to 13 ms median, `[Svelte boot]` 76.5 to 66 ms (p90 88 to 79).

**`Keyboard` loaded `UIManager.js`.** `components/Modal.svelte` imported `Keyboard` at the top; `Keyboard` imports `LayoutAnimation`, which imports `UIManager.js`, whose module body spreads the bridgeless `UIManager`: the spread reads the lazy getter of every view manager, 16 `ReactInstance.getConstantsForViewManager` calls, 21 ms of the JavaScript thread (this was the whole 22 ms of the `@rasheed/svelte-native` import in the app phase). `src/keyboard.ts` requires it once, from a timer that the host starts after the first commit (`whenBooted`, `runBootTasks`): `Keyboard` knows whether the keyboard is up from listeners it registers when it is first loaded, so loading it on the first back press would have it report no keyboard with the keyboard up. `tests/boot-graph.test.ts` walks what the bundle evaluates at load (static imports and `require`s outside functions, `.svelte` compiled, Metro's substitutions applied, the platform app's layout and the packages it reaches) and fails with the import chain when `Keyboard`, `LayoutAnimation` or `UIManager` is reached. The rest of the app phase is 0 to 1 ms per import (valibot 1, expo-font 1, the message catalogs 0).

**What is left on the JavaScript thread (58 ms median).** `init 1 · polyfills 3 · rn 2 · expo-core 7 · updates 1 · SecureStore 15 · first commit 17`. The 15 ms is `state.svelte.ts` reading `SecureStore.getItem("interface_language")` while the module loads: seven binder transactions to keystore2 (key entry, `createOperation`, the AES-GCM decrypt; 0.4 to 4.4 ms each) on the JavaScript thread. A language is not a secret, but moving it to a plain store changes where existing installs keep it, and reading it after the first commit changes the language of the first frame for a user whose stored language differs from the device's; neither is done. `expo.modules.prewarm` stays off: with the Keyboard fix and the pin, on / off (30 warm each, before the library preload) was `[Svelte boot]` median 73.5 / 76.5, p90 88 / 88, `Displayed` median 284.5 / 292, p90 318 / 345; the cold-start soak the patch asked for was not run.

**Result.** Quiet phone, 28 October, warm, 30 launches, `am start -W`: `[Svelte boot]` p90 172 -> 72 ms (median 92.5 -> 58), `Displayed` p90 438 -> 346 (median 306 -> 296). The timeline of a launch now (Perfetto, ms after `Start proc`): `bindApplication` 60 to 80; the pool thread's `ReactInstance.initialize` 143 to 245 (it waits for a big core: `R` 45 ms and `R+` 23 ms of its 100); the JavaScript thread 145 to 300 (49 ms of CPU); the first mount 300 to 320; the first frame 340. On 31 October the phone was 25 to 40 % slower for every build (64 MB of free memory with 1.7 GB in swap, Android Studio's screen-sharing agent at 97 % of a core, another app installed and started on it by a developer while the proof ran), so the two builds were measured back to back, interleaved, 20 warm launches each, twice: build 86a2de13e-equivalent `c75c31491` `[Svelte boot]` median 133 and 130.5 ms, p90 275 and 221, `Displayed` median 426 and 435, p90 625 and 605; this tree 68 and 68.5, p90 83 and 81, `Displayed` median 376 and 379, p90 427 and 432. The 30 + 30 launches of the proofs, same day, three of them over four hours (the first two on the tree before MountBoost's last change; every one of them with MountBoost on: the first screen is created right after `BootBoost.release`, so MountBoost pins the main thread and the RenderThread for 400 ms of the boot as well, and what that does to the boot was not measured apart from the rest): `[Svelte boot]` p90 85, 81 and 76, `Displayed` p90 421, 466 and 442 warm, 415, 444 and 445 cold. The bar is 350 on a quiet phone (346 on the 28th); today's phone does not reach it.

## Frames: recycling, text cache

Everything here is on the UI thread and changes no prop semantics or batch encoding. Measured on the OVH emulator (software GPU: absolute frame numbers are noisy there, the engine's own mount time and allocation are the reliable deltas); the phone verdict comes from the integration lane.

### View recycling (`views/ViewPool.kt`, `MountingManager`)

- Pooled kinds: the plain container (`EngineView` itself, not its subclasses), `EngineText`, `EngineScroll`, `EngineHScroll`. One free list per kind, at most 512 views each, dropped on `onTrimMemory(UI_HIDDEN)` and `onLowMemory`. Input, switch, image, spinner, modal, stack and screen are created fresh: each holds platform state (IME, listeners, loaders, back callbacks) that only its own file can clear; a kind joins the pool by adding a `resetForReuse()` and a slot.
- `OP_DELETE` hands the view to `ViewPool.release`. A view comes back only when nothing can still reach it: detached from the window (Fabric sends REMOVE for the root of a deleted subtree and DELETE for every node, parent or child first, so descendants are still children of a detached parent; the pool detaches them), no `Animation`, no transient state, no child that is not an `EngineNode` (a foreign view stays with its owner), and for scroll views no drag, momentum phase or running fling (`ScrollBridge.isIdle`). A view still attached when its DELETE arrives (a screen playing its exit keeps its whole subtree attached, a layout animation holds its node) is remembered and taken back by `sweep()` once detached: at the start of the next batch and from a 500 ms timer while any are held.
- Reset (`ViewPool.reset`): detach, scroll offset to 0 with the bridge's `native` unset (no event for a dead tag), `removeAllViews`, text content cleared, alpha, translation, scale, rotation, visibility, elevation, `tag`, `contentDescription`, focusable, important-for-accessibility, `NodeState.reset()` (tag, frame, padding, pointer events, hit slop, overflow, stacking, test ID, role, background colour, radii, border), then `forceLayout()`. The `GradientDrawable`, the a11y delegate and the outline provider stay installed (each is rewritten or removed by the next full prop record, `Props.applyCommon` with `create = true`), so a reused view allocates none of them again. Detach happens before the node state resets because parents count stacked children from the values the children carried when they were added.
- The registry maps tag to view as before; a recycled view is registered under its new tag and tags are never reused, so a write for an old tag cannot reach another node. `applyAnimated` handles the three cases of a tag that is not live: (1) deleted a moment ago (a ring of the last 1024 deleted tags): the write is an expected late write of a mapper or CSS animation that outlives its node by a few frames and is dropped silently, falling through to React Native's path would throw on every frame; (2) not mounted yet: Reanimated's UI task for a new node runs ahead of the posted batch that creates it, so the first write finds no view; the newest write per tag (at most 64) waits in `earlyAnimated` and `createView` replays it over the committed props, the order a view that had mounted first would have seen; (3) never mounted: an entry that no batch claimed within 1 s is dropped with `W SvelteEngine: animated write for tag N, no view was mounted for it` (first three), which points at a real mismatch. Before this, case (2) and (1) were the three `unknown tag` warnings per lab run.
- `SvelteEngine.newView` is a trace slice around every view construction, so a Perfetto trace counts the views a scenario still creates after warm-up.

### Text layout cache (`TextLayouts.kt`)

- `TextLayouts.build` looks up a `LayoutKey` before it builds: every fragment field (text, size, colour, weight, style, family, letter spacing, line height, decoration flags, transform, background, opacity, shadow, variant), the paragraph options (alignment, lines, ellipsize, break strategy, font padding, hyphenation, fit, minimum size, vertical alignment, direction), the width, and the height only when `adjustsFontSizeToFit` or `textAlignVertical` make it matter. Prepared layouts bypass the cache.
- Hits allocate nothing (one reusable probe key; a miss stores a snapshot, because animated props edit the spec's fragment list in place). Bounded: 768 entries and 200 000 characters, least recently used out, cleared on `onTrimMemory` and on configuration changes (font scale, locale and direction change the layouts). A cached `Layout` is immutable once built and drawn from the main thread only, so views share it.
- `SvelteEngine.text.build` marks each build in a trace; `SvelteEngine.texts` brackets the end-of-batch rebuild.

### Scroll bridge (`views/EngineScroll.kt`)

`ScrollBridge.emit` and `pushState` pass primitives to `dispatchScroll` / `updateScrollState`; a heap profile of the list scenarios attributes no Java allocation to the bridge (see the numbers below). The one allocation per snapped fling, the scratch `OverScroller` of `predict`, is now one per bridge.

### Screen insert at the end of the batch (`MountingManager`)

Fabric inserts top-down, so a pushed screen arrives before its subtree. `MountingManager` keeps the INSERT of a screen into an `EngineStack` until every op and the text rebuild of the batch are done, places the screen's frame (which measures and lays out the whole detached subtree), and only then calls `EngineStack.insertScreen`. The subtree is built detached and the 250 ms transition starts from a complete tree. A screen that is removed or deleted in the same batch never reaches the stack. `EngineStack` is unchanged.

### Alpha without layers (`hasOverlappingRendering`)

Android promotes any view whose alpha is between 0 and 1 to a hardware layer of its own when `hasOverlappingRendering()` is true (`RenderProperties::promotedToLayer`), and `View`'s default is true. React Native's `ReactViewGroup` answers `needsOffscreenAlphaCompositing` (default false) and `ReactTextView` answers false, so a fading view in React Native is drawn with its alpha multiplied into each primitive and never through a layer. The engine does the same: `EngineView.hasOverlappingRendering` returns `offscreenAlpha` (record 15 bit 1, `needsOffscreenAlphaCompositing`), `EngineText` returns false, `EngineSheet` false (its scrim), and scroll views, images, inputs and switches keep Android's default as their React Native counterparts do. Record 15 bit 2 (`renderToHardwareTextureAndroid`) sets `LAYER_TYPE_HARDWARE` on ordinary views (never on screens, whose layers belong to the stack); the pool clears both on release. Measured on the A16 (26 Oct, `runs/churn-layer/`): before the change every animated tile with opacity 0.3–1 was a layer, rebuilt each time its opacity crossed 1 (`flush layers` 6–10 ms after every churn round, pairs of small flushes between), animation-48 dropped 0.3–0.4 % with maxima of 26–68 ms; after it animation-48 and animation-48-css drop 0.0 % (max 16 and 14 ms), animation-48-square 0.1 %, animation-48-translate 0.4 % (max 23); churn-animated stays at 3.7 % (its cost is elsewhere, see the QA notes of 26 Oct).

### Hook for foreign views

Foreign views are in "Foreign views" below. The reserved `attachForeign(tag, parentTag, index)` stub is gone: the engine keeps a frame (`EngineForeign`, an `EngineNode`) for every foreign root, so the engine's own inserts place it, and `ForeignViews` only puts React Native's view inside the frame. A foreign view is never pooled (`ViewPool` leaves a view that has a non-`EngineNode` child alone, and the frame is not one of the pooled classes).

### Stats for the soak runner (`SvelteEngine.stats()`)

`SvelteEngine.stats()` (SvelteEngineModule.kt, read on the main thread with the same 500 ms wait as `getInsets`, `null` while the main thread is busy longer or before `install`) returns `MountingManager.stats()`: `alive` (views in the registry, mounted under a React tag), `pooled` (free views of every kind in `ViewPool`), `held` (deleted views still attached, waiting for `sweep()`), `created` and `deleted` (totals since the process started), and the classes of an animated write that found no view: `lateWrites` (the tag was deleted a moment ago: the expected late write of a mapper or CSS animation, dropped silently; measured at about 0.7 per destroyed animated tile in the churn scenarios), `staleWrites` (the same, more than 1 s after the delete: an animation that outlives its node), `replayedWrites` (the tag was not mounted yet and the write was replayed on its view), `expiredWrites` (no batch created the tag within 1 s, the warning above), `overflowWrites` (dropped because the table of 64 early writes was full) and `earlyPending`, plus the sizes of the C++ delegate's tables: `emitters` (nodes it holds an event emitter for) and `scrollStates` (scroll views it holds a state for). A node Fabric reported deleted must be gone from both, so with everything unmounted `emitters` equals `alive`. The lab (`Stress.svelte`, scenario `soak-mix`) logs them with the Hermes heap of both runtimes in `[Svelte soak]` lines; `apps/platform/qa/soak` derives `memory.leakedViews` from `alive`, `memory.leakedEmitters` from `emitters` and `memory.deadTagWrites` from `staleWrites + expiredWrites + overflowWrites`. `SvelteEngine.collectJava()` runs a full Java collection with its finalizers (`System.gc()`, `runFinalization()`, `System.gc()`): the lab calls it before every idle window, because a dead view, text layout or render node keeps the native memory behind it (display lists, measured paragraphs) until its Java object is collected: a window should not depend on when ART last ran.

### Measurements (OVH emulator, 60 Hz, software GPU, medians of 10 runs after one discarded warm-up run; AOT-compiled, `cmd package compile -m speed`)

Same lab scenarios, same emulator boot, same minute-scale window for both columns (before = the build without these changes, after = this tree). "Engine apply ms/run" is the sum of the `apply=` of every batch inside the scenario window (the UI-thread time the engine itself spends); "largest batch" is the longest single batch. Frame columns come from the lab's UI-runtime frame intervals; on this emulator they are dominated by the software renderer (`draw-VRI` blocks on the RenderThread for ~17 ms per frame while anything animates), so they do not move.

| scenario | dropped % before → after | p99 ms | max ms | worst run max | engine apply ms/run | largest batch ms | mount→layout ms |
|---|---|---|---|---|---|---|---|
| churn-static | 0.1 → 0.0 | 20.0 → 21.0 | 26 → 23 | 38 → 35 | 54 → 26 | 2.2 → 1.0 | n/a → n/a |
| churn-animated | 19.9 → 20.2 | 50.0 → 48.0 | 60 → 61 | 68 → 67 | 56 → 30 | 7.4 → 3.5 | n/a → n/a |
| modal-8 | 3.1 → 3.3 | 39.0 → 39.5 | 82 → 81 | 130 → 98 | 89 → 95 | 16.9 → 26.4 | n/a → n/a |
| navigation-8 | 8.1 → 7.7 | 33.0 → 33.0 | 42 → 43 | 55 → 85 | 51 → 23 | 8.0 → 5.8 | n/a → n/a |
| list-300 | 15.4 → 16.8 | 35.5 → 34.0 | 44 → 43 | 53 → 71 | 31 → 29 | 29.4 → 28.3 | 170 → 168 |
| list-300-virtual | 8.5 → 8.0 | 36.0 → 34.0 | 43 → 42 | 52 → 53 | 73 → 20 | 11.6 → 2.0 | 21 → 23 |
| input-120 | 0.3 → 0.3 | 21.0 → 21.0 | 40 → 34 | 62 → 46 | 168 → 164 | 10.7 → 8.8 | n/a → n/a |

- Warnings: `W SvelteEngine` lines per run 3 → 0 (cause: Reanimated's UI task for a new node runs ahead of the batch that creates it, see "View recycling" above; the write is kept and replayed). Fatals 0, JS errors 0 in every run; modal-8 8/8 shows, navigation-8 depth 2/2, input-120 120/120, 1008/1008 and 784/784 views mounted/destroyed in the churn runs.
- Allocation (heapprofd, ART heap, 128-byte sampling, before the changes): `MountingManager.createView` allocates 716 KB in one 8.4 s `churn-static` window (55 % of the Java allocation of that window) and 562 KB in `churn-animated` (13 %, the rest is Reanimated's per-frame `ReadableMap` construction in `SynchronousPropsBufferParser.parse`, `HashMap.resize`, `JavaOnlyMap`: 4.3 MB in 8.6 s); in the `list-300` window no Java allocation is attributed to `ScrollBridge` per scroll event (4 sampled objects in `startPostTouchScrolling`, one `Runnable` per momentum phase, now one per bridge).

### The long frame of `list-300` on the A16 (27 October)

The Samsung dropped one interval of 44–60 ms in 16 of 19 `list-300` runs (`list-300-clipped` 38–44 ms, `list-300-raw` up to 62 ms, `list-300-virtual` up to 25 ms), and none of it was scrolling. A Perfetto trace of one run (sched, freq, gfx, view, am, dalvik, app tags, frametimeline) has all 440 intervals of the three scroll legs at 12 ms or less; the long one is the first of the window, from the JS thread's `startFrameMonitor` call to the first UI frame callback (70 ms), and the `durationMs - coverageMs` of every run (63 ms against a 60 ms maximum) says the same. The scenario opened its window on the last row's `onLayout`, but Fabric emits that at commit, before the engine has applied the mount on the UI thread, so the window held that apply and the first draw of 300 non-virtual rows: `SvelteEngine.mount` 43 ms on the main thread (600 views, 35 ms of it `create`; its first 19 ms on a little core while that cluster stepped 500 → 1150 MHz, then on cpu6 at 2.2 GHz), a 29 ms frame (`Record View#draw` 20 ms recording the display lists of all 300 rows once, RenderThread `DrawFrames` 19 ms), and about 80 ms of frames settling (RenderThread 14 → 4 ms). No GC, JIT, bitmap decode, layer build or text layout burst (`SvelteEngine.texts` 0.3 ms) was in it, and the cpu frequency did not dip in the scroll legs: the cost is the mount of 600 views, which the windowed List avoids (12 ms), not scrolling, and it is a one-time cost, not a regression. When JavaScript delivered the layout after the mount had landed, the run was clean (3 of 19), which is why the plain, clipped and raw variants differed from run to run. `Stress.svelte` now waits six frames after the layout before it opens the window (`mountFrames`, for `list-300*` and `list-300-virtual`). On build 21443c1cea1f (3 launches of all four): `list-300` 0.0–0.2 % dropped with maxima 14, 16 and 17 ms (one 17 ms interval, one vsync of jitter), `list-300-clipped`, `-raw` and `-virtual` 0.0 % with maxima 12–15 ms; the production bar's 33 ms holds in all twelve.

### The late frames of a push, and `MountBoost` (28 October 2026, Samsung A16)

`navigation-8` dropped 0.5 to 1.1 % of its intervals and `header-8` 0.3 to 1.2 % (longest interval 23 to 28 ms) on every lab run; the bar is 0.0 %, which with one decimal means no late interval at all in 1 174 and 942 (the worst of ten runs counts). A Perfetto trace of `lab --run navigation-8,header-8` (29 late intervals in 2 931 frames; late is more than 1.5 periods, 16.7 ms at 90 Hz) shows two late intervals for every screen pushed, and nothing else:

1. **`SvelteEngine.mount` of 12 to 21 ms on a little core.** The batch of a 128-view push (13 500 ops) is `create` 1.7, `insert` 1.2, `texts` 0.4 and `screens` 7.4 to 8.5 ms (`flushScreens`: measure and layout of the detached subtree, then the start of the transition) on the main thread. It ran on cpu 2 to 5 at 500 MHz when the batch arrived and stepped to 2.0 GHz during the 14 to 21 ms. A navigation started from JavaScript follows no touch, so nothing told the governor ("Clocks" above: the same push behind a real tap mounts in 4.4 ms).
2. **The first frame of the new screen: `doFrame` 17 to 22 ms.** The main thread sleeps in `draw-VRI` -> `postAndWait` for the RenderThread: `DrawFrames` 21.4 ms for the first frame (`syncFrameState` 2.4, `Drawing` 15.9, of it `flush layers` 3.3, `flush commands` 3.2, `eglSwapBuffers` 4.4), then 15.7, 11.7, 9.8, 7.8 and 7.6 ms for the next five, on cpu 3 or 4 at 500 MHz at the start.

Neither is work the engine does too much of; both are a cold little core. **`MountBoost` (`MountBoost.kt`)**: when a batch creates a screen (`createView`, kind screen: a push or a sheet), the main thread and the RenderThread (found by name once, on a thread of its own, so the first push goes without it) are pinned to the big cores (`Affinity`) until 400 ms after the last screen was created, then their masks are restored. A device with alike cores is left alone.

How it got there. The first version started at any batch of 2 500 ops or more (a 128-view push is 13 500). Ten runs of `lab --run navigation-8,header-8` on the quiet phone (28 October), how many of the ten navigation and header runs had a late interval: before the change every run (0.5 to 1.1 % and 0.3 to 1.2 %); 2 500 ops and 150 ms 8 and 3; 700 ops and 150 ms 6 and 3; 700 ops and 400 ms 6 and 6; 2 500 ops and 400 ms 6 and 3 (longest interval 15 to 19 ms against 23 to 28 before). But a full `checks,quick` run, three runs per build in the same hour (31 October), showed what it cost: `list.virtual300.mountMs` with the build before 12.1, 12.8, 12.3 ms, with the same tree without MountBoost 12.5, 11.8, 11.6, with the 2 500-op version 24.2, 26.0, 18.7 (150 ms hold: 19.3, 16.3, 16.8). The windowed list's first rows are a 6 642-op batch, the same size as 48 animated tiles (6 600), and the mount is JavaScript-bound (below): the pinned main thread and RenderThread take the two big cores from the JavaScript thread, which is still finishing its flush and handling the layout event. A batch that makes the main thread wait for a cold core is the push, and in a push the JavaScript thread has finished; so the trigger is the screen. With it (nine complete runs of `navigation-8,header-8`, three full runs): navigation 2 of 9 runs with one late interval (0.08 and 0.09 %, longest 13 to 18 ms), header 4 of 9 (0.1 to 0.21 %, 14 to 20 ms); in the full runs navigation 0, 0, 0.09 %, header 0, 0, 0, `list.virtual300.mountMs` 11.7, 12.3, 14.6 ms, `animation-48` longest interval 38, 34, 33 ms (build before 31, 28, 32: the 48 tiles' mount is not a screen and is not boosted; the 2 500-op version had it at 15). What is left of a typical run is one interval of 17 to 19 ms (0.1 %) on the first frame of a header toggle or a pop that does not create a screen, drawn by a RenderThread still on a little core at 500 MHz (`DrawFrames` 13 to 22 ms there), so the 0.0 % bar is not met on this phone. What would remove it is a floor on the little cores' frequency while a transition runs, which a user-space app cannot ask for (ADPF was tried and ignored, "Clocks" above).

### The per-frame callbacks of an idle screen (28 October 2026)

With nothing on screen moving, the main thread still ran a Choreographer `animation` callback on every frame from the first one: 0.37 ms on a screen without Reanimated (0.18 to 0.25 ms of it `Choreographer#scheduleVsyncLocked`, the request for the next vsync), 0.67 to 0.83 ms once the worklets UI runtime existed. `simpleperf` on the profileable QA build, main thread of an idle screen (`--call-graph dwarf`): libc `ioctl`/`epoll_pwait`/`write`/`recvfrom` 49 % (vsync), ART 11 %, **`libhermesvm.so` 8.5 % and `libworklets.so` 3.1 %** through `ReactChoreographer.frameCallback` -> `AnimationFrameQueue.executeQueue` -> `AnimationFrameCallback` -> `AnimationFrameBatchinator::flush`. Who posts what:

- **React Native, always, while the host is resumed** (nothing of ours): `JavaTimerManager.TimerFrameCallback.doFrame` ends with `postFrameCallback(TIMERS_EVENTS, this)` unconditionally; `FabricUIManager.DispatchUIFrameCallback` re-posts from `finally { schedule(); }`; `FabricEventDispatcher.ScheduleDispatchFrameCallback` re-posts unless stopped and ticks the event beat each frame (`BatchEventDispatchedListeners`, 0.07 ms). Pausing the last two through their public `onHostPause` (the Fabric callback only dispatches the mount items and view commands of React Native's own Java mounting, which the engine replaces, and a paused event dispatcher still ticks once per request; both resumed at the first foreign component) removed the 0.07 ms and left `animation` at 0.37 ms, because the timer callback alone keeps the Choreographer awake and the vsync request is the cost. Not shipped. Stopping the timer callback means patching `JavaTimerManager`, which is in the prebuilt React Native AAR.
- **Worklets, from the moment its UI runtime exists** (`react-native-worklets@0.10.1`, `runLoop/uiRuntime/requestAnimationFrame.ts`): `nativeFlushQueue` re-requested the next native frame unconditionally ("Schedule next frame"), so the UI runtime ran a JNI call and a Hermes call each frame with an empty queue. `patches/react-native-worklets@0.10.1.patch` requests a frame when a callback or finalizer is queued, and after a flush that left one queued. `tests/worklets-frame-loop.test.ts` runs the library's function against a fake native side (it fails when `node_modules` lacks the patch). Idle main-thread samples per second 532 -> 410 (-23 %), no `libhermesvm`/`libworklets` samples left; the lab's 28 checks and every animation scenario are unchanged. The patch is JavaScript and applies to iOS as well; the iPhone was not run.
- Reanimated's own `NodesManager` callback posts only while it has frame callbacks or events, and the animation backend is off (`USE_ANIMATION_BACKEND: false`); the engine's animators run during transitions only.

### The quiet phone, and what is open (1 November 2026)

Android Studio and its screen-sharing agent were stopped (780 % idle in `top`, 1.37 GB available). Build ab94fc0814a3 (the tree before the review fixes of this day), `boot --warm 30 --cold 30` and `lab checks,quick` x10, all ten complete: warm `Displayed` p90 387 ms (median 323; three launches at 419 to 436), **cold p90 290 ms** (the bar is 350), `[Svelte boot]` p90 89 ms warm and 68 cold. A warm launch comes 1.5 s after `am force-stop` of the previous process and is 45 ms slower at the median than the cold one, which follows 20 s of idle: the kill leaves system work behind (`system_server`'s cleanup, ART's profile saver, the zygote's) that the cold gap lets finish, so the warm bar measures that too. Frames, worst of ten: `header-8` and `sheet-8` no late interval in any run, `navigation-8` one or two in three runs, `tabs-8` one in one run; `animation-48`, `animation-48-square` and `animation-48-translate` one late interval in every run, 32 to 47 ms for `animation-48` (the mount of 48 animated tiles is not a screen, so MountBoost does not start for it); `churn-animated` 24 to 29 (decided separately); `input-120` 0 to 3. `list.virtual300.mountMs` 11.6 to 15.1 ms (median 13).

**ADPF** (`PerformanceHintManager`). The A16 supports it: `dumpsys performance_hint` says `Hint Session Support: true`, preferred update rate 11 111 111 ns, five graphics-pipeline threads per session; our uid has no session of its own (HWUI creates none for it), so nothing tells the power HAL what a push needs. An experiment (branch `feat/svelte-native-bars-adpf-experiment`, not for merge: one session over the main thread, the RenderThread and the JavaScript thread with a one-frame target, `FrameMetrics.TOTAL_DURATION` reported per frame for 400 ms after a screen is created, or after a batch of 2 500 ops; a system property selects off, affinity, adpf or the -ops variants) was built and installed, but its measurements did not finish: during each of three attempts another app (`dev.alfayez.odinsokol`) was installed and started on the phone by an adb script (`am force-stop ...; am start -n ...OdinsokolActivity`, uid 2000), which interrupted every lab run. The affinity boosts stay, and the question whether ADPF does as well is open.

**Hermes' sampling profiler on the windowed list's mount** (`lab --run list-mount-hermes`: 200 mounts, `SvelteEngine.profileJs`, `HermesSamplingProfiler` from react-android writes `hermes.cpuprofile` to the app's external files directory; the profiler slows the mount to a median of 40 ms, so the shares are what matters). 819 samples with the JavaScript thread busy (3 348 with the idle ones), self time by source: native host functions 25 % (`completeRoot` 10.4, `createNode` 10.3, `appendChild` 2.2, `cloneNode*` 2.4), Svelte's runtime 34 % (`runtime.js` 15, `reactivity` 11, `dom` 8, `constants` 2, `proxy` 1.4), Hermes builtins 8 %, `host.ts` 8 %, `renderer.ts` 4 %, `animation.ts` 2.6 % (Reanimated is loaded in the lab, so every node goes through `animationProps`), GC young generation 2.4 %, `view-configs.ts` 2 %. Inclusive: the Svelte batch (component creation of the rows: `each` -> `create_item` -> effects) 49 %, the host's `flush` -> `build` recursion 32.5 %, `completeRoot` 10.4 %. The hot paths of the host and renderer together are 17 % of the mount, about 1.7 ms of 10: halving them would not bring 13 ms to 10. What would is less work per node (the windowed list wraps every row in a positioned `native-view`, 4 nodes per row in the lab) or a smaller first window, and neither is a change to the host.

### The windowed list's mount on the phone (28 October 2026)

`list.virtual300.mountMs` was 11.5 to 12.8 ms in the single mount of a lab run (bar 10). 40 mounts in a row (`list-mount-loop`): median 10.7 ms, minimum 8.4, the first three 10.4, 13.0 and 14.9. `list-300-virtual-profile`: Svelte before the host flush 2.7 ms, host flush 7.4 (payloads 0.2, `createNode` 1.5, `appendChild` 0.2, `completeRoot` 3.9, bookkeeping 1.5), the engine's apply 1 to 3. The JavaScript thread was on cpu 6 or 7 at 2.1 to 2.2 GHz in the mount windows, so it is not a clock problem like the push. `simpleperf` on the JavaScript thread during the loop: `libhermesvm.so` 64.7 %, `libreactnative.so` 17.9 % (Fabric: `RawProps` comparisons, `updateMountedFlag`), libc 9.2 %, ART 2.3 %: the time is the JavaScript for 40 nodes in Hermes' interpreter. Hermes' sampling profiler is not exposed in this runtime (`HermesInternal` has no keys), so the attribution inside JavaScript stops there. No change was made: the levers left are fewer JavaScript operations per node or a smaller first window, and a smaller first window would change what the list shows to pass its own gate.

**The ten-run lab with the shipped build** (31 October to 1 November, `checks,quick` x10, 10 complete runs, 28/28 checks, 0 fatals; the phone 25 to 40 % slower than on the 28th, see "Boot on the phone"; two earlier attempts lost runs because another app was installed and started on the phone while they ran). Worst run per scenario, dropped intervals / longest interval, against the ten runs of the build before (27 October, quiet phone): `navigation-8` 0.86 % / 25 ms -> 0.09 % / 18 ms (one run of ten has a late interval), `header-8` 0.95 % / 29 -> 0.10 % / 18 (one run), `list-300-raw` 0.46 / 63 -> 0.23 / 18, `input-120` 0.41 / 37 -> 0.41 / 28, `animation-48` 0.14 / 39 -> 0.14 / 39 (unchanged: the mount of its 48 tiles is not a screen and is not boosted), `churn-animated` 3.62 / 63 -> 3.7 / 61 (decided separately, left alone). Two scenarios have an interval over 33 ms now (`animation-48`, `churn-animated`); four had one before. `list.virtual300.mountMs` 12.1 to 16.4 ms (median 13.9) against 11.5 to 13.5 before; the build before measured in the same hour as this one gave 12.1, 12.8 and 12.3. Every scenario but `animation-48-css` and `tabs-8` still has a run with one late interval of 17 to 19 ms (`idle`, `list-300*`, `input-120`, `modal-8`), one in 180 to 1 200, which `droppedPct` rounds to 0.1 to 0.5 and the 0.0 % bar leaves no room for.

## Updates

Over-the-air JavaScript updates, compatible with `eas update` (PLAN.md, production plan row 9). A fork of `expo-updates` reduced to what this host needs, split by what must run before JavaScript and what can run in it:

- **Protocol, in JavaScript** (`packages/svelte-native/src/updates`): the manifest request, response parsing, selection and the `checkForUpdateAsync` / `fetchUpdateAsync` / `reloadAsync` flow. It is pure over an injected `fetch` and a native-module object, so every rule is unit-tested without a device (`tests/updates-*.test.ts`).
- **Store and launcher, native** (`modules/svelte-updates`, `SvelteUpdates`): the on-disk store, the choice of bundle at process start, file downloads with hashing, the launch-failure marker and the reload. Android is Kotlin, iOS is Swift to the same contract.

`expo-updates`, `expo-manifests`, `expo-json-utils` and the dev client stay out of the build (`headlessExcludedPackages`). Expo's own config plugin already turns `updates` and `runtimeVersion` of the app config into the `AndroidManifest.xml` meta-data / `Expo.plist` keys that `expo-updates` reads, and the module reads those same keys.

### Flow

1. Process start, before the React host reads its bundle: `SvelteUpdatesPackage` (Android) / `SvelteUpdatesReactDelegateHandler` (iOS) ask `Launch.get()`, which reads the build configuration and `UpdateStore.select`, and answer with the launch bundle's path, or nothing (the embedded bundle).
2. First commit (`startSurface`, right after `mark("first commit")`): the host calls `onFirstCommit()` from `src/updates/launch.ts`. It calls `markLaunched()` and, when the build says `checkOnLaunch: ALWAYS`, schedules `checkOnLaunch()` for idle time.
3. `checkOnLaunch()` = `fetchUpdateAsync()`: `readStore()` → one manifest request → decision → asset downloads (4 at a time) → `commitUpdate()` → `saveMetadata()`. The update launches on the next cold start.
4. `reloadAsync()` → `reload()`: the native side selects again (the committed update now wins) and calls `ReactHost.reload` (Android) / `RCTTriggerReloadCommandListeners` (iOS); the host asks for the bundle path again.

### Native module contract (`SvelteUpdates`)

Constants (read once, when the JavaScript module object is created): `isEnabled` (false in debuggable builds, and without `updates.url` or a runtime version), `platform`, `updateId` (the OTA update this process launched, null for the embedded bundle), `runtimeVersion`, `updateUrl`, `requestHeaders` (`expo-channel-name` carries the channel), `checkOnLaunch` (`ALWAYS` | `NEVER` | `WIFI_ONLY` | `ERROR_RECOVERY_ONLY`), `launchWaitMs`, `hasEmbeddedUpdate`, `isEmbeddedLaunch`, `createdAt` (epoch ms of the launched update, or the embedded bundle's effective commit time), `localAssets` (asset key → `file://` URI, launched update only), `clientId`.

Functions, all `AsyncFunction` (a Promise):

| name | arguments | result |
|---|---|---|
| `request` | `url`, `headers` | `{ status, headers (lowercase names), body }`; GET, any status is an answer |
| `downloadAsset` | `{ updateId, key, url, headers, extension, launch, hash }` | `{ key, hash }`; streams to `<file>.tmp` while hashing SHA-256 (base64url), moves into place only if the hash equals `hash`, else throws. `launch` writes `updates/<id>/<bundle>`, otherwise `assets/<key><extension>`; an existing asset file is not downloaded again (its hash is recomputed and returned) |
| `commitUpdate` | `CommittedUpdate` as JSON: `{ id, createdAt, runtimeVersion, metadata, launchAssetKey, assets: [{ key, extension }] }` | adds the update as `ready` (with the build's current update URL and request headers); throws if the bundle or any listed asset file is missing |
| `saveMetadata` | `{ serverDefinedHeaders, manifestFilters }` as JSON | a non-null field replaces the stored one, a null field keeps it (expo-updates `ManifestMetadata.saveMetadata`) |
| `readStore` | none | `StoreSnapshot` as JSON: `{ embeddedCreatedAt, updates: { id: { id, createdAt, runtimeVersion, status, metadata } }, failedIds, metadata }` |
| `rollBackToEmbedded` | `commitTime` (epoch ms) | the embedded bundle's commit time becomes `commitTime` if later than the current one |
| `markLaunched` | none | clears the launch marker, then runs the clean-up |
| `reload` | none | selects again and restarts the React host |

Names, types and the constants/functions lists are checked across `native.ts`, `SvelteUpdatesModule.kt` and `SvelteUpdatesModule.swift` by `tests/updates-module.test.ts`.

### Store

`filesDir/svelte-updates` (Android), `Application Support/svelte-updates` (iOS):

```
index.json                     { version: 1, clientId, buildTime, embeddedCreatedAt?, pending?, failedIds[], serverDefinedHeaders?, manifestFilters?, updates: { id: StoredUpdate } }
updates/<update id>/<bundle>   index.android.bundle | main.jsbundle: the launch asset of a committed update
assets/<key><extension>        every other asset, named by the manifest's `key`, shared between updates
```

`StoredUpdate`: `id, createdAt, runtimeVersion, status ("ready" | "failed"), metadata, url, headers, launchAssetKey, assets[{ key, extension }]`. The index is written to a temporary file and renamed. A file reaches its final name only after its SHA-256 matched the manifest, and an update becomes `ready` only when its bundle and every asset file exist, so a killed download leaves nothing launchable.

### Launch selection (`UpdateStore.select`)

1. A new binary (`buildTime` differs from the index's) clears the `rollBackToEmbedded` override.
2. A `pending` marker left by the previous start means that start never reached its first commit: the update is marked `failed` and its id joins `failedIds` (last 5). The next start therefore falls back to the previous update, or to the embedded bundle, with no further crash.
3. Candidates: `ready`, same runtime version, same update URL and request headers as this build (so a different channel never launches another channel's update), passing the stored `manifestFilters`, bundle file present.
4. The newest candidate launches if its `createdAt` is later than the embedded bundle's commit time (strictly: the embedded bundle wins a tie). The embedded bundle's commit time is its build time (Android `BuildConfig.BUILD_TIME_MS`, the Gradle run that packaged it; iOS the modification time of `main.jsbundle`), or the latest `rollBackToEmbedded` directive applied since.
5. A launched update is marked `pending` until `markLaunched()`. The embedded bundle is never marked.

`clean` (after the first commit) keeps the launched update, every newer one and the newest older one (quick rollback), removes failed updates' files, and removes assets no kept update lists and directories the index does not know, but only once they are an hour old (an unknown file may be a download in progress).

### Protocol coverage (expo-updates 29 / protocol version 1)

| Behaviour | Status |
|---|---|
| Request headers `expo-protocol-version: 1`, `expo-api-version`, `expo-platform`, `expo-runtime-version`, `expo-updates-environment: BARE`, `expo-json-error`, `eas-client-id`, `accept: multipart/mixed,application/expo+json,application/json`, build-time `requestHeaders` (channel) | implemented, same precedence as `FileDownloader.createRequestForRemoteUpdate` |
| `expo-current-update-id`, `expo-recent-failed-update-ids` (sf-list), stored `expo-server-defined-headers`, `expo-extra-params` (sf-dictionary) | implemented (extra params have no setter in the API, so none are sent) |
| `expo-embedded-update-id` | left out: the embedded bundle has no id (upstream reads it from the `app.manifest` its Gradle/Xcode scripts write; this build has none) |
| `expo-fatal-error` | left out (upstream sends the previous start's fatal error text; here the failed-update list says the same) |
| Response: JSON manifest, `multipart/mixed` with `manifest`, `extensions` (`assetRequestHeaders`), `directive`; 204 / empty body with protocol version ≥ 1; non-2xx with the server's JSON error | implemented and tested against responses built from the specification |
| Directives `noUpdateAvailable`, `rollBackToEmbedded` (+ `commitTime`) | implemented, selection as upstream's `shouldLoadRollBackToEmbeddedDirective` |
| `expo-manifest-filters`, `expo-server-defined-headers` (sf-dictionary reading rules, stored until overwritten) | implemented |
| Selection: newer by `createdAt`, filters first, not previously failed, runtime version must match | implemented (`shouldLoadNewUpdate`); stricter than upstream in that an update for another runtime version is never downloaded |
| Asset download by URL with per-asset headers, SHA-256 base64url verification, shared assets | implemented; the manifest is rejected if any asset lacks a well-formed hash, has an unsafe key or extension, or a non-http(s) URL |
| Roll back a failed launch | implemented: launch marker, `failed` status, fallback (see "Launch selection"); upstream's other error-recovery path (fetching a fix when the JavaScript crashes) is left out |
| `checkOnLaunch` `ALWAYS`, `NEVER` | implemented; `WIFI_ONLY` and `ERROR_RECOVERY_ONLY` do not check on launch (the API calls still work) |
| `launchWaitMs` | read, not honored (only 0): the check starts after the first commit, so a launch never waits for the network |
| Code signing (`expo-signature`, `expo-expect-signature`, certificate chains) | left out: no certificate is configured; asset hashes are the integrity check |
| Update URL / request header overrides, `disableAntiBrickingMeasures`, `getExtraParamsAsync`, log entries, state machine events, `useUpdates`, reload screen, SQLite database, bsdiff patches, dev client / launcher | left out: React-host, dev-client or tooling parts with no use here |

### Image assets of an update

A bundle's registered assets carry `fileHashes` (the MD5 of each scaled file, which is the manifest asset `key`). When the process launched a downloaded update, `launch.ts` installs a `resolveAssetSource` transformer (`assets.ts`) that maps the picked scale's hash to `localAssets[key]`. Registered assets the update does not list resolve to the app binary's drawable on Android and to React Native's default on iOS. expo-asset's own resolution is not engaged: it reads a module named `ExpoUpdates`.

### Build configuration

`apps/platform/app.config.ts`:

```ts
const channel = process.env.UPDATES_CHANNEL;           // set per build profile in eas.json
runtimeVersion: { policy: "appVersion" },
updates: {
  url: "https://u.expo.dev/bb048172-896f-48f1-97c0-c9ec765842c0",
  checkAutomatically: channel ? "ON_LOAD" : "NEVER",
  fallbackToCacheTimeout: 0,
  ...(channel ? { requestHeaders: { "expo-channel-name": channel } } : {}),
},
```

`apps/platform/eas.json`: `"channel": "preview"` and `"env": { "UPDATES_CHANNEL": "preview" }` in `preview` (inherited by `preview-store`); `"channel": "production"` and `"UPDATES_CHANNEL": "production"` in `production`. eas-cli configures the channel natively only for projects that have `expo-updates` installed, which this one does not, so the app config carries it; `eas build` warns that the package is missing, which is expected.

### Host integration (the two lines the host owns)

`packages/svelte-native/src/fabric/host.ts`: `import { onFirstCommit } from "../updates/launch.ts";` with the other imports, and `onFirstCommit();` after `console.log(`[Svelte boot] ...`)` in `startSurface`. Importing `launch.ts` is what installs the asset transformer, before the first image resolves; the boot line gains an `updates` phase.

### Device verification (integration lane)

1. `eas build -p android --profile preview` (APK, channel `preview`), install. `adb logcat -s SvelteUpdates ReactNativeJS`: `Launching the embedded bundle (built …)`; the boot line has an `updates` phase.
2. Change visible text, run `pnpm exec svelte-native sync` in `apps/platform` (`expo export` does not run the config plugin that generates `.svelte-native/entry.ts`), then `eas update --branch preview --channel preview --platform android --environment preview --message probe` (SDK ≥ 55 needs `--environment`; see the open item on `expo-updates` below). First start after publishing: log `[Svelte updates] Update <id> downloaded; it launches on the next start`. Kill and start again: `Launching update <id>`, new text visible.
3. Images: publish an update that adds an image asset; it renders from the second start.
4. Failed launch: publish an update whose entry throws before the first commit; the first start with it crashes, the next logs `Update <id> did not reach its first commit` and runs the previous update or the embedded bundle; `adb logcat` shows no further crash. The check request then carries `expo-recent-failed-update-ids` and the update is not fetched again.
5. `eas update:roll-back-to-embedded --branch preview`: the check applies the directive; after the next start the embedded bundle runs, and a later `eas update` launches again.
6. `reloadAsync()` (temporary button in `__dev`): after a download, the app restarts on the new bundle without a process restart; confirm the engine reinstalls (`SvelteEngine.install`) and a surface mounts.
7. Channel: a `production` build must not launch updates published to `preview` (different `requestHeaders`).

### Open items

- `eas update` (eas-cli 18.6) runs `expo install expo-updates` when the package is absent from `dependencies`, and uses its `runtimeversion:resolve` CLI when present. The fix is `expo-updates` as an autolink-excluded tooling `devDependency` (eas-cli then only warns that it is a dev dependency): add `expo-updates` to `headlessExcludedPackages` and to `expo.autolinking.exclude` in the same change, or its own `UpdatesPackage` handler would also answer for the bundle. Not done here: it needs an install and a lockfile change.
- `SvelteUpdatesModule` is not in the lazy module list of `patches/expo-modules-core@57.0.23.patch`, so it registers eagerly (one `definition()` at startup). It has no foreground, view or intent hooks, so it qualifies; adding it needs a patch edit and `pnpm install`.
- Every manifest asset is downloaded (there is no embedded manifest to tell which assets are already in the app binary).
- iOS is written but was not compiled or run here (no Mac, no Swift toolchain on the build host).

## Animated write path

Reanimated's per-frame prop writes for engine views reach `AnimatedProps` as flat typed records instead of `ReadableMap`s. Written by agent R on 26 Oct 2026 (wave 2); compiled, host-checked, not yet run on a device. The map path of "Animation" above stays as the fallback for everything this path does not cover.

### Why

Reanimated 4.5.1's Android synchronous update (`ANDROID_SYNCHRONOUSLY_UPDATE_UI_PROPS`, on in this app) costs, per frame on the UI thread:

1. `ReanimatedModuleProxy::applySynchronousUpdates` splits the frame's updates and `serializeSynchronousPropsToBuffers` writes them as a command stream into two reused `std::vector`s: ints (commands, tags, units, colours), doubles (values). The stream is already flat and typed.
2. `NativeProxy::synchronouslyUpdateUIProps` allocates two Java arrays and copies the stream into them.
3. `NativeProxy.synchronouslyUpdateUIProps` (Kotlin) runs `SynchronousPropsBufferParser.parse`: two `Arrays.stream(..).iterator()`, a `JavaOnlyMap` per view with its `HashMap`, a `JavaOnlyArray` for `transform`, one `JavaOnlyMap` per transform entry, boxed doubles.
4. Our hook reads the maps back with `hasKey` and `getDouble`.

Steps 2 to 4 are the 4.3 MB of Java allocation per 8.6 s that the heap profile of `churn-animated` attributes to Reanimated. The patch takes the stream at step 1 and never builds the arrays or the maps for views it can write itself.

### Data flow

1. Reanimated's UI runtime (the Android main thread) calls `NativeProxy::synchronouslyUpdateUIProps(ints, doubles)`.
2. The patched function reads an atomic sink pointer (`reanimatedSetSynchronousPropsSink`) and, when one is set, calls `AnimatedBridge.cpp: sink(...)` with the two buffers and scratch buffers for what the sink leaves.
3. `animated::split` (AnimatedBridge.h) walks the command stream view by view and folds each view's props into one `ViewUpdate`; a view whose props are all covered is encoded as typed records into a reused staging buffer (`std::vector<int32_t>`, 4096 ints); every other view's span is copied to the scratch buffers untouched.
4. The staging buffer is copied into a Java `IntArray` owned by `AnimatedBridge` (`SetIntArrayRegion`, no allocation) and Kotlin's `AnimatedBridge.flush(count)` is called once for the whole frame (once per 4096 ints when a frame is larger).
5. `flush` looks each tag up (`MountingManager.viewFor`), points a reused `AnimatedProps.TypedWriter` at the view and decodes the records (`AnimatedWire.decodeRecords`, no allocation) into the same setters `AnimatedProps.apply` uses (`Props.setTransform`, `setBackground`, `setRadii`, `Props.setStacking`, alpha).
6. A tag with no engine view (not mounted yet, deleted a moment ago, foreign) is turned into a small `JavaOnlyMap` and given to `MountingManager.applyAnimated`, which keeps its early-write replay, deleted-tag ring and drop warning unchanged.
7. `flush` returns the number of views `applyAnimated` did not take (it returns `true` for every tag today, so none) and writes their ordinals into the array; C++ copies those views back into the scratch buffers.
8. The sink returns the number of ints left. Zero: the patched function returns without a JNI call. Otherwise the leftover views go through the original code: two Java arrays, `SynchronousPropsBufferParser`, `SvelteEngineHook.updater`, React Native.
9. The sink returns "untouched" (`SIZE_MAX`) when nothing was taken, so a frame without engine views costs one atomic load and one scan.
10. Registration: `SvelteEngineModule.installAnimatedHook` calls `AnimatedBridge.install(manager)` (stores the buffer and the manager, finds `reanimatedSetSynchronousPropsSink` in `libreanimated.so` with `dlopen(RTLD_NOLOAD)` + `dlsym`); `reanimatedLoaded` calls `AnimatedBridge.attach()` for the lazy-load case; `OnDestroy` calls `uninstall()`.

### Wire format (AnimatedBridge.h, AnimatedWire.kt)

Int words, floats as raw bits. `[viewCount]`, then per view `tag, recordCount, records...`; a record is `id, payload...` with the ids and payload layouts of `PropsEncoder.cpp`:

| id | prop | payload |
|---|---|---|
| 1 | backgroundColor | ARGB int |
| 2 | opacity | float |
| 3 | borderRadius | topLeft, topRight, bottomRight, bottomLeft (float; Reanimated's `borderRadius` sends one value four times) |
| 6 | transform | tx, ty, sx, sy, rotation (floats) |
| 9 | zIndex, elevation | two floats, NaN = not part of the write |

Lengths are dp here, the committed records carry pixels: Reanimated's values are dp and the Kotlin side owns the density (`AnimatedProps.TypedWriter` multiplies, like the map path). Rotation is degrees. On return from `flush` the first word is the number of rejected views and their ordinals (0-based, within the flush) follow from index 1.

`transform` arrives from Reanimated as a list of operations. C++ folds `translateX`, `translateY` (px), `scale`, `scaleX`, `scaleY`, `rotate`, `rotateZ` and a flat 16-number `matrix` into one 2D affine matrix in the order of React Native's `Transform::operator*` (the first list entry is the outermost, as in CSS: `[{scale: .5}, {translateY: 10}]` moves 5, `[{translateY: 10}, {scale: .5}]` moves 10), and decomposes it like `Props.setTransform` expects: a matrix without rotation or skew keeps the sign of its scales (a mirror stays a mirror), otherwise `sx = hypot(a, b)`, `rotation = atan2(b, a)`, `sy = det / sx`. This is PropsEncoder's decomposition (`hypot` of the matrix rows, `atan2`), with the second scale taken from the determinant so a mirror combined with a rotation survives. The map path accumulated translations ignoring order; this path is exact for any list of those operations.

### What the typed path covers, what falls back

Covered: `opacity`, `transform` (above), `backgroundColor`, `borderRadius` (px, all corners), `zIndex`, `elevation`. A view is typed only when every prop of its update is in that set; one other prop (`borderColor` and the other colour props, `shadowColor`, `outline*`, the per-corner radii, a percentage radius or translation, `rotateX`, `rotateY`, `skewX`, `skewY`, `perspective`, a matrix with z or perspective) sends the whole view, with all its props, through Reanimated's own path, so a view's props are never split across two paths and `AnimatedProps.apply` and React Native see exactly what they saw before. An unreadable or truncated stream is passed through from the broken view on.

Not part of this path by construction, in Reanimated 4.5.1: `width`, `height`, margins and every other layout prop (and `color`, `fontSize`) are not in `partitionUpdates`' synchronous set, they go through a shadow-tree commit (`commitUpdates`) and reach the engine as an `OP_UPDATE_PROPS` / `OP_UPDATE_LAYOUT` of the next mounting batch. A typed path for them would be a different mechanism (Fabric's animation backend, `USE_ANIMATION_BACKEND`, off in this app).

### Early writes, deleted tags, foreign views

A record whose tag has no engine view goes to `MountingManager.applyAnimated(tag, map)`; nothing in `MountingManager` changed. The map carries the same values as the records (`opacity`, `backgroundColor`, `borderRadius`, `zIndex`, `elevation`, `transform` as the operations that reproduce the decomposed values, `rotate` as `"<n>deg"`), so the replay in `createView`, the silent drop of a tag deleted a moment ago and the one-second warning behave exactly as before, with one map allocated per such write (once per new node, not per frame). When `applyAnimated` stops returning `true` for tags it does not own (foreign views mounted by React Native), the typed path hands those views back to Reanimated unchanged (step 7), so the foreign-views work needs no change here.

### Threading

Everything runs on the Android main thread, as Reanimated's UI runtime does; no thread was added. The sink returns "untouched" when called from another thread (`gettid() != getpid()`), so such a call takes the original path. `install`/`uninstall` can run on any thread; the sink and both take one mutex (uncontended on the UI thread).

### Patch (patches/react-native-reanimated@4.5.1.patch)

Added to the existing two hunks (`SvelteEngineHook`, `applySimpleProps`): `NativeProxy.h` declares `SynchronousPropsSink` and two scratch vectors; `NativeProxy.cpp` holds the atomic sink pointer, exports `reanimatedSetSynchronousPropsSink` (default visibility; the library is built `-fvisibility=hidden`) and consults the sink in `synchronouslyUpdateUIProps` before the arrays are created. Each hunk carries a "Rasheed patch:" comment saying why. The patch is regenerated from a pristine copy of the package; `pnpm install --prefer-offline --ignore-scripts` applies it (patch hash in `pnpm-lock.yaml` changed).

### Files

- `android/src/main/cpp/AnimatedBridge.h`: command constants of Reanimated's stream, `ViewUpdate` (folds a view's props), `StreamReader`, `encodeView`, `split`; no JNI, no React Native includes.
- `android/src/main/cpp/AnimatedBridge.cpp`: the sink, the dlsym registration, the JNI natives (`nativeInstall`, `nativeAttach`, `nativeUninstall` of `AnimatedBridge`), the `SvelteEngine.animated.sink` trace slice. `SvelteEngineNative.cpp` includes the header and calls `registerAnimatedBridgeNatives()`; `CMakeLists.txt` globs the source.
- `AnimatedWire.kt`: record ids, `AnimatedWire.Target`, `decodeRecords`; no Android imports.
- `AnimatedBridge.kt`: the `IntArray`, `install`/`attach`/`uninstall`, `flush` (the `SvelteEngine.animated` trace slice), the map writer of the early path.
- `AnimatedProps.kt`: `TypedWriter` (the `AnimatedWire.Target` that writes a view) and per-corner `setRadii`; `apply(view, map)` unchanged.
- `SvelteEngineModule.kt`: `AnimatedBridge.install/attach/uninstall`; the updater lambda is now inside the `SvelteEngine.applyAnimated` trace slice.

### Checks without a device

`android/src/test/run.sh` (needs `g++` and `kotlinc`): `AnimatedWireTest.cpp` feeds Reanimated-shaped command streams (numbers copied from `SynchronousPropsBufferSerializer.cpp`) through `animated::split` under ASan and UBSan (typed encoding, operation order, rotation, mirror, matrix, every declined prop, rejection, truncated and unknown streams, 400 views over two flushes) and writes the buffers it verified to a fixture; `AnimatedWireCheck.kt` decodes the same buffers with the production `AnimatedWire.decodeRecords` and compares the text. Both pass. `:svelte-engine:compileReleaseKotlin` and `:app:assembleRelease` (arm64-v8a, with the patched Reanimated C++) compile the rest.

### Expected effect and how to verify it on the Samsung

Expected: in a steady animated scenario (`animation-48`, `animation-48-translate`, `animation-48-css`) no Java allocation from Reanimated's synchronous path (no `SynchronousPropsBufferParser.parse`, `JavaOnlyMap`, `HashMap.resize`, `JArrayInt`/`JArrayDouble.newArray` samples) and one `SvelteEngine.animated` slice per animated frame instead of one `SvelteEngine.applyAnimated` slice per tile per frame; in `churn-animated` the remaining Java allocation is `createView` plus one early-write map per new node. The 4.3 MB per 8.6 s attributed to Reanimated's map building should go to a small fraction of that; whether dropped frames fall from 4 to 5 % at 90 Hz depends on how much of that was GC and how much is Reanimated's C++ (`partitionUpdates` and the serializer still build `folly::dynamic` and `std::vector` data per frame on the native heap) and the mount work, which this change does not touch.

1. Dropped frames and maximum: `churn-animated`, `animation-48`, `animation-48-css` on the A16, 10 runs each, against the build without this change: dropped % and max frame ms, same lab harness.
2. Allocation count: `heapprofd` on the app during `churn-animated` and `animation-48` (ART heap, 128-byte sampling as in the numbers above): the samples under `NativeProxy.synchronouslyUpdateUIProps` / `SynchronousPropsBufferParser` should be gone, and `AnimatedBridge$MapWriter` appears only in `churn-animated`.
3. Trace slices (Perfetto, app tag): `SvelteEngine.animated` (Kotlin flush, once per frame) and `SvelteEngine.animated.sink` (C++ split plus the JNI call) per frame, `SvelteEngine.applyAnimated` (the fallback updater) absent in those scenarios; `SvelteEngine.animated.sink` per frame is the engine's whole share of an animated frame (C++ split plus the JNI call plus the Kotlin `SvelteEngine.animated` slice inside it).
4. Logcat: `typed animated path registered with Reanimated` (at install when Reanimated is imported at start, else `waiting for Reanimated` at install and the registered line again after `reanimatedLoaded`), then `typed animated path wrote its first frame: N views, M taken` at the first animated frame; `typed animated buffer carries an unknown record id`, `typed animated flush failed` and `the Reanimated patch is missing` must never appear; `W SvelteEngine: animated write for tag N, no view was mounted for it` stays 0 as in wave 1.
5. Visual: the lab's animation scenarios and a screenshot diff of `animation-48` against the previous build (opacity, translate, scale, rotation and border radius written by this path land on the same pixels as the map path for the single-purpose transforms the map path was exact for).

### Limits

- `AnimatedBridge.install` runs on the thread of the Expo `install` call (the JS thread); a `reanimatedLoaded` that arrives before `libreanimated.so` is loaded would leave the typed path off until the next install (logged: `typed animated path not available`); the fallback is the previous path.
- Percentage translations and radii, per-corner radii, `rotateX/Y`, skew, perspective and the colour props other than `backgroundColor` keep the old behaviour, including its gaps (the map path ignores most of them).
- The C++ half of the cost (serializer, `partitionUpdates`' `folly::dynamic` copies) is Reanimated's and untouched.

## Native screens, Android

The engine side of "Screen API contract (header, sheet, tabs)": views `EngineHeader`, `EngineHeaderSlot`, `EngineSheet`, `EngineTabs`, `EngineTab`, `EngineTabIcon`, `EngineToolbar`, `EngineToolbarItem`, changes in `EngineStack` and `EngineScreen`, the record decoder and encoder for ids 120 to 129, the router integration. Nothing about the contract's API, nativeID grammar or record layout changed; what the contract left open is decided under "Decisions". Device verification is open, see "Not verified".

### What is where

| file | role |
|---|---|
| `cpp/PropsEncoderNavRecords.h` | the grammar and the records, standard library only (percent decoding, lists, colors, `Writer<Sink>`, `encodeRecords`); the host check includes it |
| `cpp/PropsEncoderNav.{h,cpp}` | `kindForView` (kinds 10 to 18 from the nativeID kind token), `encodeNavProps`, the `NavEvents` natives (including `press`) |
| `PropsNav.kt` | `NavProps` (one field group per record, a `*Seen` flag each), `PropsNav.decode` (110 to 139; the toolbar's 128 and 129), `NavEvents` |
| `views/EngineScreen.kt` | `EngineScreen` (open), `SystemBarsSpec`, `SafeArea`, `SystemBars` |
| `views/EngineStack.kt` | sheets, scrim, appearance events, accessibility hiding, back callback activity, dismissal path |
| `views/EngineSheet.kt` | `EngineSheet : EngineScreen` for presentation 3 and 4 |
| `views/EngineHeader.kt` | `EngineHeader`, `EngineHeaderSlot` and the chrome views |
| `views/EngineTabs.kt` | `EngineTabs`, `EngineTab`, `EngineTabIcon`, the bar and its items, `BadgeDrawer` (the badge of a tab item and of a toolbar item) |
| `views/EngineToolbar.kt` | `EngineToolbar` (the band and the row layout), `EngineToolbarItem` (the control: icon, label, badge, ripple, press, accessibility) |
| `MountingManager.kt`, `Props.kt` | creation by kind (`KIND_*` 12 to 18; the foreign frame is 19; a screen with presentation >= 3 is an `EngineSheet`), the `when` of `applyProps`, cases in `applyLayout` (tab panes, header slots and the toolbar keep `display: none` to their owner, as screens do; a toolbar item's snippet child is re-placed after Yoga's frame is applied), the dispatch line `in 110..139` |
| `packages/svelte-native/src/router.svelte.ts`, `Router.svelte`, `index.ts`, `elements.d.ts`, `fabric/navigation.ts` | JavaScript side, below |
| `packages/svelte-native/tests/navigation-native.test.ts`, `tests/native/*` | the host check of the C++ encoder and the Kotlin decoder against `decodeRecords` |

Kinds map to Kotlin views as: 12 `EngineHeader`, 13 `EngineHeaderSlot` (also the toolbar's center, slot 4), 14 `EngineTabs`, 15 `EngineTab`, 16 `EngineTabIcon`, 17 `EngineToolbar`, 18 `EngineToolbarItem` (`EngineForeign` is kind 19); kind 11 is an `EngineSheet` when record 110 says sheet or formSheet at creation (presentation never changes after mount), else an `EngineScreen`. None of them is pooled (`ViewPool` pools exact classes only). Children of header slots, tab panes and screens are ordinary pooled views.

### Events sent

| event | from | when |
|---|---|---|
| `topAppear`, `topDisappear` | `EngineStack.syncAppearance` | per the contract's visibility rule; every event of a stack waits until none of its screens is in a transition, so at the end of one the new top screen appears first, then the leaving screen disappears, then `topDismissed` (sent after `syncAppearance` in the dismissal path). A screen in a tab that is not selected, or under a screen another stack put above its own screen, is not shown; a tab switch and a change in front cascade to the stacks below (`syncWithin`) |
| `topDismissed` | `EngineStack.dismissTop` | after the exit transition of a user dismissal: back key, header back button, predictive back, edge swipe, sheet drag, scrim tap |
| `topDetentChange {index, fraction}` | `EngineSheet` | a drag settled on another detent; `index` into the detents as given, `fraction` visible height over available height |
| `topMetrics {height, inset}` | `EngineHeader`, `EngineTabs`, `EngineToolbar` | after layout, once per change, only after the window has reported its insets (so a missing report never shrinks the header) |
| `topChange`, `topSubmitEditing` | the search `EngineInput` | the field's node tag is the search slot's tag, so `ViewEvents.input` reaches that emitter: `{ text, eventCount }`, `{ text }` |
| `topCancel` | `EngineHeader` | the search was closed by its icon or the back key |
| `topSelect {key, index}` | `EngineTabs` | a press on an enabled item, also on the selected one |
| `topPress {key, index}` | `EngineToolbar` | a press on an enabled item (the tag is the toolbar's; `index` counts item nodes, spacers included) |

### Header

`EngineHeader` is the screen's first child, `zIndex: 1` when it overlays (set by the encoder), so it draws and takes touches above the content view. Its Yoga frame is `inset + 56 dp (+ 56 dp for large)`. It draws, in `onDraw`/`dispatchDraw`: the background (`bg`, else the surface of the system theme, nothing when translucent), the divider (1 px, `outlineVariant`) and, as child views, the title view, the large title view, the back button, the search icon and the search field. Colors without a `tc` come from the system theme (light or dark by `uiMode`).

- Inset: `SafeArea.top` (system bars and cutout of the window, less the overlay's own gap, less the header's offset from the overlay's top), read once per layout pass; Yoga's padding until the window reports. `onMetrics` reports `inset + 56 (+56)` in dp.
- Slots: Yoga sizes them, `EngineHeader` places them (slot `onLayout` asks for a layout when the mounting layer put one at its Yoga frame): left at the start edge, right at the end edge (before the search icon), center after the left slot, all vertically centered in the 56 dp bar row, mirrored in right-to-left. The search results slot keeps its Yoga frame (below the header) and is visible only while the search is active. The title area is the bar row between what is at its start (back button 48 dp + 8, or the left slot + 8, else 16 dp) and at its end (right slot + 8, search icon 48 dp, else 16 dp).
- Title: `TextLayouts` layouts (one line, tail ellipsis, `fontScale` clamped to 1.3 so the bar keeps 56 dp): title 22 sp (17 sp with a subtitle), subtitle 12 sp at 70 % alpha, large title 28 sp at the bottom of the large row; a subtitle alone is drawn as the title; none is drawn with a center slot. The accessibility heading is the title that shows: the large title view while the collapse is under its half, the inline title view after (exactly one of them is important for accessibility; the inline one is at alpha 0 until the collapse starts, and a service skips a view at alpha 0).
- Large title: the first `EngineScroll` of the screen outside the header gets `paddingTop = header height`, `clipToPadding = false` (JavaScript's offset 0 is the rest position; the content scrolls under the bar), a scroll listener and an attach listener; it is looked for before the next draw after each layout pass of the screen (`EngineScreen.onLayout` calls `queueAdopt`, which adds a one-shot pre-draw listener; a changed padding cancels that draw and lays out again, so the scroll view is inset in the first frame it shows in) and released (padding back to 0) when the header stops being large or translucent, the scroll view detaches, or the header detaches. `collapse = min(scrollY, 56 dp)`: the background and divider end `collapse` higher, the large title translates up by it and fades out while the inline title fades in. A translucent header insets the same scroll view without collapsing. Divider: shown once `scrollY > 0`, and always when no scroll view was adopted.
- Back arrow: a 24 dp Material arrow in a 48 dp wide, bar high target, mirrored for right-to-left, "Navigate up" or `backTitle`. A tap calls `onBackPressedDispatcher.onBackPressed()`: the same path as the key, so the stack's callback pops with its exit transition and `onDismissed`, or `BackHandler` answers when `nativeBackButtonDismissalEnabled` is false.
- Search: the icon (48 dp target) turns into a close icon and the field (`EngineInput`, 16 sp, search action, `blurAndSubmit`) takes the title area; the title views hide, the results slot shows, an `OnBackPressedCallback` (newer than the stack's, so it runs first) closes the search. Closing clears the field without a change event and sends `topCancel`. `v` applies with `maybeSetText(v, ec)`: only when no newer native edit is pending.
- Accessibility order: back, left slot, title (or center slot), the search field while it is open, right slot, search icon, the search results (`EngineHeader.readingOrder`, the order of `addChildrenForAccessibility` and of the `accessibilityTraversalBefore` chain). The content follows: `EngineScreen.addChildrenForAccessibility` puts everything of the header before everything else and leaves the rest in the framework's order (by bounds). It is not left to geometry because an overlay header (`large`, `translucent`) and the content view share a top-left corner and the framework puts the taller one first.

### Sheet

`EngineSheet` keeps the Yoga box (bottom anchored, as tall as the tallest fractional detent) and moves it with `translationY`; `restY` is `box height - visible height of the current detent`, and the stack animates to that instead of 0. `available = stack height - stack's top inset`; a fraction is `round(f * available)` of visible height, `auto` is the box's own height; at most the box. Detents are resolved to offsets and de-duplicated, sorted top-most first. A toolbar in a sheet: the band is the bottom of the Yoga box, which at a lower detent is below the visible part, so `EngineSheet.syncToolbar` sets the band's `translationY` to minus the sheet's (its bottom edge is the sheet's visible bottom): at the sheet's rest, following the detent as it settles, following a drag between the top and the lowest detent (below the lowest the whole sheet moves, bar included; above the top nothing moves it), and held at the rest, or where it last was, while the stack enters or exits the sheet. It runs from `setTranslationY`, from the pre-draw pass (the stack's animator bypasses the setter) and from the band's layout; the band stays a child of the sheet, so it keeps the sheet's layer, hit test and accessibility bounds, and its layout, hence its bottom inset, stays Yoga's.

- Corners: top 28 dp (`outlineProvider` and `clipToOutline`, the bottom corners pushed out of the box), grabber 32 x 4 dp at 8 dp when `gr` says so.
- Scrim: a black view in the stack directly under the sheet (`insertScreen` adds it first, `detach` removes it), 32 % at the lowest detent, alpha from the sheet's position in a pre-draw listener, so it follows the stack's slide, a drag and the exit. A tap dismisses when dismissible; with `bd=1` there is no scrim and `EngineStack.refresh` keeps the screens below touchable (down to the first screen that blocks them).
- Drag: `onInterceptTouchEvent` takes a vertical drag (past the touch slop, mostly vertical) unless a scroll view under the finger can still move that way: downward, the sheet takes it when that scroll view is at its top; upward, the sheet takes it until it is at its top detent. It ignores touches while the stack runs a transition on it. Positions are screen coordinates (`rawY`) because the view moves under the finger; the release velocity comes from the last 100 ms. Above the top detent the drag has 20 % resistance.
- Release: a fling over 1000 dp/s goes to the next detent in its direction; a downward fling from the lowest, or a release more than a quarter of the lowest visible height below it, dismisses when `dm` allows (else it settles on the lowest); otherwise the nearest detent. Settling is 220 ms decelerating; reaching another detent than the one reported sends `topDetentChange`.
- Back: enabled while the sheet is top; dismissible sheets dismiss through the stack, a non-dismissible one takes the key and does nothing. Predictive back moves the sheet down by up to a quarter of its height.
- New detents (`apply` with other record 122 values, e.g. a page's own `<Screen sheet>` after its lazy module arrived) return to the initial detent unless the user is dragging; a layout change or the end of the enter transition re-rests at the current detent.
- `formSheet` is the same view with one detent (the box itself), no grabber unless asked for.

### Tabs

`EngineTabs` holds the panes (`EngineTab`, children at their Yoga frames) and one extra child, the bar (a `ViewGroup` added at construction, so Fabric's insert indexes, which count panes only, always land before it). The bar is `64 dp + bottom inset` high, drawn over the bottom of the node: background (`bg`, else a surface container color), a hairline on top, one `TabItemView` per pane in a row (mirrored in right-to-left).

- Item: a 56 x 32 dp indicator (tint at 16 %) behind the selected icon, the 24 dp icon, the 12 sp label (600 when selected, 500 otherwise, hidden by `lb=1`, then the icon is centered), the badge (dot 8 dp or a pill with text, top end of the icon, red). Colors: `tc` or on-surface for the selected tab, `uc` or on-surface-variant for the others; a disabled item is 38 % and takes no presses. Icons: `ic`/`is` through `ImageLoader` (`asset:/`, `file://`, `data:`, https, `res:/` or a drawable name), tinted with `SRC_IN`; or the live `EngineTabIcon` of the pane, drawn into a layer in the tint (the pane keeps it at alpha 0, no touches, out of accessibility), redrawn whenever the bar draws.
- Selection: `sel` from JavaScript applies when `sel` or `sc` differs from the last record; a press applies at once, sends `topSelect` and leaves the verdict to JavaScript. Only the selected pane is `VISIBLE`, the others `INVISIBLE` (laid out, mounted, no touch, `no-hide-descendants`), Yoga `display: none` is `GONE`. The `accessibilityLabel` and `testID` of a `native-tab` label its item, not its pane (`EngineTab.apply` moves them).
- Accessibility: the bar is a `TabWidget` collection, each item a button with role description "tab", `selected`, `enabled`, its position in the collection, its label (title, and ", new items" for a dot or ", <text>" for a badge, unless `accessibilityLabel` is given).
- Bottom inset: `SafeArea.bottom` of the tabs view, so tabs embedded away from the screen's bottom get none; reported with the bar height by `topMetrics`.
- A selection change re-evaluates the back callbacks, the appearance events and the system bars of every stack below.

### Stack, screens, system bars

- Presentations: `transitionKind` gives the slide from the bottom to modal, sheet and formSheet, fade to transparentModal. A sheet or formSheet never covers the screen below for visibility or `onDisappear`; a push or modal does.
- Back callback: a stack answers the key only when `isActive()`: every ancestor tab is the selected one and every ancestor screen is the top screen of its stack. `EngineStack.refreshBackCallbacks()` runs over the stacks in the window whenever a top screen or a tab selection changes. A stack inside a tab that is not selected, or under a modal of the root stack, does not take the key.
- Accessibility: a screen below a modal, transparentModal, sheet (with scrim) or formSheet is `no-hide-descendants`, restored when it is front again. A sheet's scrim (`EngineSheet.scrim`) is `IMPORTANT_FOR_ACCESSIBILITY_NO`: it is a dismiss surface, and the back key and the sheet's own controls remain, so a service has no full-screen, unlabeled button to stop on. uiautomator's plain dump still lists it (it asks for the not-important views); the accessibility suite reads the `--compressed` dump, which is the tree a service walks. iOS gives the backdrop no accessibility element a VoiceOver user reaches (the iPhone dumps of the three sheet screens list the sheet's own elements only, and the presentation container's `accessibilityViewIsModal` ignores the siblings of the presented view), so there is no label to mirror on the scrim.
- System bars (record 125): `SystemBars` searches the visible screens (each stack's top screen, the selected pane of tabs, deepest wins), once per frame after a push, pop, tab switch or option change, and applies status style, hidden and navigation bar color/style to the activity's window with `WindowInsetsControllerCompat`; with no option set anywhere it restores the window's own (a window never touched is never touched).

### JavaScript

- `createRouter(tree, initial, { scope, active })`: the outermost router is `"root"`, a nested one has the scope it is given (none otherwise); each links to the router above it in the component context, `useRouter(scope)` walks up to the named one and throws when none is. `router.scope` and `router.active()` are public. The back key is registered by the outermost router's `<Router>` alone and goes to the innermost active router below it. Links (`Linking` url events and the initial URL, read once per router) open only in the outermost router (`router.nested` is false) while it is active: a tab router whose routes match the URL (`/[tab]/[depth]` matched any two-segment path) used to push it onto its own stack as well.
- Hot reload: the root router keeps `hmrState().navigation`/`restore` (the whole tree's state, see "Route tree"). A hand-made named router registers a snapshot function in `hmrState().scopes`; when the root adopts a recorded state it also collects every registered scope's state into `scopeRestore`, and each named router takes its own the first time it is created (a tab pane mounts on first selection).
- `Router` renders `<Screen presentation canGoBack={index > 0} onDismiss>` per entry and resets the screen context, so a page's own `<Screen>` merges into it and a router inside a tab pane or a sheet gets real screens. `presentation` is fixed when the screen mounts and the page's own `<Screen>` arrives after its lazy module, so it comes from `goto(href, { presentation })` or `PageRoute.presentation` (the five values, read by `build.ts` from a page's `export const presentation`).
- `index.ts` exports `Screen`, `Tabs`, `useHeader` and the types of `fabric/navigation.ts` (`ScreenOptions`, `HeaderOptions`, `SheetOptions`, `TabItem`, `TabHandle`, ...). `useHeader` and the tab types now live in `fabric/navigation.ts` (a plain module can be re-exported under `tsc`, a component's module script cannot); `Screen.svelte` re-exports `useHeader`.

### Decisions where the contract was silent

- Slot placement and the title area, above. The contract says Android places slots at their Yoga frames; a large header's tall Yoga row would center them across both rows and a lone right slot would sit at the start, so only the sizes are taken from Yoga.
- `native-tab-icon` is `position: absolute` (top/left 0) in the encoder: in flow it pushed the pane's content down by 24 dp. `native-header` has `zIndex: 1` when it overlays, for the draw and hit order. (`navigation.ts`, both with test updates.)
- `auto` detent: the box's own height, at most the available height; with fractions beside it the box is at least the tallest fraction, so `auto` is then the tallest detent. Use `auto` alone, or with fractions only to document the intent.
- After the first device smoke (Samsung A16), fixed: (1) default-weight text wrapped when its box was exactly its measured width (header slots are the first shrink-wrapped default text): React Native sets subpixel and linear text only through the font span it adds for a fragment with a weight, style or family, so it measures plain text with the hinted paint, while `TextLayouts` always used the linear one and got wider advances. Record 21's weight is now 0 when unset (`PropsEncoder.cpp`) and `Fragment.styled` decides the paint flags (`TextLayouts.kt`). An explicit `fontStyle: "normal"` alone cannot be told from none and is treated as unset. (2) The sheet's scrim was never sized (it is not a Fabric node and `Frames` skips it): `EngineStack` now measures and lays out the scrims over the whole stack. (3) A link was pushed onto every matching tab stack (above). (4) The accessibility tree of a header lists its children in reading order (`addChildrenForAccessibility`), not in the order the views were added.
- Moving screens are composited from hardware layers (`EngineScreen.holdLayer`/`releaseLayer`, counted): `EngineStack.animate` holds one for every transition animation (push, pop, dismissal, restore, the settle after predictive back or an edge swipe), the predictive-back and edge-swipe progress paths hold one from the start of the gesture until the animation that takes over has its own, and `EngineSheet` holds one for a drag and for each settle. A hold is taken before the animation it replaces is cancelled, so the layer is handed over, and every end or cancel releases it, so no layer stays on a screen at rest and later text or content changes draw normally. The layer is not pre-built (`withLayer()` calls `buildLayer`, which blocks the main thread on the RenderThread). The scrim is a view whose `hasOverlappingRendering` is false, so its alpha is a plain draw and never an offscreen layer. Besides the transitions, the settled top screen above the stack's first keeps a layer between them (`EngineScreen.setResident`, from `EngineStack.updateResident` at the end of `refresh`, only once no screen is moving and no gesture is in progress; released when it is covered, leaves, or becomes the only screen): the Mali driver's first use of a fresh full-screen framebuffer cost 6–18 ms of RenderThread time on every transition (the `flush layers` section of the first frame), and with the layer handed from the resident hold to the transition's hold (the transition's hold is released after its `done` callback) a pop's first frame no longer builds one. A screen revealed by a pop builds its layer on the quiet frame after the transition. Measured on the A16 (26 Oct): `flush layers` 0.2–0.9 ms on every transition, pops free of long frames; the remaining long frame of `navigation-8` is the push mount of its 60-row screen. A layer is only free while its content stands still: every invalidation under the screen (an animated tile, a scrolling list, a keystroke) makes the renderer draw the screen into the layer again before compositing it (churn-animated: a layer flush on every frame, 0.5–14 ms each). So the resident hold lets go on the first `onDescendantInvalidated` (API 26+; older devices never hold a resident layer) and is not taken again until the next settle; the handover at settle is unchanged. A timed retake (300 ms after the last invalidation) was tried first and removed the same day: it rebuilt the full-screen layer on a frame nobody asked for after every scroll stop or content change (20–35 ms for a 300-row list, list-300 1.8–2.3 % dropped). Verified with log lines on the A16: released by the first tile write of a churn, 300,000 invalidations counted with the layer off; a pop after content changed pays the first-frame build as before wave 2d.
- Header cost on the mount path: the title, subtitle and large title layouts are rebuilt only when the text, its color, the width, the direction or the theme changed (they used to be rebuilt, with their allocations, on every layout pass), and the large title only for a large header. The header no longer calls `requestApplyInsets()` when it attaches (and neither do tabs): that made the window dispatch insets to every view of the tree on every push; the inset is read from the root insets directly, and `onApplyWindowInsets` only asks for a layout when the inset it reads has changed.
- Search closes by clearing the field natively; a controlled `value` that the app does not clear comes back on the next open.
- The header search results are not shifted for a collapsed large title while searching: the large title is hidden and the header stays expanded.
- `onMetrics` is only sent once insets are known, and the header's inset is read per layout pass; tabs report their bar the same way.
- Tests that cover the engine here run the C++ encoder and the Kotlin decoder on the host against `decodeRecords` (`tests/navigation-native.test.ts`: `g++`, `kotlinc` and `java` on the path, compiled once per source hash into the temp directory).

### Not verified (no device was available)

Everything that draws or moves. For the integration lane, each on the emulator and on a phone: push and pop with a header, the arrow tap and the key (same exit transition, one `onDismissed`), predictive back with a header (header and content move together), the edge swipe with a header; large title collapse and expand while scrolling, translucent header over content, divider; slots at both ends and the center, with and without back, large, and in right-to-left (arrow mirrored, slots and title swapped, tab bar order mirrored); search open, typing (`topChange` count), submit, close by icon and key; a sheet's enter, both detents, drag between them with and without a scroll view inside it, fling, dismiss by drag, scrim and key, non-dismissible, `bd=1` (touches reach the screen below), auto, formSheet, detents changing after the lazy page arrives; tabs: icons from assets and snippets, badges (dot, number, 99+, text), switching by press and by `selected`, the ignored `onSelect` putting the bar back, a pane's own stack with push and pop, the back key in a tab (pops the tab's stack, at its root leaves the app), a root modal above tabs taking the key, appearance events on tab switch; system bar colors per screen and their restore; TalkBack: heading first, then arrow, actions, search, content; tabs announced as "tab 2 of 3" with badges; focus staying inside a modal or sheet; large font scale; the lab scenarios `header-8`, `sheet-8`, `tabs-8` at 0.0 % dropped on the emulator and the phone.

## Native screens, iOS

Status: written without a Mac, brought up on the iPhone SE 3 (iOS 26.6, 60 Hz) in the integration lane (26 Oct, `tools/ios_wave2.sh`), and reworked and checked on the device in iOS wave 4 (27 Oct, branch `feat/svelte-native-ios`). Wave 4 changed how the stack applies a transaction and how a screen leaves ("Stack and screens", "Where the time goes"), fixed the defects the device showed (a full screen modal could not be dismissed by JavaScript, the sheets' detents, the search field's and its results' place, the slots' place, VoiceOver reaching the screen under a sheet), added VoiceOver's escape, and put the iPhone into the harness: the lab, boot, parity and accessibility suites and device probes run with `native-qa ... --platform ios` (`apps/platform/qa/README.md`, "iOS"). On the iPhone SE 3 the lab passes 28/28 and, in five launches each of the final build against five of the build before wave 4 (`fc1c3141a`), navigation-8 went 1.52 -> 0.00 % dropped (max 32 -> 25 ms), sheet-8 1.16 -> 0.00 % (max 33 -> 19), tabs-8 stays 0.0 %, and header-8 went 2.60 -> 3.54 % (max 35 -> 39): UIKit's navigation bar sets the floor of that one ("Where the time goes"). The pure parts (the `nativeID` reader, the stack planner, the detent arithmetic) are built and tested on Linux against the reference decoder; the Fabric C++ (shadow nodes, descriptors, state) was instantiated against the React Native 0.86.3 headers; the Objective-C++ builds in Xcode with 0 errors and 0 warnings. It implements "What iOS must do (NI)" of the Screen API contract; the JavaScript API, the `nativeID` grammar, the records and the events are that contract's, plus `topExited` ("Screen exit").

### Module and build

`apps/platform/modules/svelte-screens-ios/`: `expo-module.config.json` (platform `ios`, no Swift modules) and `native/`. Two Swift Expo modules sit beside it: `modules/svelte-insets-ios/` (`SvelteInsets`, safe-area and keyboard insets: "Insets and keyboard on iOS") and `modules/svelte-qa-ios/` (`SvelteQA`, the QA tooling of "In-app QA"; it refuses to run outside the QA bundle). React Native iOS is consumed as a prebuilt XCFramework (`React-Core-prebuilt`): a patch to React Native's Objective-C++ has no effect on this build (one, a cache for border images, was tried and removed), so whatever has to change in its views is done in the host (`fabric/host.ts`) or in the components. The sources are in `native/`, not `ios/`: `.gitignore` ignores every `ios/` directory and `tools/ios_cutover.sh` excludes `*/ios/` from its rsync; rename the directory (and the glob in the podspec) only together with those two. Expo's autolinking finds the module in `modules/` (as the engine's) and the podspec in a subdirectory of it; the pod is `SvelteScreensIOS` (not in `expo.autolinking.exclude`), iOS 16.4 (ExpoModulesCore's minimum; custom sheet detents need 16), `install_modules_dependencies` for React-Core, React-RCTFabric, React-Fabric and folly. There is no codegen: Expo does not run React Native's codegen for local modules, so the components are `ViewProps`-derived with hand-written shadow nodes (`Fabric/SvelteComponents.{h,cpp}`), and everything beyond view props arrives in `nativeID`. Each view class registers itself in `+load` with `RCTComponentViewFactory` and answers `+shouldBeRecycled` with NO (a controller hosts the view for as long as it lives); the static pod relies on CocoaPods' `-ObjC` to keep the classes.

| tag (`viewNames` on iOS) | Fabric component | view class | UIKit it wraps |
|---|---|---|---|
| `native-stack` | `SvelteStack` | `SvelteStackView` | `UINavigationController` (subclass `SvelteNavigationController`), a child controller of the nearest view controller above the view, its view a subview |
| `native-screen` | `SvelteScreen` | `SvelteScreenView` + `SvelteScreenController` | `UIViewController` whose view is the screen's component view; a `UINavigationController` around it when a modal has a header |
| `native-header` | `SvelteHeader` | `SvelteHeaderView` | `UINavigationItem` of the screen's controller, `UINavigationBarAppearance`, `UISearchController` |
| `native-header-left`, `-center`, `-right`, `-search` | `SvelteHeaderSlot` | `SvelteHeaderSlotView` | `UIBarButtonItem(customView:)`, `titleView`, the results controller of the search |
| `native-tabs` | `SvelteTabs` | `SvelteTabsView` | `UITabBarController` |
| `native-tab` | `SvelteTab` | `SvelteTabView` | a child controller (the pane is a subview of its view) and its `UITabBarItem` |
| `native-toolbar` | `SvelteToolbar` | `SvelteToolbarView` | `toolbarItems` of the screen's controller; the stack's `UIToolbar` and its `UIToolbarAppearance` |
| `native-toolbar-item` | `SvelteToolbarItem` | `SvelteToolbarItemView` | one `UIBarButtonItem`: a flexible space, an image or a title, or a `SvelteToolbarButton` control as its custom view |
| `native-toolbar-center` | `SvelteToolbarCenter` | `SvelteToolbarCenterView` | `UIBarButtonItem(customView:)` |
| `native-tab-icon` | `RCTView` (unchanged) | none | drawn into the item's image |

Files: `native/Core/SvelteNativeID.{h,cpp}` (reader of the grammar, no Foundation), `Core/SvelteScreensCore.h` (stack planner, detent height), `Fabric/SvelteComponents.{h,cpp}`, `Views/Svelte{Support,ScreenView,StackView,HeaderView,TabsView,ToolbarView}.{h,mm}` (`ToolbarView` holds the three toolbar views and the control of an item), `SvelteScreensIOS.podspec`. JavaScript: `src/fabric/navigation.ios.ts` re-exports the shared encoders and decoder unchanged and holds the component names and the registration of their view configs (the host calls `iosNavigationViewName` from the `viewNames` entries); the entries of the other platforms are unchanged.

### Stack and screens

- The JavaScript stack is the truth, as in react-native-screens' `RNSScreenStackView`. Screens are children of the stack in Fabric but not subviews: UIKit puts their views where it needs them. The stack applies what a mounting transaction changed in steps, each on a frame of its own (`SvelteAfterNextFrame`, a one-shot `CADisplayLink`; at 60 Hz a main-thread block of more than about 15 ms costs a frame, so a step is kept to one block): (1) the transaction's frame, in which React Native mounts the views; (2) the next frame's start, `flush`: first each screen whose props or children changed (`update`: navigation item, bar, scroll view, sheet), then `planStack(current, desired)` (`Core/SvelteScreensCore.h`), where a push or a pop only attaches the view of the screen that will be shown (the new top, the screen revealed) to the navigation controller's own view out of sight (`stage:`; its subtree gets its window, traits, layout and first drawing there) and a presented screen's view is attached the same way (`_stagedPresented`); (3) the frame after: the new top is pushed, a top that left is popped, anything else is `setViewControllers` without animation (and `install` skips one that changes nothing), a presented screen is presented. A change during a running transition waits for its end. The first live screen is the root whatever its presentation; `activityState` 0 leaves the stack.
- A screen that leaves keeps its view: JavaScript holds it mounted at `activityState` 0 until the stack has sent `topExited` ("Screen exit"), so the pop or the dismissal moves the screen itself and not a picture of it, and the unmount of its subtree (7 to 10 ms for a 60-row screen) lands in a frame where nothing moves. Only a screen JavaScript removes outright while it is on screen (its whole stack goes with a parent) is replaced by a snapshot of its view (`replaceViewWithSnapshot`) so that UIKit has something to move. `stackAnimation: none` skips the animation of a push, pop, present or dismiss; `fade` is a cross dissolve for modals; the other values use UIKit's default (custom push animators are not implemented).
- A full screen modal (`presentation: "modal"`) takes the stack's view out of the window while it covers it. `flush` still applies the modals then (a `back` or a reset from JavaScript dismisses it) and leaves the pushed screens to `didMoveToWindow`. Until 27 Oct it returned without a window, so JavaScript could not dismiss such a modal at all (the lab's `modal-8` drives React Native's `Modal`, which does not go through here); found with the `reset-modal` and `back-modal` probes.
- User dismissal: a back swipe or the back button leaves `viewDidDisappear` with no parent; if JavaScript still holds the screen, the stack marks it (and every held screen UIKit took out) as user-dismissed and sends `topDismissed { dismissCount }` for the lowest of them; a swipe on a modal or sheet comes from `presentationControllerDidDismiss`. A removal JavaScript asked for sends nothing. A marked screen is left out of the next update until JavaScript removes it.
- Lifecycle: `topAppear` and `topDisappear` follow `viewDidAppear` and `viewDidDisappear` but only on a change of visibility (a cancelled back swipe sends nothing), and are sent in the order the contract asks: the new top's `appear`, the leaving screen's `disappear`, then `dismissed` (`SvelteScheduleLifecycle` sorts one transition's events in the next run-loop turn, because UIKit's order differs). A full-screen modal covers its presenter (UIKit sends the presenter its disappear); a transparent modal, sheet or form sheet does not.
- Gestures: the edge swipe is `interactivePopGestureRecognizer` with the stack as delegate (so it works without a visible bar); it begins when the stack has two screens, no transition runs, and the top screen has `g != 0` and `b != 0`. iOS 26's full-screen content swipe is disabled (not in the contract). `b=0` does not stop the back button.
- Size: a screen in a navigation controller is laid out by UIKit (the screen view ignores Yoga's frame once its controller has a parent or a presenter); `extendedLayoutIncludesOpaqueBars` keeps its view under the bar, so Yoga's header band is drawn over. A presented screen (modal, sheet) may get another size than Yoga computed: it reports the size UIKit gave it through the shadow state (`SvelteScreenState`, `unstable_Immediate`, from `viewDidLayoutSubviews`), and the descriptor lays the shadow node out at that size, as react-native-screens does. A sheet with an `auto` detent is not reported: Yoga measures its content.

### Where the time goes (iPhone SE 3, Time Profiler, 60 Hz)

Measured with `xctrace` attached to the lab app (`navigation-8`, `header-8`, `sheet-8`; the profiler slows the main thread, so the durations below are about 1.5 times the unprofiled ones; the lab's dropped-frame figures are unprofiled, five launches each). What a push and a pop cost, and what changed it:

| what | before wave 4 | after | how it was found |
|---|---|---|---|
| bordered views (a card, a field, a button) | React Native draws the border of a view that does not clip as an image, one `UIGraphicsImageRenderer` pass per view (`RCTGetBorderImage`, about 0.2 ms each) and again whenever the traits change: 9 to 11 ms of the 13 to 16 ms mount of a 60-row screen | `overflow: "hidden"` makes it a Core Animation border (the fast path of `RCTViewComponentView`); the app's `Button`, `Field`, rows and tab pages say so | the `border:` category of the profile; the lab's `?rv=plain`, `?rv=image` and `?rv=clip` row variants |
| a pop | the screen is unmounted in the transaction that starts the pop (a 13 ms run, 8 to 10 ms of it unmount), the pop starts in a run of 11 ms | the screen stays mounted; the revealed screen is staged (10 ms), the pop starts (16 ms), the unmount comes after the transition (7 ms) | the timeline of main-thread runs |
| the navigation bar (header-8 only) | `UINavigationBar` re-lays out its items for every push and pop: a run of 30 ms (20 to 23 ms of it `layoutSubviews`) per operation, with a title, a subtitle and a custom bell item | unchanged: it is UIKit's, and it is the floor | the lab's `?hv=plain` (no header) 0.00 % dropped, `?hv=title` 2.5 to 2.8 %, the full header 3.5 to 3.8 % |

Before wave 4 -> final build, five launches each, % dropped / max ms: navigation-8 1.52 / 32 -> 0.00 / 25; sheet-8 1.16 / 33 -> 0.00 / 19; header-8 2.60 / 35 -> 3.54 / 39. Tried and without effect, listed so that they are not run again: caching the border image in React Native (the framework is prebuilt, the patch never ran), stripping the leaving screen's header at the start of a pop (header-8 unchanged), the host's accessibility defaults (`accessible` on text and pressables: header-8 3.50 against 3.48 without them), the live insets (3.45), pushing a screen with a header in the same run as its mount (3.66 against 3.50). Not retaining the leaving screen gives 3.05, so retention costs about 0.4 point of header-8 and buys a real view that moves out with its own title and no snapshot; the rest of the 0.9 point header-8 lost is the extra frame hop. A bar that costs 30 ms per operation makes every push and pop one dropped interval whatever is split around it.

Integration (27 Oct, `feat/svelte-native-next`, five launches each, % dropped): navigation-8 went from 0.1 to 0.8 % (the identity build `d59f0dd63`, ten launches of the full lab) to 1.9 to 2.4 % (`cd7526567`, max frame 33 ms: one dropped interval per push and per pop). The toolbar on the stack and the route tree are not in it: lab builds of `c4873035e` (identity and toolbar) and `c04372307` (and the route tree) gave 0.0, 0.1, 0.0 % and 0.1, 0.0, 0.0 %. It came with the app migration, `1b85d66cc`: `Page` shows its title in the native header, and the lab's screen under test (`/__dev/screen`) and the lab page under it are `Page`s, so every push showed a navigation bar and every pop revealed a root that has one, which is header-8's cost (the `?hv=title` row above, 2.5 to 2.8 %). The Time Profiler on `cd7526567` says the same: in the main-thread runs of 20 ms and more, 72 % of the samples under `SvelteStackView flush` -> `updatePushedControllers` are `UINavigationBar _redisplayItems` -> `layoutBelowIfNeeded` -> `layoutSubviews` (the bar adding its item views to the window), a run of 32 to 40 ms profiled per push and per pop (the stack's own `stage:` is 5 to 8 ms of it), 304 of the 1,492 main-thread samples after the warm-up are under `UINavigationBar`, and the toolbar integration has none (`applyToolbarTo:`, `setToolbarHidden:animated:`, `applyBarConfigurationTo:`, `notifyWhenInteractionChangesUsingBlock:`: 0 samples; `reportBarMetrics` 1). navigation-8 now pushes `/__dev/screen?header=none`, the screen as it was (a title and a back link drawn in the page, no native header), over a second bare screen, so that no push or pop shows or hides the bar (with the pushed screen bare and the lab page's header underneath, the pop that revealed it still ran `_redisplayItems`: 0.3 to 0.8 %): 0.4, 0.1, 0.3, 0.1, 0.3 % (max 26 to 27 ms) on the final build, header-8 3.2 to 3.6 % as before (3.6 to 3.9). `/__dev/screen` itself stays a `Page` (the parity suite's `lab-screen`), and a page that has a native header costs a dropped interval per push and per pop on this phone, as header-8 says. In the full `checks,quick` lab (three launches) navigation-8 is 1.0 % (max 28 ms, no interval of 31 to 33 ms) against 0.1 to 0.8 % of the identity build in the same sequence, and the same build alone gave 0.8, 0.3, 0.3 % an hour after its 0.1 to 0.4: about half a point over the earlier build that the profile does not explain (no sample of the toolbar, the route tree or the screen wrapper) and that no same-session comparison with `c04372307` separates from the phone's state; header-8, sheet-8, tabs-8, the churns and the lists did not move.

### Presentations and sheets

`modal` is `.fullScreen`, `transparentModal` `.overCurrentContext` (presented from the stack's navigation controller, which defines the context), `sheet` and `formSheet` `.pageSheet` with a `UISheetPresentationController`. Presented screens go one at a time, each in the completion of the last; the first presented controller that JavaScript no longer wants is dismissed together with everything above it, then the new ones are presented on the last that stays. `isModalInPresentation` is `g == 0`, or `dm == 0` for a sheet. A presented screen answers VoiceOver's escape (a two finger scrub) as a swipe down does: it dismisses itself and JavaScript hears `topDismissed`; it does nothing where the swipe is forbidden. The presenter's content is hidden from VoiceOver by `accessibilityViewIsModal` on the presentation's container and on the view that holds the presented content, set when the presentation has finished (a sheet without a backdrop leaves it out).

Sheet: custom detents named by their index (`"0"`..`"3"`), each resolving to `detentHeight(fraction, available, context.maximumDetentValue, contentHeight)`: `available` is the window's height less its top safe area (Android's stack below the status bar), `maximumDetentValue` is UIKit's largest detent and only limits it (on iOS 26 a floating sheet's is 610 to 637 pt against 647 below the status bar of an iPhone SE 3, so a fraction of 1 stops at UIKit's largest, about 30 pt below the top inset line); `auto` is Yoga's content height, clamped. The sheet resolves its detents again once it is in a window (the first resolution happens before). iOS 26.6 draws the sheet 4.2 % shorter than the value returned (557.6 pt for 582.3, 247.9 for 258.8); the factor is UIKit's and is not compensated; `selectedDetentIdentifier` is `di` before the first presentation; `prefersGrabberVisible` is `gr`; `prefersScrollingExpandsWhenScrolledToEdge` is on; `bd=1` sets `largestUndimmedDetentIdentifier` to the last detent (no scrim, the screen behind stays interactive); `sheetPresentationControllerDidChangeSelectedDetentIdentifier` sends `topDetentChange { index, fraction }` (the detent's fraction; for `auto` content over the space below the top inset). Changed detents while presented animate (`animateChanges`).

### Header

The `SvelteHeader` view draws nothing: it is the Yoga band content lays out below, and its props configure `controller.navigationItem` of the screen it is in (`applyToController`, once per transaction):

| record | UIKit |
|---|---|
| 120 title | `title`; with a subtitle: `subtitle` on iOS 26, a two line `titleView` before (center slot absent) |
| 120 flags large | `largeTitleDisplayMode` `.always` (else `.never`); the bar has `prefersLargeTitles` always |
| 120 flags translucent | `scrollEdgeAppearance` transparent (the content may run under the bar); `standardAppearance` as set |
| 120 flags back | `hidesBackButton = !back` (a left slot also hides it); `backTitle` becomes `backButtonTitle` of the item below |
| 120 flags no divider | `shadowColor` and `shadowImage` of the appearances cleared |
| 120 tint, background | bar `tintColor`; title colors and an opaque `backgroundColor` in the appearances |
| 121 slots, 126 | left and right: one custom `UIBarButtonItem` each; center: `titleView`; search: below |
| no header node | `setNavigationBarHidden:YES` for that screen (`willShowViewController` applies it) |

`topMetrics { height, inset }`: the bottom edge of the navigation bar in the navigation controller's view and its top safe area inset, sent after layout, on `viewDidAppear`/`didShowViewController` and when the controller lays out (rotation, dynamic type), only when either changed; for a large title the tallest value seen (the expanded height) so that collapsing while scrolling does not move JavaScript's layout; a change of `large` sends again. A modal with a header is presented inside its own `UINavigationController` (created when the stack presents it, so the header must exist then), and reports the same way.

Slots: the slot's view takes only its size from Yoga (a `SvelteBarContainer` whose intrinsic size is the slot's Yoga size) and is a subview of that container, which UIKit places (left item, right item, title view) and which centers it: iOS 26 gives a bar item in the glass capsule 36 pt of height whatever the custom view asks for, so a 48 pt target overflows by 6 pt on each side (measured: the slot's centre and the capsule's are both at 42 pt) and a center slot wider than the title control overflows both ways (a 279 pt segmented control over 207 pt). Touches: a pushed screen's bar is a descendant of the surface's root component view (the navigation controller's view is a subview of the stack view), so React Native's root touch handler already receives touches in the slots; no handler is added there. A presented screen lives in the window outside the root view: the screen attaches an `RCTSurfaceTouchHandler` to the presented controller's view (the wrapper navigation controller's view includes the bar) in `didMoveToWindow`, with `viewOriginOffset` set to the screen's Yoga origin so `pageX/pageY` agree with `measure`; it does not attach when the presented view is below the root (`overCurrentContext`), to avoid delivering touches twice. The search results controller does the same when it appears outside the root.

Search (slot 3): a `UISearchController` in `navigationItem.searchController` (`hidesSearchBarWhenScrolling = NO`, `preferredSearchBarPlacement = .stacked` on iOS 26: the default puts the field at the bottom of the screen over the content, here it sits under the title and the bar measures it, `definesPresentationContext` on the screen, `obscuresBackgroundDuringPresentation = NO`); the results controller hosts the slot's view, filling its view, and is shown while the search is active only when the slot has content. `searchBar:textDidChange:` sends `topChange { text, eventCount }` (the count increments per edit), `searchBarSearchButtonClicked:` sends `topSubmitEditing { text }`, `didDismissSearchController:` sends `topCancel`. `ph` is the placeholder; `v` is applied only when `ec >=` the native edit count.

### Tabs

`SvelteTabsView` owns a `UITabBarController` (a child of the nearest view controller, its view the bottom subview of the tabs view: bar and empty placeholder controllers, one per `SvelteTab`). Every pane stays in the window: each `SvelteTab` is hosted by a `SvelteTabPane` (a full-size subview of the tabs view, hidden unless the tab is selected, transparent to touches that hit none of its subviews so the bar under it still gets them); `flush` shows the selected pane and `tabBarController:didSelectViewController:` switches it at once (the next flush puts both the bar and the pane back when JavaScript does not follow). The item: `title` (nil for `lb=1`, the title stays the accessibility label), `badgeValue` (`""` for a dot), `isEnabled = !ds`, accessibility label (the tab's own `accessibilityLabel`, else title plus "new items" or the badge text), identifier from `testID`; images from `ic`/`is` (`file://`, `data:`, `http(s)://`, loaded once and cached, fitted into 24 pt, template) or, for `iv=1`, the `native-tab-icon` view drawn with `UIGraphicsImageRenderer` (`layer.renderInContext:`) into a 24 pt template. The icon view is parked in a hidden view of the placeholder controller, laid out but not shown. Bar: `tintColor`, `unselectedItemTintColor`, and a `UITabBarAppearance` with the background and the item colors, applied once per spec.

Selection is JavaScript's: `sel` and `sc` are applied (`selectedIndex`) when either changed since the last application, so a press that `Tabs` did not follow is put back. Every `UITabBarItem` setter makes UIKit rebuild and lay out the bar's buttons, so `applyToItemWithLabels:selected:` assigns a property only when it differs from what this view last assigned (the item's own getters are not the reference: `image` reads back as UIKit's internal template image, and comparing against it re-assigned every image on every flush). A drawn icon is one image per state: drawn the first time the tab is seen unselected and the first time it is seen selected, and redrawn only when a commit touches the icon's views for another reason than the selection flip (the snippet gets `selected` from JavaScript, so every switch arrives as a commit that touches the two icons that flipped). On the iPhone SE 3 (Time Profiler, `tools/xct_callees.py`), tabs-8 went 3.3 % dropped / max 40 ms → 0.0 % / max 25 in three steps: hosting the panes in the tabs view instead of the controllers' views (no change on its own: UIKit's controller transition was not the cost), one drawing per state without the PNG comparison (max 34), and the own-assignment comparison (the dropped interval per switch was the image setters re-run on every flush). `topMetrics { height, inset }` is the tab bar's frame height (home indicator included) and the bottom safe area inset, after layout, when either changed.


A pane's stack with a large title (`<Stack header={{ large: true }}>`, the route-tree lab's inbox pane, `tree-inbox`): the stack attaches its `SvelteNavigationController` as a child of the screen's controller as soon as its view is in a window, which for a pushed tabs screen is while the screen's view is staged for its push (in the window, out of sight). UIKit gives the child an appearance at once (`viewWillAppear(NO)`, `viewDidAppear(NO)`, 20 ms later) and the screen's own, animated one when the push starts (`viewWillAppear(YES)`, the bar moving from y 10 to y 20 as the safe area arrives, `viewDidAppear(YES)` 460 ms later). The bar's layout inside that second `viewWillAppear` leaves the large title's 106 pt band without its label: the bar's view tree has `UIKit.NavigationBarLargeTitleView` and no `_UINavigationBarLargeTitleView` (the label's view) under it, and nothing lays the bar out again, so it stayed blank for as long as it was watched (probes every 25 ms for a second); the references of `tree-inbox` were blank, and a capture in four to six drew the title (4,184 differing pixels). Found on the device with the QA state's bar tree, an event log of the nested controller (appearance, containment, the bar's layouts, the pane's show) and a file of experiment bits read at the attach, one build and a few launches per bit: a layout of the bar after the second `viewWillAppear` builds the label (kicks at +50, +100, +200, +300, +400 ms, and at the animated `viewDidAppear`: every launch, 3 captures each); a layout in the next frame after the first appearance (before the screen's own began), appearance transitions forwarded by hand, `setViewControllers:` again and a re-assigned title did not. `SvelteNavigationController` lays its bar out in the frame after each `viewWillAppear` and after each `viewDidAppear` while `prefersLargeTitles` and the top item's large title mode is `Always` (`layOutLargeTitle`: one layout of the bar, `setNeedsLayout` and `layoutIfNeeded`). Five launches of `tree-inbox` against references taken on the fixed build (the large "Inbox" drawn, light and dark, left to right and right to left): 0 differing pixels in all twenty captures; `tree-home`, `screens-header` and `screens-tabs` 0 pixels, and the whole iPhone parity suite 96 of 96 at 0 pixels (95 and the inbox before).

### Toolbar

`SvelteToolbar` draws nothing: it is the Yoga band (the last child of its screen) and its props and children become UIKit state of the screen it is in, applied at the flush like the header (`SvelteScreenView.update`; a change of an item, a badge or a title only sets `setNeedsToolbarUpdate`, the header is not touched). Its children are never subviews of it: it keeps them in order and builds `controller.toolbarItems` from them, assigned (`animated: NO`) only when the list changed by identity.

| record | UIKit |
|---|---|
| 128 flags hidden | `setToolbarHidden:YES` on the stack's navigation controller (the items are still set) |
| 128 flags translucent | `scrollEdgeAppearance` and `compactScrollEdgeAppearance` transparent (the content may run under the blurred bar); `standardAppearance` and `compactAppearance` as set |
| 128 tint, background | `UIToolbar.tintColor` (images and titles); `UIToolbarAppearance`: `configureWithOpaqueBackground` with `backgroundColor`, else `configureWithDefaultBackground` |
| 128 slots | nothing: the center slot is a child when it exists |
| 129 spacer | `UIBarButtonSystemItemFlexibleSpace` |
| 129 icon, title | one `UIBarButtonItem` with the image (`ic` through `SvelteLoadImage` like the tabs' icons, fitted into 24 pt, template, tinted), or with the title when there is no icon: only when the item has no badge and no `iv=1` and not both an icon and a title |
| 129 `iv=1`, an icon with a title, a badge | `UIBarButtonItem(customView:)` of a `SvelteToolbarButton`, a `UIControl` that draws the image (24 pt template) or hosts the snippet's content, the title under it (`caption2`, in the bar's tint; alone it is `body`) and the badge, at least 44 x 44 pt; the item changes form when a badge appears or goes |
| 129 badge | drawn by the control: `systemRed` pill with white 11 pt semibold text (an 8 pt dot when empty) over the top corner at the end of the image (the title when there is none), mirrored in right to left. UIKit's own `UIBarButtonItem.badge` (iOS 26) is documented for navigation bars only, so it is not used |
| 129 disabled | `enabled = NO` (the control is drawn at 40 %, with the not-enabled trait); a pressed control is drawn at 50 % |
| 129 label, test id | the node's `accessibilityLabel` (else the title, with ", new items" or ", <badge>" as the tabs) and `testID` on the bar item or the control (a snippet icon without a label has none: give it one) |
| 126 slot 4 (`SvelteToolbarCenter`) | `UIBarButtonItem(customView:)` of a `SvelteBarContainer` sized by Yoga |

The snippet of an `iv=1` item lives in a container that does not take touches: the control owns the tap, so a `Pressable` inside the snippet does not hear it (the snippet's `pressed` stays `false`). A snippet icon is drawn, not pressed, on both platforms: the item node is `pointerEvents: "box-only"` in JavaScript (Android's engine honors it in its hit test), and presses reach `toolbar.onPress(key)` only. The center slot takes touches like the header's slots (the bar is below the surface's root view, so React Native's touch handler hears it).

The center slot takes the place of the first flexible space, flanked by two flexible spaces of its own so that it stays centered in what is left; without a spacer it follows the last item (Android's rule). Yoga sizes it with the numbers UIKit lays the bar out with (`TOOLBAR_METRICS.ios`: 16 pt edges, 44 pt items with 4 pt on each side), so its Yoga width, `band width - 32 - 52 x the items that are not spacers`, is the free span between the items and its container takes that width unchanged (no clamp; a spacer beside a center has no growth in Yoga, the center takes the whole span). `topPress { key, index }`: a tap on an item (`UIControlEventTouchUpInside`, or the bar button's action), `index` counting the item nodes, spacers included.

Showing and hiding: the stack's `UINavigationController` has one `UIToolbar`. `applyBarConfigurationTo:animated:` (the navigation bar's visibility and tint) now also applies the toolbar of the screen being shown: `setToolbarHidden:` with `UIToolbarAppearance` and tint when the screen has a toolbar that is not `hidden`, hidden otherwise; from `willShowViewController` it animates with the push or the pop, and `toolbarItems` are swapped by UIKit with the transition. A change of the toolbar alone on a screen that is on top animates too (`animated:` is whether the screen has appeared). A back swipe that the user lets go of puts the screen it started from back on top: `willShowViewController` registers `notifyWhenInteractionChangesUsingBlock:` and applies that screen's bars again (one call restores the navigation bar and the toolbar). The appearance is requested each time a screen with a toolbar is shown (the bar is shared), and the bar keeps the look it has (translucency, tint and background, as an associated object of the `UIToolbar`, as `SvelteTabsView` keeps `_appearanceApplied`): new `UIToolbarAppearance` objects and the tint are assigned only when one of them changed, every setter making the bar lay out again. The bar's `semanticContentAttribute` is set from the screen's in the same place, when a toolbar is shown: the stack never reads `UINavigationController.toolbar`, which creates the bar on first use; a toolbar inside a tab pane is the pane stack's, above the tab bar.

`topMetrics { height, inset }`: `navigation.toolbar.frame.size.height` (UIKit's frame, taken to be the bar and the home indicator's inset as the band is `bar + inset` and the tab bar's frame is; inside a tab pane the inset is 0 because the pane ends at the tab bar) and `navigation.view.safeAreaInsets.bottom`, sent after layout, on `viewDidAppear`/`didShowViewController` and on every update, only for the screen on top with the toolbar shown and only when either changed.

The scroll view under a translucent toolbar: the first scroll view of a screen with a large or translucent header is `Automatic` ("Scroll view under a large or translucent header"), and with a translucent toolbar (JavaScript puts the band out of flow, over the content) UIKit would add the bar's height to its bottom as well, while `useToolbar().height` pads it in JavaScript. The bottom is JavaScript's, never UIKit's: `SvelteScreenView.applyToolbarInset` sets that scroll view's `contentInset.bottom` to minus the toolbar's reported `topMetrics` height, so the adjusted bottom inset is 0, and its `verticalScrollIndicatorInsets.bottom` to that height, so the indicator stops above the bar; it is applied again when the reported height changes, and removed (both back to 0) when the toolbar is hidden, removed or no longer translucent, or when another scroll view becomes the first one. An opaque toolbar is in flow below the content in Yoga, the scroll view never reaches it and nothing is set; a screen whose header is neither large nor translucent has a `.never` scroll view, which UIKit does not inset.

Presented screens: a presented controller has no navigation controller above it, so the screen creates one of its own, as it does for a header, when it has a header or a toolbar at the moment it is presented (`ensureWrapper`; `preparePresentation` applies the bars to it at once). A sheet, form sheet or modal with a toolbar therefore shows it at the bottom of the presented view; one whose toolbar mounts after it is presented has no bar to show it in, and a presented screen with neither is not wrapped.

Not verified (no device was used): every drawing and behaviour above is compiled (Release, `iphoneos`, no signing) and nothing more: the toolbar's frame against the Yoga band (on a phone with a home indicator, where the test phone, an iPhone SE 3, has none, and with the iOS 26 floating toolbar), the iOS 26 capsule around a 44 pt control (the container centers it, as the header's slots), the badge's place, the center's width against UIKit's real item widths (an item wider than 44 pt, a long title, widens UIKit's row beyond Yoga's numbers), tap handling next to React Native's touch handler, the pop animation of the toolbar and the cancelled back swipe, a toolbar in a sheet and a modal, the first scroll view of a large or translucent header with a translucent toolbar (the negative bottom inset above: that the adjusted inset is 0, and whether UIKit's automatic scroll indicator adjustment adds the bar's height on top of `verticalScrollIndicatorInsets.bottom`, which would put the indicator twice as high), VoiceOver and Dynamic Type.

### Scroll view under a large or translucent header

With a large or translucent header the first `RCTScrollViewComponentView` of the screen (document order) gets `contentInsetAdjustmentBehavior = .automatic` and becomes the controller's content scroll view (`setContentScrollView:forEdge:`), so UIKit insets it by the bar and collapses the large title as it scrolls; it goes back to `.never` when the header changes. Under a translucent toolbar its bottom inset is not UIKit's ("Toolbar" above). Measured on the device (`large-title` probe, iPhone SE 3): the expanded bar is 126 pt tall and collapses to 54 pt (a large title adds 72 pt, not Android's 56 dp) once the content has scrolled between 52 and 120 pt from rest, and expands again when it returns; a translucent header (`translucent: true`) lets the rows run under the blurred bar. Not normalized: React Native sends the raw `contentOffset` of the `UIScrollView`, which at rest is minus the adjusted top inset (-146 with the large title expanded, -74 collapsed or translucent), not 0 as the layout rules above say for Android. Nothing in the package depends on it (`List` virtualizes by content coordinates, for which the raw offset is the right one); an app effect keyed on the offset adds `useHeader().height` on iOS. A native normalization would need to hook React Native's scroll event, which the prebuilt framework does not allow; a JavaScript one needs to know which scroll view the native side chose.

### Status bar

`SvelteScreenController` answers `preferredStatusBarStyle` and `prefersStatusBarHidden` from record 125 and `SvelteNavigationController` forwards both to its top controller; modals capture the status bar appearance. UIKit asks the root view controller first: the app's root controller must forward `childViewControllerForStatusBarStyle` and `childViewControllerForStatusBarHidden` to its child for any of it to apply (React Native's default root controller does not; not changed here).

### Tests

`packages/svelte-native/tests/screens-ios.test.ts`: the shared wire re-exported unchanged; the host mounting the tags as the `Svelte*` components on iOS and as `RCTView` on Android with equal nativeIDs; the view config registration (six components, once, their direct events). `test/records_dump.cpp` is built with the system C++ compiler (`c++`, `clang++` or `g++`; the test fails without one) from `native/Core`: it reads the `nativeID`s of golden vectors, of malformed and repeated-key inputs, and of about 730 strings the encoders build from a grid of attributes, and its records equal `decodeRecords` for every one; it also runs the stack planner over a table of transitions and the detent arithmetic. It prints kinds 17 and 18 (records 128 and 129) and the toolbar's center (kind 13, slot 4 of record 126) as well.

### Accessibility

- Host defaults: React Native's own components make text and pressables accessibility elements on iOS, and the lowered tags (`<Text>`, `<Pressable>`) bypass them, so `fabric/host.ts` sets `accessible` on `RCTText` views and on views with a press handler unless the caller says otherwise (tests: `screens-ios.test.ts`, `pressable-fixture.svelte`).
- UIKit's own chrome (navigation bar title and back button, the search field, tab bar items) is an accessibility element only while an accessibility service runs, and the app cannot start one; the dump reads it from the controllers instead (title as a heading, "Back", the placeholder of the search field, tab items with `accessibilityLabel` or title and badge) at UIKit's order: back button, title or center slot, trailing items, search, then content. The suite's "title first" (`judgeReadingOrder` in `qa/lib/a11y.ts`, the same function the Android suite runs) means that the title is the first stop after the bar's back button and left slot: what comes before it sits above its row or at its start side, and none of it is content; a title that the center slot replaces is a control of the slot, not a heading.
- Result of the suite (`native-qa a11y --platform ios`, 18 screens, left to right and right to left, text size 1.0; the dump is what the accessibility services receive, VoiceOver itself was not run): 36 screens (18, each in both directions), 252 interactive elements: 0 unreachable, 0 unlabeled, 0 not actionable, 0 order violations, 0 titles not first, 0 focus leaks, 0 errors. The first run of the suite read 8 unreachable (the back button and the tab items, UIKit chrome absent from the dump), 2 not actionable (text fields, which are accessibility elements only through the dump), 7 titles not first and 21 focus leaks (the screen under every sheet); what the dump got wrong was fixed in the dump (UIKit's chrome from the controllers, one group id per container, implicit text input elements) and what the app got wrong in the app (the container flag of the presentation)
- Escape: sheets, modals and pushed screens answer it (see "Presentations and sheets"; a pushed screen pops as the back button does when `nativeBack` allows it).
- Not exercised: VoiceOver's focus order and announcements on a real run, whether a pushed screen's title receives focus when its transition ends (UIKit posts the screen-changed notification itself), and Dynamic Type.

### In-app QA (`SvelteQA`) and the harness lane

Nothing outside an iOS app can screenshot it, read its accessibility tree or press a button of it, and `devicectl` has no input, so the lab drives and reads itself (`modules/svelte-qa-ios`, Swift, active only in the QA bundle `io.rasheed.svelteqa`; JavaScript in `src/lib/native/dev/{qa,capture,probe}.ts`): `run=capture:<screens>` for the parity and accessibility suites, `run=probe:<names>` for device probes, boot timing from the kernel's process start to the first content frame. The commands, files and gates are in `apps/platform/qa/README.md` ("iOS"). The stack answers `qaState` (its flags and screens, the sheets' last detent resolutions) so that a transition that did not happen can be traced to the flag that held it back; that is how the full screen modal defect was found.

### Verified on the device (probes, iPhone SE 3, iOS 26.6, 27 Oct)

| behaviour | result |
|---|---|
| large title collapse | expanded bar 126 pt, collapsed 54 pt; collapses between 52 and 120 pt of scroll and expands again at rest; title and subtitle exposed |
| translucent header | `scrollEdgeAppearance` transparent, `standardAppearance` background `101113e6`; rows run under the blurred bar (screenshot) |
| search slot | stacked under the title (bar 114 pt with the field), `hidesSearchBarWhenScrolling` off; typing sets the text and `topChange` reaches JavaScript; while active the bar shrinks to the field and a cancel button and the results start below it, inside the safe area UIKit reports (screenshot: one row, "Dana", under the field; the default bottom placement of iOS 26 hid the last rows of the screen, and results laid out to the bounds ran under the stacked field: both fixed) |
| two detent sheet | detents "0" and "1" resolve to 40 % and 90 % of 647 pt (258.8, 582.3), drawn at 247.9 and 557.6 pt; a scroll view inside scrolls (offset 120) with the sheet at its detent; grabber on |
| sheet, form sheet, modal, pushed screen: user dismissal | the escape gesture dismisses each, `topDismissed` reaches JavaScript, entries 2 -> 1, nothing presented afterwards (the drag and the swipe themselves cannot be synthesized, see below) |
| reset or `back()` while a sheet, form sheet or modal is presented | all six gone 1.2 s later (the modal case failed until the flush fix) |
| tabs, snippet icons and badges | three items with images for both states, a dot badge (`new items`), `99+`, accessibility label from title and badge; the selected capsule, icons and badges render; right to left mirrors the order, the badge and the content |
| keyboard avoidance | a field at the bottom of a `KeyboardAvoidingView` ends at 340 to 390 pt with the keyboard from 407 (overlap 0); in a form sheet the field stays at the top of the sheet (overlap 0) |
| header slots | content centered on the glass capsule (centre 42 pt in both) after the container fix; before, a 48 pt slot hung 6 pt low |

### Not verified on the device

What a probe cannot do: the sheet's drag with a finger and the interactive swipe down (touches cannot be synthesized: the API and the escape action stand in), the edge swipe and its cancelled variant, VoiceOver and Dynamic Type themselves, custom push animators (not implemented), iPad. The selected tab's label renders over a ghost of the unselected one in the screenshot (UIKit's selection lens on iOS 26, not ours).


## Clocks: baseline profile, and what a timer-driven push measures

Two findings from the Galaxy A16 (26 Oct 2026, `.rasheed/native-qa/2026-10-25/README.md` "Push/pop first-frame attribution"): a 127-view push mounted in 20 ms on the main thread, of which the engine's own work was ≈ 5 ms — the rest was the interpreter (a sideloaded release build is dexopt `verify`, the engine's Kotlin runs in nterp until the JIT catches up) and the clocks (a navigation started from JavaScript follows no touch, so the main thread sits on a little core at 500 MHz when the mount arrives; the same push behind a real tap mounts on a big core at 2.2 GHz in 4.4 ms, 1.1 ms once the pool is warm).

- **Baseline profile.** The Expo plugin writes `android/app/src/main/baseline-prof.txt` (`baselineProfile()` in `src/expo.ts`): every method of `expo.modules.svelteengine` and `expo.modules.svelteupdates`, hot + startup + post-startup. The Android Gradle plugin compiles it into `assets/dexopt/baseline.prof`; a Play install compiles it at install time (`speed-profile`), a sideload gets it after `androidx.profileinstaller` copies it on first run and the background dexopt runs. The harness forces that path right after `adb install` (`am broadcast -a androidx.profileinstaller.action.INSTALL_PROFILE -n <package>/androidx.profileinstaller.ProfileInstallReceiver`, then `cmd package compile -m speed-profile -f`; `--dexopt none` skips it), so the gates measure what ships. Measured: decode 3.9 → 1.0 ms and create 3.3 → 2.2 ms per 127-view push; boot unchanged.
- **ADPF, tried and removed.** A `PerformanceHintManager` session for the main thread (target one frame) fed with `reportActualWorkDuration` from the router before each navigation and after each mount was created fine on the A16 (`mtkpower` logs the session) and changed nothing: 29 hints in a run, every timer-driven push still on a little core at 500 MHz until 11 ms into the mount. MediaTek's HAL does not act on reports from an otherwise idle session. Not shipped; the transaction log line (`[create insert layout delete texts screens]` in ms) stays for the next investigation.


## Modal as an overlay layer

`Modal` (kind 9) no longer creates an Android `Dialog`. A visible modal is a layer of the engine tree: a full-screen view that is the last child of the `EngineRoot`, above screens, sheets, headers and the modals shown before it. Why: the dialog's window was the one cost left per show (its first traversal, about 40 ms), and modal-8 dropped 4.3 % of frames at 90 Hz on the Samsung A16 with a p99 of about 40 ms; the variant that kept the window added and only hid it was tried and failed, because `onShow` is not delivered for it. Removed with the dialog: `EngineDialog`, `SpareDialogs`, `EngineModal.clearSpares()` and its two calls in `MountingManager`, the `SvelteEngineDialog` themes and the `catalyst_*` animation styles (`res/values/svelte_engine_styles.xml`, the module has no resources left), the `SvelteEngine.dialog.build` / `.show` trace slices (now `SvelteEngine.modal.show`). The JavaScript API, the Fabric props and the events are unchanged; so is the modal-8 lab scenario, which counts `onShow` calls.

### What is where

| file | role |
|---|---|
| `views/EngineModal.kt` | `EngineModal` (the host frame in the tree), `ModalLayer` (the overlay layer: scrim, content, insets, animation, back key, first-frame `onShow`), `ModalContent` (holds the modal's children, reports the size) |
| `views/ModalLayout.kt` | the rules with no Android types: content insets, the animation pose, the phases of a layer (`Phase`, `Step`); host-tested |
| `views/EngineRoot.kt` | the layer slot: `addLayer`, `removeLayer`, `bringLayerToFront`, `layerAbove`, the root-sized frame of each layer, the accessibility filter, a gesture that starts on a layer's own area |
| `views/EngineStack.kt` | `isActive()` is false while a modal layer is in front of the stack, so no stack answers the back key under a modal; `DURATION` and the new `DECELERATION` are `internal` for the layer's animation |
| `MountingManager.kt` | `EngineModal(appContext, root)` at creation; no spare-dialog calls |
| `packages/svelte-native/tests/modal-native.test.ts`, `tests/native/ModalHost.kt` | the host test of `ModalLayout.kt` |

### Layer

- `EngineModal` stays where the modal is in the Fabric tree, as before: `pointerEvents` none, a frame of the modal's state size, its child operations forwarded to the `ModalContent` of its layer. `ModalLayer` is built with the host (three views: the layer, a scrim `View`, the content) and costs nothing while it is not attached.
- The layer is an `EngineView` with tag 0 (it is not a Fabric node) and pointer events `auto`. `EngineRoot.onMeasure` gives every layer the root's size as its frame, so the root places it like any child. Layers come after every node of the Fabric tree: Fabric's insert indexes count nodes only, and an insert at the end of the node list lands before the layers. `HitTest` needed no change: the layer is the last child, so it is the first thing tried, and it answers for its whole area (an engine view of the modal, else the layer itself). Nothing below can be touched while it is up.
- Content frame: the layer minus the system bars and cutout it reaches into (the same reading as `Insets`: root window insets less how far the root already sits inside each edge), minus the keyboard at the bottom. Translucency follows React Native: `statusBarTranslucent` removes the top inset, `navigationBarTranslucent` removes all four (and implies the status bar). `ModalContent` gets that frame; its size, in dp, is reported with `modalSize` (written into `ModalHostViewState`, which lays the children out). The report is posted from the layout pass, never made inside it, because the new layout reaches `MountingManager.apply` synchronously on this thread. A modal that was never shown has no size, so its children lay out empty and a hidden modal costs no layout; the first show of each host lays its content out one frame after the layer's first frame (the slide or fade hides that; with `animationType` none the first show is an empty dim for about two frames), later shows find the frames in place. `SafeArea` measures a view's inset from its place under the root, which includes the layer's content offset, so a screen with a header inside a modal that is not translucent gets no second status bar inset.
- Backdrop: in React Native 0.86 (`ReactModalHostView.updateProperties`, `Theme.FullScreenDialog`) the dialog window's `windowBackground` is `@android:color/transparent` for both values of `transparent` and nothing in the content view paints a background, so a modal that is not transparent has exactly one thing behind its content, a window dim of 0.5 (`FLAG_DIM_BEHIND` with `setDimAmount(0.5f)`), and a transparent one has nothing; the layer paints the same, a 0.5 black scrim when `transparent = false` and none when true (the modal's own content paints whatever opaque background an app wants). A tap on the scrim does nothing, as in React Native's Dialog on Android: only the back key and `visible = false` close a modal.
- Animation (`animationType`): `ValueAnimator` over one progress value, 250 ms, `DecelerateInterpolator(1.5)` (the stack's time and curve, shared as `EngineStack.DURATION` and `EngineStack.DECELERATION`). slide: the content moves up from below the layer's bottom edge while the scrim fades in; fade: the layer's alpha, scrim and content together; none: shown and hidden at once. A hide during an enter, or a show during an exit, turns around from where the progress is (duration scales with the distance left), no jump. System animation scales (animator duration scale 0) make every step immediate.
- Phases (`ModalLayout.Phase`): hidden, entering, shown, leaving. `visible = true` from hidden attaches; from leaving it brings the layer back in front and animates in again; `visible = false` from entering or shown starts the exit (or detaches at once for none); the end of an exit detaches the layer and sends `onDismiss`. A deleted host takes its layer off at once and sends nothing. While leaving the layer takes no touches (pointer events none), no key and is hidden from accessibility, as a dismissed dialog was; it stays drawn until its exit ends.

### Events

- `onShow`: one pre-draw listener, added at each show, so it goes out when the layer has been measured and laid out for the frame it first draws in. It is sent for every show, including one that turned an exit around.
- `onRequestClose`: the layer's `OnBackPressedCallback`, enabled while the layer is active. Back key and back gesture both end there; JavaScript decides (`Modal.svelte` dismisses a visible keyboard first).
- `onDismiss`: after the exit animation (immediately for none) when `visible` went false. Not for a deleted host.

### Back key

The layer registers its callback when it is attached, so it is newer than the stacks and the headers (a search field's callback) that were there before it, and `OnBackPressedDispatcher` runs the newest enabled one first. Two cases would break that order and are handled: a stack that mounts after the modal registers later, so `EngineStack.isActive()` asks `EngineRoot.layerAbove(stack)` (a visible layer later than the one the stack is in, or any layer when the stack is in none) and a stack under a modal is disabled; and a modal shown again while leaving registers again (`bringLayerToFront`). `EngineStack.refreshBackCallbacks()` runs at every show, hide and detach. A stack inside a modal's content attaches after its layer, so it answers first (a router in a modal pops before the modal closes). Of several modals the last shown answers first.

### Accessibility

- While a layer is active, `EngineRoot.addChildrenForAccessibility` reports only the front-most active layer's views of the overlay, so a service sees nothing below it. It is done at the root and not with `importantForAccessibility` on the nodes below because the common props write that flag again on every update of a node (`A11y.apply`). A layer that is leaving is not reported either, and the views below are back at once.
- The layer is a named pane (`setAccessibilityPaneTitle`, "Dialog"): when it appears the service announces it and moves focus into it, when it goes it announces that too. The scrim is not important for accessibility.
- Views that are not part of the overlay (a React Native surface under it, foreign views) are siblings of the root and are not hidden by this; when foreign views arrive their owner must set `IMPORTANT_FOR_ACCESSIBILITY_NO_HIDE_DESCENDANTS` on them while `EngineRoot.layerAbove` is true for anything (one call from `addLayer` and `removeLayer`).

### Touch and focus

- A gesture that starts on a layer's own area (scrim, empty content) is claimed by `EngineRoot` and reported to nobody (no tag, no event), so a `Pressable` that has the `<Modal>` among its Svelte ancestors is not pressed by a tap on the dim. Pointers that go down on an engine view of the modal are reported as usual: all pointers, the scroll cancel (`EngineScroll` finds `EngineRoot` through the layer, which the dialog window could not), the same coordinates as the rest of the overlay (root, not dialog, coordinates).
- Showing blurs an `EngineInput` below the modal that has the focus (`EngineInput.blur()`, which also hides the keyboard), as the dialog's window used to take the focus and the keyboard; hiding hides the keyboard when a view of the modal has the focus.

### Differences from the dialog

- No window: the layer is part of the activity's window, so it shares its focus, input method and system bar appearance (the dialog copied the activity's), and a modal can no longer sit over the status bar or navigation bar beyond what the overlay itself reaches (the app is edge to edge, `edgeToEdgeEnabled=true`, so the overlay reaches both).
- `hardwareAccelerated` is ignored. `animationType` is read at each show and hide (it never rebuilds anything), the translucency props lay a visible modal out again at once (the dialog was rebuilt).
- `onShow` is sent after the first laid-out frame, not when the window was added; `onDismiss` is sent (React Native Android does not send it).
- The `modal-8` row of "Frames" above was measured with the dialog.

### Tests

`bun test tests/modal-native.test.ts` (in `packages/svelte-native`) compiles `ModalLayout.kt` for the host and runs: content insets (bars, landscape, both translucencies, keyboard over the bars, keyboard under them), the poses of fade, slide and none (clamped progress), the phases (animated and none, a show during an exit, a hide during an enter, repeated values, a stale end, deletion while shown, leaving or hidden), and eight show/hide cycles attaching and detaching eight times. It needs `kotlinc` and `java`. Everything that draws, moves or takes the key is device work, below.

### Not verified (no device was available)

Compile only: `:svelte-engine:compileReleaseKotlin` and `:app:assembleRelease` (arm64-v8a) are green. For the integration lane, on the Samsung (90 Hz) and the emulator:

- modal-8: 8 / 8 `onShow`, no fatals; frames against the dialog's 4.3 % dropped and p99 40 ms at 90 Hz; in a Perfetto trace `SvelteEngine.modal.show` per show under a few milliseconds, no `SvelteEngine.dialog.*`, no window add.
- Hardware back, key and gesture, with `onRequestClose` closing the modal; with a modal over a stack of two screens the key closes the modal first and pops the screen after; over a sheet (the sheet and its scrim stay, drag does nothing under the modal); a router inside the modal pops before the modal closes; two modals (the last shown answers first); a stack mounted while a modal is up does not answer the key.
- Status bar and navigation bar: `statusBarTranslucent` false (content below the bar, dim under it), true (content under the status bar), `navigationBarTranslucent` true; cutout and rotation; a `SafeAreaView` inside a translucent modal.
- TalkBack: focus moves into the modal on show ("Dialog" is announced), swipes cannot reach the screen, header, tab bar or sheet below, focus comes back below after the hide; the lab's `/__dev/screens` header and tabs are not reachable.
- Above a sheet (sheet-8) and above a pushed screen; inside `/__dev/screens` (open, then pop the route while it is open: the layer goes at once); shown during a push transition (the same batch as the push and a frame after it: the push finishes below, the back chain is right afterwards).
- Keyboard: a `TextInput` in the modal, the content resizes with the keyboard (one layout per change, no per-frame work), closing the modal closes the keyboard; an input below with the focus loses it when the modal opens.
- Touch: a tap on the dim reaches nothing (not an ancestor `Pressable` either), a scroll view inside the modal scrolls and cancels the press, two fingers.
- Show during an exit and hide during an enter (rapid `visible` toggling): no layer left behind, `onShow` count equals the shows, `onDismiss` after each completed exit; 100 cycles leave the root with the children it had; `animationType` none, slide and fade by screenshot; rotation with a modal open; developer option "remove animations".
- Re-run sheet-8, header-8 and tabs-8 and the navigation back-key checks: `EngineStack.isActive()` changed by one line and must behave as before when no modal is up.

## Foreign views

Written by agent X on 26 Oct 2026 (wave 2). Foreign views are views other libraries own, mounted inside the engine's tree: `react-native-webview` (`RNCWebView`), `react-native-maps` (`RNMapsMapView` with its `RNMapsMarker` children), `expo-video` (`ViewManagerAdapter_ExpoVideo_SurfaceVideoView`), or any Fabric component with a view manager. React Native's own Java mounting (`FabricUIManager`, `SurfaceMountingManager`, the library's `ViewManager`) creates, updates and commands the view; the engine owns the node's place in its tree.

### What is where

| | |
|---|---|
| `cpp/ForeignSplit.h` | which mounting layer owns which node of a transaction (no React Native, no JNI; `src/test/cpp/ForeignSplitTest.cpp` runs on the host under ASan/UBSan) |
| `cpp/MountingDelegate.{h,cpp}` | registry of foreign component names, the classification per transaction, the mutations returned to React Native, `inEngineFrame` |
| `cpp/SvelteEngineNative.{h,cpp}`, `SvelteEngineNative.kt` | JNI: `registerForeign(name)`, `isForeign(tag)`, `foreignCount()` |
| `views/EngineForeign.kt` | the engine's frame for a foreign root: an `EngineView` (kind 19) with React Native's view as its only child |
| `ForeignViews.kt` | puts React Native's view into its frame (`resolveView`, `UIManagerListener.didMountItems`), counts, taps and drags for the lab |
| `ExpoViews.kt` | lazily registered Expo modules' views: builds the module, registers its Fabric components, serves its view managers on demand |
| `views/HitTest.kt` | touch gating |
| `MountingManager.kt` | `KIND_FOREIGN` create, delete, and `applyAnimated` returning false for tags React Native owns |
| `packages/svelte-native/src/fabric/host.ts` | `native-foreign` element, `registerForeign`, commands by tag kind |
| `packages/svelte-native/src/fabric/view-configs.ts`, `foreign.ts` | static view configs, `defineViewKind`, the WebView's callable module, Expo view names |
| `packages/svelte-native/src/components/{ForeignView,WebView,MapView,Marker,VideoView}.svelte`, entry `@rasheed/svelte-native/foreign` | the Svelte side |
| `packages/svelte-native/src/expo.ts` | `androidOnDemandViewManagers`, the `ExpoViewsPackage` |

### The delegate split

The JS host tells the engine every foreign component name before it commits the first node of it (`SvelteEngine.registerForeign(name)`, once per name). `MountingDelegate::pullTransaction` then sorts each transaction's mutations (`foreign::Ownership::classify`, which only runs while a foreign component is registered and a transaction creates one or any foreign node is mounted):

- A node of a registered name under an engine node is a **root**. A node under a foreign node is a **descendant**, whatever its name (a map's marker is a foreign component under a foreign parent): React Native mounts it into the parent's own `ViewGroupManager`. Fabric emits a new subtree's `Create`s, then the children's `Insert`s, then the parent's, so the whole list is read for parents before any node is classified; the registry then follows the transaction in order (a `Delete` is still foreign when it arrives, then it leaves).
- **Descendant**: every mutation (`Create`, `Insert`, `Update`, `Remove`, `Delete`) goes to React Native unchanged and nothing goes to the engine.
- **Root**: the engine batch carries it as a `View` of kind 19 (`CREATE`, `INSERT`, `UPDATE_PROPS`, `UPDATE_LAYOUT`, `REMOVE`, `DELETE`, common records only, no state, no emitter). React Native receives `Create` and `Delete` unchanged, an `Update` only when props, state, emitter or its layout in the frame changed, and **the first `Insert` only**, rewritten to `Insert(surfaceId, view, 0)`. The `Remove` and later inserts of a root (a move inside the engine's tree) never reach React Native.
- **Frame**: `inEngineFrame` gives React Native the root's layout at origin (0, 0) in the size `round(x + w) - round(x)` pixels, the rounding `MountingManager.applyLayout` uses, so the view's own `layout(0, 0, w, h)` and the engine's agree to the pixel. Position and stacking are the frame's.
- The returned `MountingTransaction` holds exactly these mutations. The Reanimated layout-animation delegate chained after ours therefore sees an empty list for every engine subtree, as before, and the foreign mutations for the rest. `foreign: surface=S created=C deleted=D forwarded=F of N mutations` is logged for every transaction that creates or deletes a foreign node.
- `isForeign(tag)` (any thread) answers for roots and descendants; `MountingManager.applyAnimated` returns false for a tag that has no engine view and is foreign, so Reanimated's own path (React Native's `updatePropsSynchronously`) writes it. The typed animated path hands such tags back (step 7 of "Animated write path"). A root has an engine view (the frame), so opacity and transform animations of a foreign view run on the frame.

### Attach timing

React Native inserts a root's view into the surface's root view (attached to the window) and then inserts the children, because a view manager may rely on its view being attached when its children arrive: react-native-maps starts its lifecycle on attach and creates its marker layer in `onMapReady`. `ForeignViews` moves the view into its `EngineForeign` frame afterwards:

1. Engine batch first (the usual order: it is posted before React Native's batch is scheduled): `OP_CREATE` of kind 19 makes the frame and registers it; `ForeignViews.created` asks `FabricUIManager.resolveView(tag)`; it is not there yet, so the frame waits in `waiting`.
2. React Native's batch runs (create, insert into the root, children, layout). `UIManagerListener.didMountItems` runs right after it on the main thread, before the next draw: each waiting frame gets its view (`adoptedAtMount`), the view is taken out of the root view and added to the frame, so there is never a drawn frame with the view in the wrong place.
3. React Native first (the engine's batch was held back behind a frame callback): the frame's `created` finds the view and adopts it at once (`adoptedAtCreate`).

`EngineForeign.onMeasure`/`onLayout` fill the frame with the view on every engine pass, which is what the platform needs when the view asks for its own layout. The frame is never pooled; on `OP_DELETE` the view leaves the frame (`release`) and React Native's `Delete` drops it (`onDropViewInstance`), in either order.

### Touch gating

`HitTest.hitView` returns the foreign view itself when a point lands in an `EngineForeign` (`pointerEvents` auto or box-none and the view exists). The view carries no engine tag, so `EngineRoot` claims the gesture and sends nothing to `dispatchTouch`: JavaScript's touch dispatch and responders do not see it, and the platform's normal dispatch (`super.dispatchTouchEvent`) delivers it to the view. `pointerEvents: none` hides the frame from both (`EngineForeign.dispatchTouchEvent` returns false), `box-only` keeps the touches for the frame (it intercepts, and JavaScript hears them on the frame's tag). A foreign view inside a scroll view, a list row or a sheet follows Android's usual rules: a view that wants its own scrolling or panning calls `requestDisallowInterceptTouchEvent` (maps and WebViews do), otherwise the ancestor's intercept takes the gesture and the view gets a cancel.

### Commands, props, events

- **Props** are the JS host's payload for the component's view config: static tables for `RNCWebView`, `RNMapsMapView` and `RNMapsMarker` in `view-configs.ts` (the props of each library's codegen spec and the events its emitter sends; `tests/foreign.test.ts` compares them with the specs), `defineViewKind(name, kind)` for names known only at run time. `expoViewName(module, view)` builds the config of an Expo module's view from `expo.getViewConfig` (attributes and `directEventTypes`) and returns the Fabric name `ViewManagerAdapter_<module>_<view>`. An unknown name falls back to React Native's registry as before.
- **Commands**: the host handle's `dispatchCommand` goes to the engine for engine nodes and through Fabric (`nativeFabricUIManager.dispatchCommand`, React Native's `DispatchCommandMountItem`, the library's `receiveCommand`) for a foreign node and for everything inside one (`State.foreign`). The same for `setNativeProps`. `WebViewHandle` and `MapHandle` (`foreign.ts`) wrap the commands of the two libraries (the map's Fabric commands take JSON strings).
- **Events** arrive through React Native's normal Fabric path (`EventEmitterWrapper` on the view state, `registerEventHandler`), named by the view config's registration names; nothing is engine code. The WebView is the exception on Android: `RNCWebView` reports `postMessage` calls and navigation requests through the JavaScript module `RNCWebViewMessagingModule` (`getJSModule`), tagged with the instance's `messagingModuleName`, and blocks the navigation (up to 250 ms) until `RNCWebViewModule.shouldStartLoadWithLockIdentifier` answers. `listenToWebView` registers that module (`RN$registerCallableModule`) and `WebView.svelte` answers the requests with react-native-webview's own rules (origin whitelist, `onShouldStartLoadWithRequest`, external schemes to the system).
- **Maps** mount their children after `onMapReady`, as react-native-maps' own component does: Fabric inserts a child before its parent, the native map creates its marker layer when the Google map is ready, and a marker that arrives earlier throws.

### What stays off the start

React Native builds the view managers of every package that does not offer them on demand when the host starts, on the JavaScript thread; react-native-maps creates a dozen, and Expo builds the definition of every module that is not in the lazy list. The foreign packages therefore stay off the start:

- `androidOnDemandViewManagers` (the Expo config plugin, `app.config.ts`): `MapsPackage` and `RNCWebViewPackage` are wrapped in a generated `SvelteNativeOnDemandPackage` (`ViewManagerOnDemandReactPackage`; TurboModules served as before; the package's managers are created together on the first request by name). A test reads the names back from the packages' sources.
- `expo-video` is in the lazy module list of `patches/expo-modules-core@57.0.23.patch`. Its view hooks are served by `ExpoViews`: `registerForeign("ViewManagerAdapter_ExpoVideo_...")` builds the module, registers the Fabric components of its views (`FabricComponentsRegistry`, which adds to the shared provider registry and to every existing component registry), and `ExpoViewsPackage` (added to the package list by the plugin) answers React Native's on-demand lookup with the module's view manager. Its foreground and background hooks act on later transitions only, which is all they did for a module created after start.

Measured on the OVH emulator with `native-qa boot --warm 6 --cold 0`, a build without the three packages (`x-base`, APK 33.8 MB) against the final build (`x-fv14`, 38.8 MB), medians of the launches. The base's five runs were taken over the afternoon, the last two interleaved with the final build's two (base, final, base, final).

| | launches | `Running "main"` | Displayed (Start proc) | `[Svelte boot]` total |
|---|---|---|---|---|
| no foreign packages | 30 (5 runs) | 570 ms | 749 ms | 208 ms |
| packages started eagerly (first build, before the wrappers) | 6 | 604 ms | 738 ms | 178 ms |
| on demand (final) | 12 (2 runs) | 595 ms | 738 ms | 160 ms |

The first build, with the packages started eagerly, cost 35 ms of `Running "main"` over the base. The cause: React Native's JavaScript reads one `UIManager` property per view manager name a package announces, and each read creates that manager, so announcing the names was the cost. With empty announced names (`SvelteNativeOnDemandPackage`, `ExpoViewsPackage`) nothing of the three packages runs at start. The remaining difference in `Running "main"` is 25 ms (4 %) and lies inside the spread of one APK between runs (the 6-launch medians of the on-demand builds are 539 to 610 ms, the base's 561 to 610 ms); the displayed time and the JavaScript total do not move. The phone (Samsung A16) was not measured.


### Limits

- A foreign view lives in the frame's rectangle: a child that draws outside it (a map callout, a WebView's full-screen video) is the library's own window or overlay, not part of the engine's tree.
- `react-native-maps` tiles need a Google Maps API key in the manifest (`GOOGLE_MAPS_API_KEY`); the QA variant carries a placeholder, which mounts the map, makes it ready and loads no tiles.
- Not ported from the React components: the WebView's `renderLoading`/`renderError`/`startInLoadingState`/`nativeConfig`, the map's event payload conversions, `AnimatedRegion`, the React components of expo-video (`VideoView`'s methods: `enterFullscreen`, `startPictureInPicture`, are on the native view's prototype and reachable through the module, not through the handle).
- Each `MapView` the Google Maps SDK has shown stays reachable after its node is deleted (about 40 `View` objects; heap paths in "Verification on the OVH emulator"); the engine's and React Native's registries are clean, and WebViews and video views are released. An app that mounts maps without end grows by that amount.
- iOS: foreign views already mount through React Native's iOS mounting, which the engine does not replace there; `host.ts` and the view configs apply, nothing was compiled or run on iOS.
- A foreign root that is moved in the engine tree keeps its view (the second `Insert` is not forwarded); a root reparented across surfaces is not supported.
- Foreign views and engine overlays: a foreign view in a modal layer or a sheet works the same way (the layer is an engine view); a `SurfaceView` (video, map) is composed by the system and follows the platform's z-order inside the window, not the engine's `zIndex` against another `SurfaceView`.

### Verification on the OVH emulator

`node qa/native-qa.ts lab --device localhost:5555 --apk <apk> --run foreign-views --timeout 420` runs the scenario `foreign-views` (not part of `quick`; the page is `/__dev/foreign`, driven by `src/lib/native/dev/foreign-lab.ts`). It passes **38 of 38 checks** (run `qa/runs/lab-localhost_5555-20261026T151031Z.json`):

- **Inline**: the WebView loads its page and posts `ready:v1` through the messaging module, `onLoadEnd` arrives, a prop update (the source) reloads it (`ready:v2`), `injectJavaScript` runs in the page; the map becomes ready, `setCamera` moves the native camera and `getCamera` reads it back through `RNMapsAirModule`; the video renders its first frame and plays; the engine counts three frames, none waiting, four nodes owned by React Native. Touch: a tap on the WebView reaches the page and not JavaScript's touch dispatch; a tap on the video reaches the view (which reports it itself as a touch event of its own tag); a pan on the map reaches react-native-maps' view (`onPanDrag`) and neither it nor a tap on the map reaches JavaScript's dispatch; a tap on a plain `Pressable` beside them still does. Leaving the page returns frames, nodes and the registry to where they were.
- **List**: a windowed `List` of 24 rows of foreign views (WebView, map, video in turn): the first rows load, a tap in a row reaches its page, scrolling to the last row unmounts the first rows' views and scrolling back mounts fresh ones that load again; leaving drops everything.
- **Sheet**: a native sheet with the three views: they load, a tap reaches the page, closing drops everything.
- **Cycles**: 20 mounts and unmounts of each kind, one after the other: frames 0 to 0, nodes 0 to 0, registry leaks 0, 20 created and 20 deleted, the engine's own view count unchanged (99 to 99), all 20 ready; the WebView and video view objects are released after a collection (reachable 13 to 13 and 33 to 33).
- **End**: the router is back where it began and the engine and React Native hold no frame, node or registry entry.

`dumpsys meminfo` (`Views`, after each kind's 20 cycles, without a forced collection; `scratchpad/leak.sh`): 720 before the cycles, 797 after the WebViews (`WebViews` 3 to 0), 1658 after the maps, 1654 after the videos, 2386 after the maps without markers. `ViewRootImpl` 1 and `Activities` 1 throughout.

Frames, same run: p50 17 ms, p95 79 ms, 18.6 % dropped over 81.6 s: the scenario creates WebViews, a map renderer and a media codec in turn on a software-GPU emulator, so it carries no frame gate.

**Reported, not judged** (the scenario's `detail.observed`): on this emulator the Google map never moves its camera for a finger, never reports `onPress` for a tap, and never raises `onRegionChangeComplete` after a camera animation (`regionEvents` 0; the camera that `getCamera` returns after `animateToRegion` is unchanged). The placeholder Maps key fails authorization (`Authorization failure` in the log) and the legacy renderer of the emulator's Play services draws no tiles, so everything that needs the renderer's frames is unobserved here; the touch reaches the map view (`onPanDrag`, the hit-test dump `hit MapView, [MapView [FrameLayout [as ...]]]`) and real `adb input tap` events behave the same as the lab's. Run the scenario on a device with a real key to see the three observed values change.

**Map views stay reachable** (`observed` entry `cycle map view objects still reachable after a collection`, 13 to 33 after 20 cycles, and 33 to 53 for a map without its marker): the Google Maps SDK keeps every MapView it has shown. A heap dump taken after the cycles (`Debug.dumpHprofData`, Shark's shortest paths to all `com.rnmaps.maps.MapView` instances: 53 instances, 2 distinct paths) goes in both cases through Google classes only: (1) a thread (the map's vector renderer, `gmm6.vector.n`/`p`) to its GL view `gmm6.api.as`, whose parents are a `FrameLayout` and the `MapView`; (2) the window's `ViewTreeObserver.mOnGlobalLayoutListeners`, which holds `lib6.impl.cy` (the logo's layout listener, never removed), then the logo `ImageView`, `RelativeLayout`, `FrameLayout`, `as`, `internal.ai`/`dn`/`zzz` and react-native-maps' `MapView$7` (its `OnMapReadyCallback`) to the `MapView`. No path goes through the engine (frames, `EngineForeign`, `ForeignViews`, the registry), React Native's mounting manager or a view of ours; WebViews and videos, which take the same route through the engine, are released. About 40 `View` objects stay per map. Without a stock React Native control run this is the SDK's behavior as the heap shows it, not a measured difference between hosts.

**Pop of a screen with foreign views**: a screen recording of `router.back()` on the inline page (`scratchpad/popvideo.sh`) shows the WebView, the map and the video still drawn inside the sliding screen for the length of its exit.

**Not verified**: the Samsung A16, the iPhone and iOS in general (the host and the view configs are shared, nothing of this was compiled or run there), map tiles and the Google map's own gestures and events (need a Maps key), TalkBack on a foreign view, a WebView with a file or `content://` source, expo-video's fullscreen and picture-in-picture (`setPictureInPictureParams: Current activity does not support picture-in-picture` is logged by the system when the player is released, the activity does not declare it), `AnimatedRegion`-style map animation from JavaScript.

## Android wave 4 (26-27 October 2026, OVH emulator)

Measured on `localhost:5555` (x86_64, API 36, software GL), release builds, the harness commands of `apps/platform/qa`. Frame numbers on this emulator are not the bar; the results below are correctness, memory and JavaScript time.

### Native heap growth of the soak: cause and fix

**Before.** The 10-minute soak (all parts) grew the native heap (`Native Heap` Heap Alloc, the live malloc bytes) by +7.9 % (the evening's number) and +9.46 % with the idle windows below: JS heap +0.07 %, worklet runtime -0.04 %, 0 leaked views, 0 leaked emitters, 0 dead-tag writes. The floors of the idle windows (baseline, a checkpoint every two minutes, final) rose 58.6, 58.6, 59.3, 61.5, 63.6, 64.1 MB, 647 KB/min: a leak, not an allocator plateau. The 3-minute churn-only soak, the same build, gave +3.1 % and +3.6 % without a Java collection in the windows and +8.4 %, +8.4 %, +6.1 % with one, so the earlier "+5.4-5.9 %" was not a stable number: it moved by five points with whether the Java heap had been collected before the windows (unexplained: the collection lowered the baseline floor by 0.4 MB and raised the final one by 2.3 MB, the leak below was running in both). The windows now collect it, so that no window depends on when ART last ran.

**Measurement changes** (`apps/platform/qa/soak`, `Stress.svelte`): the idle windows collect this runtime, the worklet runtime (`gc()` on the UI thread, which left 14 MB of garbage and 463 KB live) and the Java heap (`SvelteEngine.collectJava()`), and the lab takes a checkpoint window every two minutes; `memory.native.slopeKbPerMin`, `memory.ui.growthPct` and `memory.leakedEmitters` are new metrics ("Stats for the soak runner"). The C++ delegate's tables were not the leak: `emitters` equalled `alive` (100 and 100) at every window.

**Attribution.** `heapprofd` cannot unwind this app's JavaScript thread; `malloc_debug` with backtraces can (`qa/soak/malloc-debug-soak.sh`, `qa/soak/heapdiff.py`, `qa/README.md` "Where a native growth comes from"). Heap dumps at the baseline window, the first checkpoint and the final window of a 7-minute soak: live allocations of 53.1 MB at the baseline and 52.3 MB at the end, so the leak is a few MB inside a heap that is otherwise stable, and one family of sites accounts for it, with the same live counts (about 1,300 more at the end than at the baseline, 1,696 / 3,392 in absolute terms): 537 KB at a Hermes host function in `libreactnative` that creates the nodes (416, 104 and 88 bytes each), 294 KB + 290 KB (112 bytes each) and 124 KB (a `folly::dynamic`'s hash storage, 768 bytes each) under `libreanimated.so!flush` <- `flushUpdates` <- `performOperations`, 115 KB at `UpdatesRegistry`'s `operator[]`. Those are the entries of Reanimated's `UpdatesRegistry::updatesRegistry_` (the last animated props of a node, with its `ShadowNodeFamily`).

**Cause.** `UpdatesRegistryManager::handleNodeRemovals` empties a node's entry once the node was marked removable (`markNodeAsRemovable`, called by the host in `detachAnimation`) and a mount finds it gone from the tree. A mapper's batch that was collected before the node left is flushed into the registry one frame later (`UpdatesRegistry::flush` -> `flushUpdatesToRegistry`, from `performOperations`), after the entry was emptied, and puts it back; nothing marks the node again, so the entry, its props and the family stay for the life of the process: about 1.4 KB for each removed tile that had an update pending, roughly one tile in ten in the churn scenario (the engine's `lateWrites` count the same race on the view side: 0.5 per deleted tile). It is Reanimated's race, present with React as well; the sink (`AnimatedBridge`) and the engine's registries do not take part.

**Fix.** `fabric/animation.ts`: `detachAnimation` marks the node removable now and once more 400 ms later (one shared timer; the next mount, which the soak and every app have within a frame, removes the late entry). A fix in the Reanimated patch (a tombstone of removed tags checked by `flushUpdatesToRegistry`) would stop the race at its source and is the better upstream change; this one needs no change to the patch and no assumption beyond "a mount follows".

**After.** 3-minute churn soak (same two runs): native growth -3.8 %, -3.9 % (`memory.native.slopeKbPerMin` -950, -946: the baseline window, taken after two warm-up cycles, holds the warm-up's allocations); 7-minute malloc dumps: the largest growing site 58 KB (537 KB before), the others below 50 KB (minikin's layout cache, Hermes); live 53.0 MB at the baseline, 50.1 MB at the end. 10-minute soak, all parts: `memory.heapGrowthPct` **0.08** (JS +0.08 %, worklet runtime -0.04 %, native -4.68 %), floors 59.4, 57.1, 55.7, 56.0, 56.2, 56.6 MB (after the first drop +0.13 MB/min), 0 leaked views, 0 leaked emitters, 0 dead-tag writes, 0 crashes.

**Plateau.** 30-minute soak, all parts, the same build, 116,778 views created and destroyed, checkpoint every two minutes: `memory.heapGrowthPct` **0.14** (JS +0.14 %, worklet runtime -0.04 %, native -4.08 %); the native floors after the first drop (59.3 MB at 0.9 min, 56.3 at 3.1) are 56.1-57.1 MB at all 13 later checkpoints and 56.9 MB at the end, +18 KB/min by least squares from the first checkpoint on (0.5 MB over 27 minutes, inside the checkpoints' own scatter of 0.4 MB); `Native Heap` size 102.4 -> 102.7 MB, Dalvik 5.5 -> 5.3 MB, 102 engine views and 102 emitters alive at every window, 0 leaked, 0 dead-tag writes, 0 crashes. What is left is not growing: the first drop is the warm-up's allocations (first-use caches, early garbage) that the baseline window, taken after two cycles, still holds.

The three changes the evening's number depended on (`reportMount` posted to the handler, `EventBeat.induce`, the accessibility click listener) were not bisected by build: one build's own result varied between +3.1 % and +8.4 % depending on what the windows collected, which is more than any of them could be told apart by; the allocation sites above do not involve them.

### Tab bar and header direction

`View.getLayoutDirection()` answers left to right until the view has been measured while attached, and a screen is measured and laid out detached at the end of its batch (`MountingManager.flushScreens`): the tab bar (`TabBar.onLayout`) kept the left-to-right order of its items on some launches until something else asked for a layout, while the items, resolved later, already drew their badges mirrored. `views/Direction.kt` (`View.isRtlLayout()`) reads `resources.configuration.layoutDirection` instead, which is the same for every view at once; `TabBar`, `TabItemView` and `EngineHeader` use it, the label of a tab item is rebuilt when the direction or the font scale it was built with changed, and on a configuration change. `TabItemView.onRtlPropertiesChanged` (added before) is gone. Measured: `/__dev/screens?mode=tabs`, 10 launches in Arabic and 10 in English, `adb exec-out screencap`, all screenshots of a direction identical (0 differing pixels outside the status bar); before the change 2 of 6 Arabic launches came up unmirrored (24,672 px). `parity --quick --filter screens-tabs` after `--update`: 0 px in all four variants, twice. The English references did not change outside the status bar band (masked): the 1 px "drift" of the shapes was not reproducible in 16 English launches (0 px between all of them), only the direction race was.

### TalkBack and the focus-trap check

TalkBack (`com.google.android.marvin.talkback`) is installed on the AVD (the README said it was not). A probe `AccessibilityService` (a 100-line scratch APK that logs `AccessibilityEvent`s and walks `getWindows()`, installed and removed by the session) ran next to it on the menu, sheet, auto-height sheet, form sheet and modal screens, with TalkBack's notification permission granted so that its dialog did not take the focus. Results, all from the node info a service receives:

- A service with the default flags (81: `flagDefault | flagReportViewIds | flagRetrieveInteractiveWindows`) receives, with a sheet or modal over the menu, 33 nodes, none of them labelled like the menu's buttons; over the plain menu it receives all 16 of those nodes. `uiautomator dump --compressed` is the same set (8 and 18 nodes for the sheet and modal screens against 54 and 75 in the default dump, which lists the covered screen).
- A service that also sets `flagIncludeNotImportantViews` (83) receives 155 and 156 nodes, 16 of them the menu's, every one `isImportantForAccessibility() == false` (the covered screen is `noHideDescendants` for services, `EngineStack.refresh` -> `EngineScreen.setA11yHidden`), so TalkBack's focus rule (visible and important and a screen reader target, actionable or speaking) yields 0 focusable nodes of the covered screen in both configurations.
- TalkBack's own first focus after the window changed went into the sheet's content (a `TextView` of the sheet) and into the modal's title ("Screen 1, Native header"). The injected swipes did not move its focus (see qa/README: gestures cannot be driven reliably), so a full walk of TalkBack's traversal was not recorded.

The engine is right; the oracle was wrong: the suite's 112 "focus leaks" were nodes of the full dump that a screen reader never visits. `qa/lib/a11y.ts` judges the focus trap on the `--compressed` dump, and a sheet titled like the button that opened it ("Form sheet") no longer counts its own title. Frozen dumps of the sheet and modal screens (`qa/test/samples/uia-screens-{sheet,modal}-{full,important}.xml`) pin it: the full dump leaks 7 of 7 labels, the walked tree 0. The other checks read the full dump until the same day's next emulator run, whose findings on the sheet and modal screens (an unlabeled stop, content before the sheet's title, stops out of order) were again the full dump's: it lists the sheet's scrim (`IMPORTANT_FOR_ACCESSIBILITY_NO` since the first commit, absent from the compressed dump) and the covered screen's buttons. Every check now reads the compressed dump.

### Resilience

`resilience --apk <build before these changes>`: 126 steps, 0 failed, the rotation (landscape and portrait x 5), font scale (2.0, 0.85, 1.0), locale, 100 background cycles and the two low-memory rounds included (the evening's fixes: `reportMount` posted off the batch, the overlay following `onHostResume`).

### Windowed list: where the mount to layout goes

Lab scenario `list-300-virtual-profile` (the gate's scenario with the host timing every flush) and a build that logs the C++ delegate's `pullTransaction` (encode and JNI, not kept): the first window (10 rows, 40 created nodes) is: Svelte before the host flush 2-6 ms, host flush 8-15 ms, of which `completeRoot` 4-15 ms (Fabric: Yoga, text measurement, Reanimated's commit hook, the differ), `createNode` 1.0-1.5 ms for 40 nodes, payloads 0.2-0.4 ms, `appendChild` 0.3-0.5 ms, the host's own bookkeeping 1.5-2.7 ms; the engine's delegate (`pullTransaction`: encode 0.1 ms, JNI 0.1 ms) is 2 % of `completeRoot`, and the UI-thread apply 1-3 ms. So the Svelte flush that the lab reports (about 11 ms on the A16) is mostly allocation in the JavaScript host plus Fabric's commit.

JavaScript changes (`renderer.ts`, `fabric/host.ts`, `fabric/view-configs.ts`): attributes are written into the node's own object until a snapshot was handed out (the renderer built a snapshot and copied the attribute object on every write), the host state is a field of `NativeNode` (a WeakMap lookup per flush before), colour conversions are cached (256 entries), the per-node loops (`wantsAnimation`, press handlers) allocate no closures and run no regular expression per key. Measured: V8 profile of 3,000 mounts, garbage collection 24 % before and 1 % after; emulator, release build, the first mount of the list in a fresh process, 10 interleaved pairs of lab runs: the JavaScript part (Svelte plus host flush) median 17.9 ms before, 9.1 ms after (range 10.0-45.7 and 8.1-16.3 ms; Mann-Whitney p < 0.001), mount to layout median 22.5 ms before and 16.6 ms after (p = 0.06 while another run loaded the host); steady state (40 mounts in one process, 4 runs each) median 7.85 ms before and 7.3 ms after. The A16 was not measured here (the bar is 10 ms on it: 12.6-13.9 ms before); `completeRoot` is Fabric's and the remaining lever is outside `host.ts`.
