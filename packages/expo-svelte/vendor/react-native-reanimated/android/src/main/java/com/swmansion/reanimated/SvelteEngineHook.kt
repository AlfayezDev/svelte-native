package com.swmansion.reanimated

import com.facebook.react.bridge.ReadableMap

/**
 * Example patch: lets a native mounting layer that does not use React Native's ViewManagers (the svelte-engine Expo
 * module) take UI-thread prop writes before React Native's string dispatch. The updater runs on the UI thread and
 * returns true when it owns the tag and applied the props, false to let the regular path continue.
 */
object SvelteEngineHook {
  @JvmStatic
  @Volatile
  var updater: ((viewTag: Int, props: ReadableMap) -> Boolean)? = null

  /**
   * The engine's keyboard source (SPEC.md, "Keyboard motion"): what `subscribeForKeyboardEvents` takes its events from when it is set, instead of a window insets callback of
   * Reanimated's own. `keyboardSubscribe` takes the listener, called on the UI thread with (kind, px) for each frame of the keyboard, and returns an id that is below zero;
   * `keyboardUnsubscribe` takes that id back.
   */
  @JvmStatic
  @Volatile
  var keyboardSubscribe: ((listener: (Int, Int) -> Unit) -> Int)? = null

  @JvmStatic
  @Volatile
  var keyboardUnsubscribe: ((id: Int) -> Unit)? = null
}
