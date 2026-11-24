package expo.modules.svelteengine

/**
 * Whether a touch on a foreign view (SPEC.md, "Foreign views") is also JavaScript's. A foreign view takes its touches itself, the way the platform delivers them, and the engine used to
 * claim the touch and tell JavaScript nothing of it: a press on a `Pressable` never started on an `Svg` inside it (its view is React Native's `ReactViewGroup`, which answers every
 * touch with true so that the root sends it to JavaScript and the responders there work out who presses, "we don't need to do bubbling in native"). The engine is that root: a foreign
 * view with no touch handling of its own gets its touches dispatched to JavaScript on its frame's tag, as React Native does for every view, and the responders above it press.
 *
 * Which views have none is an allow-list, not a search for what takes touches: a view is passed on only when it is one of a few bases that are known to take none (React Native's
 * `ReactViewGroup`, which the Svg's views are, and Expo's `ExpoView`) and nothing below the base declares a touch method of its own; every other class (a WebView, a map, a video
 * player, a PDF view, any widget or container of a library the engine has not seen) keeps its touches, as it always did. That a search cannot be complete is the reason: a view that takes touches
 * through `dispatchTouchEvent` (react-native-maps' `MapView`, a gms `MapView` that declares no `onTouchEvent`), through a listener, or through a child is not found by looking for the one method
 * that was looked at, and a pan that presses a card is worse than a tap that does not.
 * Free of Android classes so that a host check runs it.
 */
object ForeignTouchRules {
  /** The methods through which a view takes a touch: its own, or the dispatch of one to its children. */
  val touchMethods = listOf("onTouchEvent", "dispatchTouchEvent", "onInterceptTouchEvent")

  /** Whether [type] declares one of [touchMethods] itself (not what it inherits). */
  fun declaresTouch(type: Class<*>): Boolean = type.declaredMethods.any { it.name in touchMethods }

  /**
   * Whether [start], a view's class, has no touch handling below a class of [accepted]: walking up from it, a class of [accepted] ends the search with true (it is the base whose handling is known and
   * wanted), a class that [declaresTouch] ends it with false, and a class that is neither is passed through. A chain that reaches neither, a class that is none of the bases, is false.
   */
  fun takesNoTouch(start: Class<*>?, accepted: Set<Class<*>>, declaresTouch: (Class<*>) -> Boolean): Boolean {
    var type = start
    while (type != null) {
      if (type in accepted) return true
      if (declaresTouch(type)) return false
      type = type.superclass
    }
    return false
  }

  /**
   * The view is passed on when [plainClass] (the class of the view takes no touch below an accepted base), [plainDescendants] (nor does anything inside it, and none of it is clickable or has a
   * listener) and nothing asked for the touch of the view itself: not [clickable], not [longClickable], no [clickListener], no [touchListener].
   */
  fun passesToParent(plainClass: Boolean, plainDescendants: Boolean, clickable: Boolean, longClickable: Boolean, clickListener: Boolean, touchListener: Boolean): Boolean =
    plainClass && plainDescendants && !clickable && !longClickable && !clickListener && !touchListener
}
