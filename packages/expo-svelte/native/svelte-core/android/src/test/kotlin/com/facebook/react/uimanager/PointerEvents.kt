package com.facebook.react.uimanager

/**
 * The shape of React Native 0.88's `PointerEvents` (ReactAndroid/src/main/java/com/facebook/react/uimanager/PointerEvents.kt),
 * for the host check of `GestureRules`: the same constants and the same two predicates, so the check runs the engine's mapping
 * against what React Native's own touch dispatch (and the gesture handler's `RNViewConfigurationHelper`) ask of the value.
 */
enum class PointerEvents {
  NONE,
  BOX_NONE,
  BOX_ONLY,
  AUTO;

  companion object {
    @JvmStatic
    fun canBeTouchTarget(pointerEvents: PointerEvents): Boolean = pointerEvents == AUTO || pointerEvents == BOX_ONLY

    @JvmStatic
    fun canChildrenBeTouchTarget(pointerEvents: PointerEvents): Boolean = pointerEvents == AUTO || pointerEvents == BOX_NONE
  }
}
