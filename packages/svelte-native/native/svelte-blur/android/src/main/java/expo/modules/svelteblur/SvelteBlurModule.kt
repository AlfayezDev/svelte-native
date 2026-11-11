package expo.modules.svelteblur

import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

/**
 * `SvelteBlur`: the library's own blur view, which needs no `expo-blur` (JavaScript: `BlurView` in `@example/svelte-native/foreign`; the iOS half is
 * `native/svelte-blur/ios`, same module and view names, same props). One view, `SvelteBlurView`, with two props: `intensity` (0 to 100) and `tint`.
 * See [SvelteBlurView] and [BlurRules].
 */
class SvelteBlurModule : Module() {
  override fun definition() = ModuleDefinition {
    Name("SvelteBlur")

    View(SvelteBlurView::class) {
      Name("SvelteBlurView")

      Prop("intensity") { view: SvelteBlurView, value: Double? ->
        view.setIntensity(value)
      }

      Prop("tint") { view: SvelteBlurView, value: String? ->
        view.setTint(value)
      }
    }
  }
}
