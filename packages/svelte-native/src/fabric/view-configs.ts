/**
 * Static view configs and the prop payload builder for the views the Fabric host mounts itself.
 *
 * React Native encodes props for Fabric from a view config's `validAttributes` (which keys are native props and how a
 * value is converted) through `ReactNativeAttributePayload`. Loading that module and the native components that register
 * the configs costs about 50 ms of boot, so the host's own view names carry the tables below, equal to what React Native
 * 0.86 registers on Android and iOS (`tests/view-configs.test.ts` compares them with React Native's own modules). A name
 * outside the tables, from a third-party native component, takes React Native's registry and payload code, required on
 * first use.
 *
 * The payload holds only native props: style arrays are flattened (a later entry wins), conversions run (colours become
 * ARGB integers), functions become `true`, and an update carries the keys whose encoded value changed, `null` for a removed
 * one. React Native's nested-array diff repeats a key that moved between style entries without changing; this builder
 * compares the flattened result, so it omits such a key, and the native side ends with the same props.
 */
export type Platform = "android" | "ios";
export type Payload = Record<string, unknown>;
type Props = Record<string, unknown>;
type Converter = (value: unknown) => unknown;
/** `true` sends the value as given, a function converts it first, and a table (`style`) holds attributes of its own. */
type Attribute = true | Converter | Table;
interface Table { [name: string]: Attribute }
export type ViewConfig = {
  readonly attributes: Table;
  /** The registration name of every event the view emits, by native event type (`topChange` to `onChange`). */
  readonly events: ReadonlyMap<string, string>;
  /** Taken from React Native's registry: its own payload code applies. */
  readonly foreign: boolean;
};

const dev = (): boolean => typeof __DEV__ !== "undefined" && __DEV__;

/* eslint-disable @typescript-eslint/no-require-imports */
const required = (load: () => Converter): Converter => {
  let converter: Converter | undefined;
  return (value) => {
    converter ??= load();
    return converter(value);
  };
};
const reactNativeColor = required(() => require("react-native/Libraries/StyleSheet/processColor").default);
const reactNativeAspectRatio = required(() => require("react-native/Libraries/StyleSheet/processAspectRatio").default);
const reactNativeFontVariant = required(() => require("react-native/Libraries/StyleSheet/processFontVariant").default);
const reactNativeTransform = required(() => require("react-native/Libraries/StyleSheet/processTransform").default);
const reactNativeTransformOrigin = required(() => require("react-native/Libraries/StyleSheet/processTransformOrigin").default);
const filter = required(() => require("react-native/Libraries/StyleSheet/processFilter").default);
const boxShadow = required(() => require("react-native/Libraries/StyleSheet/processBoxShadow").default);
const backgroundImage = required(() => require("react-native/Libraries/StyleSheet/processBackgroundImage").default);
const backgroundSize = required(() => require("react-native/Libraries/StyleSheet/processBackgroundSize").default);
const backgroundPosition = required(() => require("react-native/Libraries/StyleSheet/processBackgroundPosition").default);
const backgroundRepeat = required(() => require("react-native/Libraries/StyleSheet/processBackgroundRepeat").default);
const assetSource = required(() => require("react-native/Libraries/Image/resolveAssetSource").default);
type RegistryModule = {
  get(name: string): {
    validAttributes: Table;
    bubblingEventTypes?: Record<string, { phasedRegistrationNames?: { bubbled?: string } }>;
    directEventTypes?: Record<string, { registrationName?: string }>;
  };
};
type PayloadModule = { create(props: Props, attributes: Table): Payload | null; diff(previous: Props, next: Props, attributes: Table): Payload | null };
const registry = (): RegistryModule => require("react-native/Libraries/Renderer/shims/ReactNativeViewConfigRegistry");
const reactNativePayload = (): PayloadModule => require("react-native/Libraries/ReactNative/ReactFabricPublicInstance/ReactNativeAttributePayload");
/* eslint-enable @typescript-eslint/no-require-imports */

const HEX = /^#([0-9a-fA-F]{3,4}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/;
const NUMBER = "([-+]?\\d*\\.?\\d+)";
const RGB = new RegExp(`^rgba?\\(\\s*${NUMBER}\\s*,\\s*${NUMBER}\\s*,\\s*${NUMBER}\\s*(?:,\\s*${NUMBER}\\s*)?\\)$`);
const channel = (text: string): number => Math.min(255, Math.max(0, parseInt(text, 10)));
const alpha = (text: string): number => { const number = parseFloat(text); return number < 0 ? 0 : number > 1 ? 255 : Math.round(number * 255); };

/** `0xRRGGBBAA` for the colour spellings the app uses (hex, comma-separated `rgb()`/`rgba()`); React Native's normalizer handles every other. */
function rgba(color: string): number | undefined {
  const hex = HEX.exec(color);
  if (hex) {
    let digits = hex[1];
    if (digits.length < 6) digits = digits.replace(/./g, "$&$&");
    return parseInt(digits.length === 6 ? `${digits}ff` : digits, 16) >>> 0;
  }
  const rgb = RGB.exec(color);
  if (rgb) return ((channel(rgb[1]) << 24) | (channel(rgb[2]) << 16) | (channel(rgb[3]) << 8) | (rgb[4] === undefined ? 255 : alpha(rgb[4]))) >>> 0;
  return undefined;
}

/** `processColor`: ARGB, a signed 32-bit integer on Android. */
const processColorFor = (platform: Platform): Converter => (color) => {
  if (color === undefined || color === null) return color;
  const known = typeof color === "number" ? (color >>> 0 === color ? color : null) : typeof color === "string" ? rgba(color) : undefined;
  if (known === undefined) return reactNativeColor(color);
  if (known === null) return undefined;
  const argb = ((known << 24) | (known >>> 8)) >>> 0;
  return platform === "android" ? argb | 0 : argb;
};

const COLOR_CACHE_LIMIT = 256;
/** A text colour is converted by regular expressions and `parseInt`; a list repeats the same few strings on every row, so the answer for a string is kept (bounded, emptied when full). */
const colorFor = (platform: Platform): Converter => {
  const convert = processColorFor(platform);
  const cache = new Map<string, unknown>();
  return (color) => {
    if (typeof color !== "string") return convert(color);
    if (cache.has(color)) return cache.get(color);
    const result = convert(color);
    if (cache.size >= COLOR_CACHE_LIMIT) cache.clear();
    cache.set(color, result);
    return result;
  };
};

/** Arrays pass as they are (React Native only validates them in development); strings go through React Native's parser. */
const arrayOr = (convert: Converter): Converter => (value) => (Array.isArray(value) && !dev() ? value : convert(value));
const transform = arrayOr(reactNativeTransform);
const transformOrigin = arrayOr(reactNativeTransformOrigin);
const aspectRatio: Converter = (value) => (typeof value === "number" ? value : reactNativeAspectRatio(value));
const fontVariant: Converter = (value) => (Array.isArray(value) ? value : reactNativeFontVariant(value));

/** An array of colours, each converted as a colour attribute is; anything else passes (a native view rejects it itself). */
const colorList = (color: Converter): Converter => (value) => (Array.isArray(value) ? value.map((item: unknown) => color(item)) : value);
/** An array of structs whose [field] is a colour. */
const colorStructs = (color: Converter, field: string): Converter => (value) =>
  Array.isArray(value) ? value.map((item: unknown) => (item !== null && typeof item === "object" ? { ...(item as Props), [field]: color((item as Props)[field]) } : item)) : value;

/** `processColor` for a platform: the ARGB integer a native view takes for a colour prop (an Android integer is signed). */
export function processColorValue(color: unknown, platform: Platform): unknown {
  colorConverters[platform] ??= colorFor(platform);
  return colorConverters[platform](color);
}
const colorConverters: Partial<Record<Platform, Converter>> = {};

const table = (): Table => Object.create(null) as Table;
function fill(into: Table, names: string, attribute: Attribute): void {
  for (const name of names.split(/\s+/)) if (name) into[name] = attribute;
}

const viewPlain = `
    accessibilityActions accessibilityHint accessibilityLabel accessibilityRole accessibilityState accessibilityValue
    accessible alignContent alignItems alignSelf aria-busy aria-checked aria-disabled aria-expanded aria-hidden
    aria-label aria-labelledby aria-live aria-selected aria-valuemax aria-valuemin aria-valuenow aria-valuetext
    aspectRatio backfaceVisibility borderBottomEndRadius borderBottomLeftRadius borderBottomRightRadius
    borderBottomStartRadius borderBottomWidth borderEndEndRadius borderEndStartRadius borderEndWidth borderLeftWidth
    borderRadius borderRightWidth borderStartEndRadius borderStartStartRadius borderStartWidth borderStyle
    borderTopEndRadius borderTopLeftRadius borderTopRightRadius borderTopStartRadius borderTopWidth borderWidth bottom
    boxSizing collapsable collapsableChildren columnGap display end experimental_accessibilityOrder flex flexBasis
    flexDirection flexGrow flexShrink flexWrap focusable gap height hitSlop id inset insetBlock insetBlockEnd
    insetBlockStart insetInline insetInlineEnd insetInlineStart isolation justifyContent left margin marginBlock
    marginBlockEnd marginBlockStart marginBottom marginEnd marginHorizontal marginInline marginInlineEnd
    marginInlineStart marginLeft marginRight marginStart marginTop marginVertical maxHeight maxWidth minHeight
    minWidth mixBlendMode nativeID needsOffscreenAlphaCompositing onClick onClickCapture onLayout
    onMoveShouldSetResponder onMoveShouldSetResponderCapture onPointerEnter onPointerLeave onPointerMove onPointerOut
    onPointerOver onResponderEnd onResponderGrant onResponderMove onResponderReject onResponderRelease
    onResponderStart onResponderTerminate onResponderTerminationRequest onShouldBlockNativeResponder
    onStartShouldSetResponder onStartShouldSetResponderCapture onTouchCancel onTouchEnd onTouchMove onTouchStart
    opacity overflow padding paddingBlock paddingBlockEnd paddingBlockStart paddingBottom paddingEnd paddingHorizontal
    paddingInline paddingInlineEnd paddingInlineStart paddingLeft paddingRight paddingStart paddingTop paddingVertical
    pointerEvents position removeClippedSubviews right role rowGap start tabIndex testID top transform transformOrigin
    width zIndex
  `;
const androidViewPlain = `
    accessibilityCollection accessibilityCollectionItem accessibilityLabelledBy accessibilityLiveRegion elevation
    hasTVPreferredFocus importantForAccessibility nativeBackgroundAndroid nativeForegroundAndroid nextFocusDown
    nextFocusForward nextFocusLeft nextFocusRight nextFocusUp onPointerEnterCapture onPointerLeaveCapture
    onPointerMoveCapture onPointerOutCapture onPointerOverCapture outlineOffset outlineStyle outlineWidth
    renderToHardwareTextureAndroid rotation scaleX scaleY screenReaderFocusable translateX translateY
  `;
const iosViewPlain = `
    accessibilityElementsHidden accessibilityIgnoresInvertColors accessibilityLanguage accessibilityLargeContentTitle
    accessibilityRespondsToUserInteraction accessibilityShowsLargeContentViewer accessibilityViewIsModal
    borderBlockEndWidth borderBlockStartWidth borderBlockWidth borderCurve cursor direction onAccessibilityAction
    onAccessibilityEscape onAccessibilityTap onGotPointerCapture onLostPointerCapture onMagicTap onPointerCancel
    onPointerDown onPointerUp shadowOffset shadowOpacity shadowRadius shouldRasterizeIOS
  `;
const viewColors = `
    backgroundColor borderBlockColor borderBlockEndColor borderBlockStartColor borderBottomColor borderColor
    borderEndColor borderLeftColor borderRightColor borderStartColor borderTopColor shadowColor
  `;
const stylePlain = `
    alignContent alignItems alignSelf backfaceVisibility borderBottomEndRadius borderBottomLeftRadius
    borderBottomRightRadius borderBottomStartRadius borderBottomWidth borderCurve borderEndEndRadius
    borderEndStartRadius borderEndWidth borderLeftWidth borderRadius borderRightWidth borderStartEndRadius
    borderStartStartRadius borderStartWidth borderStyle borderTopEndRadius borderTopLeftRadius borderTopRightRadius
    borderTopStartRadius borderTopWidth borderWidth bottom boxSizing columnGap cursor direction display elevation end
    flex flexBasis flexDirection flexGrow flexShrink flexWrap fontFamily fontSize fontStyle fontWeight gap height
    includeFontPadding inset insetBlock insetBlockEnd insetBlockStart insetInline insetInlineEnd insetInlineStart
    isolation justifyContent left letterSpacing lineHeight margin marginBlock marginBlockEnd marginBlockStart
    marginBottom marginEnd marginHorizontal marginInline marginInlineEnd marginInlineStart marginLeft marginRight
    marginStart marginTop marginVertical maxHeight maxWidth minHeight minWidth mixBlendMode objectFit opacity
    outlineOffset outlineStyle outlineWidth overflow padding paddingBlock paddingBlockEnd paddingBlockStart
    paddingBottom paddingEnd paddingHorizontal paddingInline paddingInlineEnd paddingInlineStart paddingLeft
    paddingRight paddingStart paddingTop paddingVertical pointerEvents position resizeMode right rowGap shadowOffset
    shadowOpacity shadowRadius start textAlign textAlignVertical textDecorationLine textDecorationStyle
    textShadowOffset textShadowRadius textTransform top userSelect verticalAlign width writingDirection zIndex
  `;
const styleColors = `
    backgroundColor borderBlockColor borderBlockEndColor borderBlockStartColor borderBottomColor borderColor
    borderEndColor borderLeftColor borderRightColor borderStartColor borderTopColor color outlineColor overlayColor
    shadowColor textDecorationColor textShadowColor tintColor
  `;
const androidEvents = `
    onGestureHandlerEvent onGestureHandlerStateChange topAccessibilityAction topBlur topChange topClick
    topContentSizeChange topFocus topKeyDown topKeyUp topLayout topLoadingError topLoadingFinish topLoadingStart
    topMessage topMomentumScrollBegin topMomentumScrollEnd topPointerCancel topPointerDown topPointerEnter
    topPointerLeave topPointerMove topPointerOut topPointerOver topPointerUp topScroll topScrollBeginDrag
    topScrollEndDrag topSelect topSelectionChange topTouchCancel topTouchEnd topTouchMove topTouchStart
  `;
const iosEvents = `
    onGestureHandlerEvent onGestureHandlerStateChange topAccessibilityAction topAccessibilityEscape
    topAccessibilityTap topBlur topChange topClick topEndEditing topFocus topGotPointerCapture topKeyPress topLayout
    topLostPointerCapture topMagicTap topPointerCancel topPointerDown topPointerEnter topPointerLeave topPointerMove
    topPointerOut topPointerOver topPointerUp topPress topSubmitEditing topTouchCancel topTouchEnd topTouchMove
    topTouchStart
  `;

/**
 * What a view adds to `RCTView`'s attributes and events. `assetSources` are attributes React Native resolves through
 * `resolveAssetSource`; `colorLists` hold an array of colours (a gradient's `colors`, converted one by one); `colorStructs`
 * name the colour field of each struct in an array attribute (Lottie's `colorFilters` are `{ keypath, color }`).
 */
export type Kind = { plain?: string; colors?: string; events?: string; assetSources?: string; colorLists?: string; colorStructs?: Record<string, string> };

/**
 * Third-party native components the engine mounts through React Native's own mounting (SPEC.md, "Foreign views"). `plain`
 * and `colors` are the props the library's codegen spec declares (its generated view config validates exactly those, plus a
 * view's own), `events` the events its native emitter sends (`tests/foreign.test.ts` compares both with the specs). The
 * event handler props (`onPress`) are not attributes, as in the generated configs: handlers stay in JavaScript.
 */
const foreignKinds: Record<string, Kind> = {
  // react-native-webview 13.16
  RNCWebView: {
    plain: `
      allowFileAccess allowFileAccessFromFileURLs allowUniversalAccessFromFileURLs allowingReadAccessToURL
      allowsAirPlayForMediaPlayback allowsBackForwardNavigationGestures allowsFullscreenVideo allowsInlineMediaPlayback
      allowsLinkPreview allowsPictureInPictureMediaPlayback allowsProtectedMedia androidLayerType
      applicationNameForUserAgent autoManageStatusBarEnabled automaticallyAdjustContentInsets basicAuthCredential
      bounces cacheEnabled cacheMode contentInset contentInsetAdjustmentBehavior contentMode dataDetectorTypes
      decelerationRate directionalLockEnabled domStorageEnabled downloadingMessage enableApplePay forceDarkOn
      fraudulentWebsiteWarningEnabled geolocationEnabled hasOnFileDownload hasOnOpenWindowEvent hasOnScroll
      hideKeyboardAccessoryView incognito indicatorStyle injectedJavaScript injectedJavaScriptBeforeContentLoaded
      injectedJavaScriptBeforeContentLoadedForMainFrameOnly injectedJavaScriptForMainFrameOnly injectedJavaScriptObject
      javaScriptCanOpenWindowsAutomatically javaScriptEnabled keyboardDisplayRequiresUserAction
      lackPermissionToDownloadMessage limitsNavigationsToAppBoundDomains mediaCapturePermissionGrantType
      mediaPlaybackRequiresUserAction menuItems messagingEnabled messagingModuleName minimumFontSize mixedContentMode
      nestedScrollEnabled newSource overScrollMode pagingEnabled paymentRequestEnabled pullToRefreshEnabled
      refreshControlLightMode saveFormDataDisabled scalesPageToFit scrollEnabled setBuiltInZoomControls
      setDisplayZoomControls setSupportMultipleWindows sharedCookiesEnabled showsHorizontalScrollIndicator
      showsVerticalScrollIndicator suppressMenuItems textInteractionEnabled textZoom thirdPartyCookiesEnabled
      useSharedProcessPool userAgent webviewDebuggingEnabled
    `,
    events: `
      topContentProcessDidTerminate topContentSizeChange topCustomMenuSelection topFileDownload topHttpError
      topLoadingError topLoadingFinish topLoadingProgress topLoadingStart topLoadingSubResourceError topMessage
      topOpenWindow topRenderProcessGone topScroll topShouldStartLoadWithRequest
    `,
  },
  // react-native-maps 1.27
  RNMapsMapView: {
    plain: `
      appleLogoInsets cacheEnabled camera cameraZoomRange compassOffset customMapStyleString followsUserLocation googleMapId
      googleRenderer handlePanDrag initialCamera initialRegion kmlSrc legalLabelInsets liteMode loadingEnabled mapPadding
      mapType maxDelta maxZoom minDelta minZoom moveOnMarkerPress paddingAdjustmentBehavior pitchEnabled poiClickEnabled
      pointsOfInterestFilter region rotateEnabled scrollDuringRotateOrZoomEnabled scrollEnabled showsBuildings
      showsCompass showsIndoorLevelPicker showsIndoors showsMyLocationButton showsPointsOfInterests showsScale
      showsTraffic showsUserLocation toolbarEnabled userInterfaceStyle userLocationAnnotationTitle
      userLocationCalloutEnabled userLocationFastestInterval userLocationPriority userLocationUpdateInterval
      zoomControlEnabled zoomEnabled zoomTapEnabled
    `,
    colors: "loadingBackgroundColor loadingIndicatorColor tintColor",
    events: `
      topCalloutPress topDoublePress topIndoorBuildingFocused topIndoorLevelActivated topKmlReady topLongPress
      topMapLoaded topMapReady topMarkerDeselect topMarkerDrag topMarkerDragEnd topMarkerDragStart topMarkerPress
      topMarkerSelect topPanDrag topPoiClick topPress topRegionChange topRegionChangeComplete topRegionChangeStart
      topUserLocationChange
    `,
  },
  RNMapsMarker: {
    plain: `
      anchor calloutAnchor calloutOffset centerOffset coordinate description displayPriority draggable identifier
      isPreselected opacity subtitleVisibility title titleVisibility tracksViewChanges useLegacyPinView
    `,
    colors: "pinColor",
    assetSources: "image",
    events: "topCalloutPress topDeselect topDrag topDragEnd topDragStart topPress topSelect",
  },
  // react-native-video 6.19: a legacy view manager (`requireNativeComponent("RCTVideo")`, no codegen), mounted through React Native's Fabric interop
  RCTVideo: {
    plain: `
      allowsExternalPlayback audioOutput automaticallyWaitsToMinimizeStalling bufferingStrategy controls controlsStyles
      currentPlaybackTime debug disableAudioSessionManagement disableDisconnectError disableFocus
      enterPictureInPictureOnLeave filter filterEnabled focusable fullscreen fullscreenAutorotate fullscreenOrientation
      hideShutterView ignoreSilentSwitch maxBitRate mixWithOthers muted paused playInBackground playWhenInactive
      preferredForwardBufferDuration preventsDisplaySleepDuringVideoPlayback progressUpdateInterval rate repeat
      reportBandwidth resizeMode restoreUserInterfaceForPIPStopCompletionHandler selectedAudioTrack selectedTextTrack
      selectedVideoTrack showNotificationControls src subtitleStyle viewType volume
    `,
    colors: "shutterColor",
    events: `
      topAudioFocusChanged topAudioTracks topControlsVisibilityChange topGetLicense topPictureInPictureStatusChanged
      topPlaybackRateChange topReadyForDisplay topReceiveAdEvent topRestoreUserInterfaceForPictureInPictureStop
      topTextTrackDataChanged topTextTracks topTimedMetadata topVideoAspectRatio topVideoAudioBecomingNoisy
      topVideoBandwidthUpdate topVideoBuffer topVideoEnd topVideoError topVideoExternalPlaybackChange
      topVideoFullscreenPlayerDidDismiss topVideoFullscreenPlayerDidPresent topVideoFullscreenPlayerWillDismiss
      topVideoFullscreenPlayerWillPresent topVideoIdle topVideoLoad topVideoLoadStart topVideoPlaybackStateChanged
      topVideoProgress topVideoSeek topVideoTracks topVolumeChange
    `,
  },
  // @react-native-community/datetimepicker 9.1: a Fabric component on iOS only (the Android pickers are dialogs opened through TurboModules)
  RNDateTimePicker: {
    plain: "date displayIOS enabled locale maximumDate minimumDate minuteInterval mode themeVariant timeZoneName timeZoneOffsetInMinutes",
    colors: "accentColor textColor",
    events: "topChange topPickerDismiss",
  },
  // lottie-react-native 7.3
  LottieAnimationView: {
    plain: `
      autoPlay cacheComposition dummy enableMergePathsAndroidForKitKatAndAbove enableSafeModeAndroid
      hardwareAccelerationAndroid imageAssetsFolder loop progress renderMode resizeMode sourceDotLottieURI sourceJson
      sourceName sourceURL speed textFiltersAndroid textFiltersIOS
    `,
    colorStructs: { colorFilters: "color" },
    events: "topAnimationFailure topAnimationFinish topAnimationLoaded",
  },
  // react-native-pdf 7: a codegen component on both platforms; one bubbling event, `topChange`, whose message is a string (`foreign-pdf.ts`)
  RNPDFPdfView: {
    plain: `
      enableAnnotationRendering enableAntialiasing enableDoubleTapZoom enablePaging enableRTL fitPolicy horizontal maxScale
      minScale page password path scale scrollEnabled showsHorizontalScrollIndicator showsVerticalScrollIndicator singlePage spacing
    `,
  },
  // rive-react-native 9.7: a legacy view manager like RCTVideo; its events are the manager's direct events (`onPlay` reaches JavaScript as `topPlay`)
  RiveReactNativeView: {
    plain: `
      alignment animationName artboardName autoplay dataBinding fit isUserHandlingErrors layoutScaleFactor referencedAssets
      resourceName stateMachineName url
    `,
    events: "topError topLoopEnd topPause topPlay topRiveEventReceived topStateChanged topStop",
  },
  // react-native-fast-shadow 0.1 (Android): a `ReactViewManager` whose view draws a blurred shadow behind its own background; the shadow props are top-level here
  FastShadowView: {
    plain: "cornerRadii shadowOffset shadowOpacity shadowRadius",
  },
  // react-native-animateable-text 0.19: a `Text` whose string is the `text` prop (the library's own view config, `AnimateableText.tsx`)
  JBAnimatedText: {
    plain: `
      adjustsFontSizeToFit allowFontScaling android_hyphenationFrequency dataDetectorType disabled dynamicTypeRamp ellipsizeMode
      isHighlighted isPressable lineBreakStrategyIOS maxFontSizeMultiplier minimumFontScale numberOfLines onInlineViewLayout
      onTextLayout selectable text textBreakStrategy
    `,
    colors: "selectionColor",
    events: "topInlineViewLayout topTextLayout",
  },
};

const kinds: Record<Platform, Record<string, Kind>> = {
  android: {
    RCTView: {},
    RCTText: {
      plain: `
        adjustsFontSizeToFit allowFontScaling android_hyphenationFrequency dataDetectorType disabled dynamicTypeRamp
        ellipsizeMode isHighlighted isPressable lineBreakStrategyIOS maxFontSizeMultiplier minimumFontScale
        numberOfLines onTextLayout selectable selectionColor textBreakStrategy
      `,
      events: "topTextLayout",
    },
    RCTVirtualText: {
      plain: "isHighlighted isPressable maxFontSizeMultiplier",
    },
    RCTScrollView: {
      plain: `
        contentOffset decelerationRate disableIntervalMomentum fadingEdgeLength horizontal isInvertedVirtualizedList
        maintainVisibleContentPosition nestedScrollEnabled overScrollMode pagingEnabled persistentScrollbar
        scrollEnabled scrollEventThrottle scrollPerfTag scrollsChildToFocus sendMomentumEvents
        showsVerticalScrollIndicator snapToAlignment snapToEnd snapToInterval snapToOffsets snapToStart
      `,
      colors: "endFillColor",
    },
    AndroidTextInput: {
      plain: `
        acceptDragAndDropTypes adjustsFontSizeToFit allowFontScaling autoCapitalize autoComplete autoCorrect autoFocus
        caretHidden contextMenuHidden disableFullscreenUI editable fontFamily fontSize fontStyle fontVariant
        fontWeight importantForAutofill includeFontPadding inlineImageLeft inlineImagePadding keyboardType
        letterSpacing lineHeight maxFontSizeMultiplier maxLength minimumFontScale mostRecentEventCount multiline
        numberOfLines onContentSizeChange onKeyPress onScroll onSelectionChange placeholder returnKeyLabel
        returnKeyType secureTextEntry selectTextOnFocus showSoftInputOnFocus submitBehavior text textAlign
        textAlignVertical textBreakStrategy textDecorationLine textShadowOffset textShadowRadius textTransform
      `,
      colors: `
        color cursorColor placeholderTextColor selectionColor selectionHandleColor textShadowColor
        underlineColorAndroid
      `,
      events: "topEndEditing topKeyPress topSubmitEditing",
    },
    RCTImageView: {
      plain: `
        blurRadius defaultSource fadeDuration headers internal_analyticTag loadingIndicatorSrc
        progressiveRenderingEnabled resizeMethod resizeMode resizeMultiplier shouldNotifyLoadEvents source src
      `,
      colors: "overlayColor tintColor",
      events: "topError topLoad topLoadEnd topLoadStart topProgress",
    },
    AndroidSwitch: {
      plain: "disabled enabled on value",
      colors: "thumbColor thumbTintColor trackColorForFalse trackColorForTrue trackTintColor",
    },
    AndroidProgressBar: {
      plain: "animating indeterminate progress styleAttr typeAttr",
      colors: "color",
    },
    RCTModalHostView: {
      plain: `
        allowSwipeDismissal animated animationType hardwareAccelerated identifier navigationBarTranslucent
        presentationStyle statusBarTranslucent supportedOrientations transparent visible
      `,
      events: "topDismiss topOrientationChange topRequestClose topShow",
    },
    RCTSafeAreaView: {},
    ...foreignKinds,
  },
  ios: {
    RCTView: {},
    // The iOS screen components (modules/svelte-screens-ios) take the same props as a view plus their own events, so the
    // first screen does not need React Native's view-config registry at boot.
    SvelteStack: {},
    SvelteScreen: { events: "topAppear topDisappear topDismissed topDetentChange" },
    SvelteHeader: { events: "topMetrics" },
    SvelteHeaderSlot: { events: "topCancel topChange topSubmitEditing" },
    SvelteTabs: { events: "topSelect topMetrics" },
    SvelteTab: {},
    SvelteToolbar: { events: "topPress topMetrics" },
    SvelteToolbarItem: {},
    SvelteToolbarCenter: {},
    RCTText: {
      plain: `
        adjustsFontSizeToFit allowFontScaling android_hyphenationFrequency dataDetectorType disabled dynamicTypeRamp
        ellipsizeMode isHighlighted isPressable lineBreakStrategyIOS maxFontSizeMultiplier minimumFontScale
        numberOfLines onTextLayout selectable selectionColor textBreakStrategy
      `,
      events: "topTextLayout",
    },
    RCTVirtualText: {
      plain: "isHighlighted isPressable maxFontSizeMultiplier",
    },
    RCTScrollView: {
      plain: `
        alwaysBounceHorizontal alwaysBounceVertical automaticallyAdjustContentInsets automaticallyAdjustKeyboardInsets
        automaticallyAdjustsScrollIndicatorInsets bounces bouncesZoom canCancelContentTouches centerContent
        contentInset contentInsetAdjustmentBehavior contentOffset decelerationRate directionalLockEnabled
        disableIntervalMomentum endDraggingSensitivityMultiplier indicatorStyle inverted keyboardDismissMode
        maintainVisibleContentPosition maximumZoomScale minimumZoomScale onMomentumScrollBegin onMomentumScrollEnd
        onScroll onScrollBeginDrag onScrollEndDrag onScrollToTop pagingEnabled pinchGestureEnabled scrollEnabled
        scrollEventThrottle scrollIndicatorInsets scrollToOverflowEnabled scrollsToTop showsHorizontalScrollIndicator
        showsVerticalScrollIndicator snapToAlignment snapToEnd snapToInterval snapToOffsets snapToStart
        verticalScrollIndicatorInsets zoomScale
      `,
      events: `
        topMomentumScrollBegin topMomentumScrollEnd topScroll topScrollBeginDrag topScrollEndDrag topScrollToTop
      `,
    },
    RCTSinglelineTextInputView: {
      plain: `
        acceptDragAndDropTypes allowFontScaling autoCapitalize autoCorrect autoFocus caretHidden clearButtonMode
        clearTextOnFocus contextMenuHidden disableKeyboardShortcuts dynamicTypeRamp editable
        enablesReturnKeyAutomatically fontFamily fontSize fontStyle fontVariant fontWeight
        inputAccessoryViewButtonLabel inputAccessoryViewID isHighlighted keyboardAppearance keyboardType letterSpacing
        lineBreakModeIOS lineBreakStrategyIOS lineHeight maxFontSizeMultiplier maxLength mostRecentEventCount
        multiline numberOfLines onChange onChangeSync onContentSizeChange onKeyPressSync onScroll onSelectionChange
        passwordRules placeholder returnKeyType scrollEnabled secureTextEntry selectTextOnFocus selection
        showSoftInputOnFocus smartInsertDelete spellCheck submitBehavior text textAlign textContentType
        textDecorationLine textDecorationStyle textShadowOffset textShadowRadius textTransform writingDirection
      `,
      colors: "color placeholderTextColor selectionColor textDecorationColor textShadowColor",
      events: "topChangeSync topContentSizeChange topKeyPressSync topScroll topSelectionChange",
    },
    RCTMultilineTextInputView: {
      plain: `
        acceptDragAndDropTypes allowFontScaling autoCapitalize autoCorrect autoFocus caretHidden clearButtonMode
        clearTextOnFocus contextMenuHidden dataDetectorTypes disableKeyboardShortcuts dynamicTypeRamp editable
        enablesReturnKeyAutomatically fontFamily fontSize fontStyle fontVariant fontWeight
        inputAccessoryViewButtonLabel inputAccessoryViewID isHighlighted keyboardAppearance keyboardType letterSpacing
        lineBreakModeIOS lineBreakStrategyIOS lineHeight maxFontSizeMultiplier maxLength mostRecentEventCount
        multiline numberOfLines onChange onChangeSync onContentSizeChange onKeyPressSync onScroll onSelectionChange
        passwordRules placeholder returnKeyType scrollEnabled secureTextEntry selectTextOnFocus selection
        showSoftInputOnFocus smartInsertDelete spellCheck submitBehavior text textAlign textContentType
        textDecorationLine textDecorationStyle textShadowOffset textShadowRadius textTransform writingDirection
      `,
      colors: "color placeholderTextColor selectionColor textDecorationColor textShadowColor",
      events: "topChangeSync topContentSizeChange topKeyPressSync topScroll topSelectionChange",
    },
    RCTImageView: {
      plain: `
        blurRadius capInsets internal_analyticTag onError onLoad onLoadEnd onLoadStart onPartialLoad onProgress
        resizeMode source
      `,
      colors: "tintColor",
      events: "topError topLoad topLoadEnd topLoadStart topPartialLoad topProgress",
      assetSources: "defaultSource",
    },
    RCTSwitch: {
      plain: "disabled onChange value",
      colors: "onTintColor thumbColor thumbTintColor tintColor trackColorForFalse trackColorForTrue",
    },
    RCTActivityIndicatorView: {
      plain: "animating hidesWhenStopped size",
      colors: "color",
    },
    RCTModalHostView: {
      plain: `
        allowSwipeDismissal animated animationType hardwareAccelerated identifier navigationBarTranslucent onDismiss
        onOrientationChange onRequestClose onShow presentationStyle statusBarTranslucent supportedOrientations
        transparent visible
      `,
      events: "topDismiss topOrientationChange topRequestClose topShow",
    },
    RCTSafeAreaView: {},
    ...foreignKinds,
  },
};

const styles: Partial<Record<Platform, Table>> = {};
function styleFor(platform: Platform): Table {
  const color = colorFor(platform);
  const style = table();
  fill(style, stylePlain, true);
  fill(style, styleColors, color);
  Object.assign(style, {
    aspectRatio, transform, transformOrigin, fontVariant, filter, boxShadow,
    experimental_backgroundImage: backgroundImage, experimental_backgroundSize: backgroundSize,
    experimental_backgroundPosition: backgroundPosition, experimental_backgroundRepeat: backgroundRepeat,
  });
  return style;
}

function attributesFor(platform: Platform, kind: Kind): Table {
  const color = colorFor(platform);
  const attributes = table();
  fill(attributes, viewPlain, true);
  fill(attributes, platform === "android" ? androidViewPlain : iosViewPlain, true);
  fill(attributes, viewColors, color);
  attributes.filter = filter;
  attributes.boxShadow = boxShadow;
  if (platform === "android") {
    attributes.outlineColor = color;
    attributes.experimental_backgroundImage = backgroundImage;
    attributes.experimental_backgroundSize = backgroundSize;
    attributes.experimental_backgroundPosition = backgroundPosition;
    attributes.experimental_backgroundRepeat = backgroundRepeat;
  }
  fill(attributes, kind.plain ?? "", true);
  fill(attributes, kind.colors ?? "", color);
  fill(attributes, kind.assetSources ?? "", assetSource);
  fill(attributes, kind.colorLists ?? "", colorList(color));
  for (const [name, field] of Object.entries(kind.colorStructs ?? {})) attributes[name] = colorStructs(color, field);
  attributes.style = styles[platform] ??= styleFor(platform);
  return attributes;
}

/** The registration name for a native event type: `topChange` is `onChange`; the gesture handler's own types are their registration names. */
function eventsOf(types: string, into = new Map<string, string>()): Map<string, string> {
  for (const type of types.split(/\s+/)) if (type) into.set(type, type.startsWith("top") ? `on${type.slice(3)}` : type);
  return into;
}

function foreignConfig(name: string): ViewConfig {
  const { validAttributes, bubblingEventTypes, directEventTypes } = registry().get(name);
  const events = new Map<string, string>();
  for (const type in bubblingEventTypes) { const registration = bubblingEventTypes[type]?.phasedRegistrationNames?.bubbled; if (registration) events.set(type, registration); }
  for (const type in directEventTypes) { const registration = directEventTypes[type]?.registrationName; if (registration) events.set(type, registration); }
  return { attributes: validAttributes, events, foreign: true };
}

const configs: Record<Platform, Map<string, ViewConfig>> = { android: new Map(), ios: new Map() };

/**
 * Describes a native component the host cannot list statically, for both platforms: an Expo module's view, whose
 * attributes and events the native module reports at run time (`fabric/foreign.ts`). A later definition of the same name replaces the first.
 */
export function defineViewKind(name: string, kind: Kind): void {
  for (const platform of ["android", "ios"] as const) {
    kinds[platform][name] = kind;
    configs[platform].delete(name);
  }
}

/** The config of a Fabric view component on a platform: the static table for the host's own views, else React Native's registry entry. */
export function viewConfigFor(name: string, platform: Platform): ViewConfig {
  const cache = configs[platform];
  let config = cache.get(name);
  if (!config) {
    const kind = Object.hasOwn(kinds[platform], name) ? kinds[platform][name] : undefined;
    config = kind
      ? { attributes: attributesFor(platform, kind), events: eventsOf(kind.events ?? "", eventsOf(platform === "android" ? androidEvents : iosEvents)), foreign: false }
      : foreignConfig(name);
    cache.set(name, config);
  }
  return config;
}

/** Structural comparison as React Native's `deepDiffer` with `unsafelyIgnoreFunctions`: functions are equal, objects compare by content. */
function differs(one: unknown, two: unknown): boolean {
  if (one === two) return false;
  if (typeof one === "function" && typeof two === "function") return false;
  if (typeof one !== "object" || one === null) return true;
  if (typeof two !== "object" || two === null) return true;
  if (one.constructor !== two.constructor) return true;
  if (Array.isArray(one)) {
    const other = two as unknown[];
    if (one.length !== other.length) return true;
    for (let index = 0; index < one.length; index++) if (differs(one[index], other[index])) return true;
    return false;
  }
  const left = one as Props;
  const right = two as Props;
  for (const key in left) if (differs(left[key], right[key])) return true;
  for (const key in right) if (left[key] === undefined && right[key] !== undefined) return true;
  return false;
}
const changed = (previous: unknown, next: unknown): boolean => typeof next !== "object" || next === null || differs(previous, next);

const encode = (value: unknown, attribute: true | Converter): unknown => (typeof attribute === "function" ? attribute(value) : typeof value === "function" ? true : value);

/**
 * Collects the encoded native props of `props` into `values`: nested arrays and tables are walked in order and a later
 * entry wins; a value a converter rejects (`undefined`) leaves an earlier entry's value in place, as in React Native.
 */
function flatten(props: unknown, attributes: Table, values: Props): void {
  if (Array.isArray(props)) {
    for (const item of props) flatten(item, attributes, values);
    return;
  }
  if (props === null || typeof props !== "object") return;
  for (const key in props as Props) {
    const attribute = attributes[key];
    if (attribute === undefined) continue;
    const value = (props as Props)[key];
    if (typeof attribute === "object") flatten(value, attribute, values);
    else if (value === undefined) values[key] = undefined;
    else {
      const encoded = encode(value, attribute);
      if (encoded !== undefined) values[key] = encoded;
    }
  }
}

function put(payload: Payload | null, key: string, value: unknown): Payload {
  const target = payload ?? {};
  target[key] = value;
  return target;
}

/** The payload for a new Fabric node: every native prop, encoded; `null` when there is none. */
export function createPayload(props: Props, config: ViewConfig): Payload | null {
  if (config.foreign) return reactNativePayload().create(props, config.attributes);
  const values: Props = {};
  flatten(props, config.attributes, values);
  let payload: Payload | null = null;
  for (const key in values) if (values[key] !== undefined) payload = put(payload, key, values[key]);
  return payload;
}

/** The payload for a cloned node: the native props whose value changed, `null` for each one that went away; `null` when nothing did. */
export function diffPayload(previous: Props, next: Props, config: ViewConfig): Payload | null {
  if (config.foreign) return reactNativePayload().diff(previous, next, config.attributes);
  const before: Props = {};
  const after: Props = {};
  flatten(previous, config.attributes, before);
  flatten(next, config.attributes, after);
  let payload: Payload | null = null;
  for (const key in after) {
    const value = after[key];
    if (value !== undefined && value !== before[key] && changed(before[key], value)) payload = put(payload, key, value);
  }
  for (const key in before) {
    if (before[key] !== undefined && after[key] === undefined) payload = put(payload, key, null);
  }
  return payload;
}
