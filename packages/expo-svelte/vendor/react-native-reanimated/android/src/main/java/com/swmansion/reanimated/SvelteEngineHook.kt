package com.swmansion.reanimated

import com.facebook.react.bridge.ReadableMap

/**
 * Rasheed patch: lets a native mounting layer that does not use React Native's ViewManagers (the svelte-engine Expo
 * module) take UI-thread prop writes before React Native's string dispatch. The updater runs on the UI thread and
 * returns true when it owns the tag and applied the props, false to let the regular path continue.
 */
object SvelteEngineHook {
  @JvmStatic
  @Volatile
  var updater: ((viewTag: Int, props: ReadableMap) -> Boolean)? = null
}
