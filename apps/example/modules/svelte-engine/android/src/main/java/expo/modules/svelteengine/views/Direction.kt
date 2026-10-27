package expo.modules.svelteengine.views

import android.view.View

/**
 * Whether a native chrome view (header, tab bar) lays out and draws right to left: the app's configuration, which is the
 * same for every view and known at once.
 *
 * Not `View.getLayoutDirection()`: a view resolves it from its parents when it is measured while attached, and a screen
 * is measured and laid out detached at the end of its batch (`MountingManager.flushScreens`), where every view still
 * answers left to right. A bar laid out then kept its left-to-right order on some launches until something else asked for
 * a layout (the parity suite saw the tab order unmirrored on 2 of 6 launches in Arabic).
 */
internal fun View.isRtlLayout(): Boolean = resources.configuration.layoutDirection == View.LAYOUT_DIRECTION_RTL
