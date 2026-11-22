import ExpoModulesCore

/// The native half of `<BlurView>` (`packages/expo-svelte/src/components`): one view, `SvelteBlurView`, that blurs what is behind it and draws
/// its children above the blur. The module is called `SvelteBlur` and the view `SvelteBlurView` because the JavaScript side mounts it by those
/// names (`expoViewName("SvelteBlur", "SvelteBlurView")`); the Android module has the same names and props. `intensity` is 0 to 100 (50 when the
/// prop is not given) and `tint` is the name of a `UIBlurEffect.Style` ("default" when it is not given or not known).
public final class SvelteBlurModule: Module {
  public func definition() -> ModuleDefinition {
    Name("SvelteBlur")

    View(SvelteBlurView.self) {
      // A prop the app stops passing arrives as nil: the view goes back to its default instead of keeping the last value.
      Prop("intensity") { (view: SvelteBlurView, value: Double?) in
        view.setIntensity(value ?? SvelteBlurDefaults.intensity)
      }

      Prop("tint") { (view: SvelteBlurView, value: String?) in
        view.setTint(value ?? SvelteBlurDefaults.tint)
      }
    }
  }
}
