package com.swmansion.reanimated

import com.facebook.react.bridge.ReadableMap

/**
 * expo-svelte patch: lets a native mounting layer that does not use React Native's ViewManagers (the svelte-engine Expo
 * module) take UI-thread prop writes before React Native's string dispatch. The updater runs on the UI thread and
 * returns true when it owns the tag and applied the props, false to let the regular path continue.
 */
object SvelteEngineHook {
  @JvmStatic
  @Volatile
  var updater: ((viewTag: Int, props: ReadableMap) -> Boolean)? = null

  /**
   * The engine's keyboard source (SPEC.md, "Keyboard motion"): what `subscribeForKeyboardEvents` takes its events from when it is set, instead of a window insets callback of
   * Reanimated's own. `keyboardSubscribe` takes the listener and the two options of the subscription (the status bar and the navigation bar are translucent), and returns an id
   * that is below zero. The listener is called on the main thread, once for each frame of the keyboard, with what the subscriber is given by Reanimated's own source
   * (`KeyboardState` as a number and the height in whole dp, less the navigation bar unless it is translucent); `keyboardUnsubscribe` takes the id back.
   */
  @JvmStatic
  @Volatile
  var keyboardSubscribe: ((listener: (Int, Int) -> Unit, isStatusBarTranslucent: Boolean, isNavigationBarTranslucent: Boolean) -> Int)? = null

  @JvmStatic
  @Volatile
  var keyboardUnsubscribe: ((id: Int) -> Unit)? = null
}
