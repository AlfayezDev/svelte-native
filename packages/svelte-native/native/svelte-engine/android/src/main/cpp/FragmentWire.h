#pragma once

// Record 27 of a text's state (SPEC.md, "Touches on nested Text"): which node a fragment's text sits in, and whether that node is a link for accessibility.
// Header only and free of JNI and Fabric headers beyond `AccessibilityPrimitives.h` (plain structs), so a host test can run it
// (android/src/test/cpp/FragmentWireTest.cpp, decoded by FragmentWireCheck.kt with the engine's own decoder, FragmentWire.kt). `Out` is anything with `begin(id)`
// (opens a record) and `putInt(v)`.

#include <react/renderer/components/view/AccessibilityPrimitives.h>

#include <cstdint>
#include <cstring>
#include <optional>

namespace expo::svelteengine::fragmentwire {

constexpr int32_t kFragmentTarget = 27;
constexpr int32_t kLink = 1;

// As `TextLayoutManager` reads a fragment's attributes: `role` decides when it is set (whatever it is), `accessibilityRole` otherwise.
inline bool isLink(const std::optional<facebook::react::Role> &role, const std::optional<facebook::react::AccessibilityRole> &accessibilityRole) {
  if (role.has_value()) return *role == facebook::react::Role::Link;
  return accessibilityRole.has_value() && *accessibilityRole == facebook::react::AccessibilityRole::Link;
}

// One record per fragment, after the fragment's own: the tag of the node the text sits in (`fragment.parentShadowView.tag`: the paragraph, or the nested Text that
// holds the string) and the flags.
template <class Out>
void encodeTarget(
    Out &out,
    int32_t tag,
    const std::optional<facebook::react::Role> &role,
    const std::optional<facebook::react::AccessibilityRole> &accessibilityRole) {
  out.begin(kFragmentTarget);
  out.putInt(tag);
  out.putInt(isLink(role, accessibilityRole) ? kLink : 0);
}

// A Text nested in a Text (`RCTVirtualText`, which Fabric names `Text`) has no view of the engine's, but its event emitter is kept (MountingDelegate): a touch on its
// words is dispatched to it. `RCTRawText`, the paragraph (`RCTText`, `Paragraph`) and every other component are not.
inline bool isNestedTextName(const char *name) {
  return name != nullptr && (!std::strcmp(name, "Text") || !std::strcmp(name, "VirtualText") || !std::strcmp(name, "RCTVirtualText"));
}

} // namespace expo::svelteengine::fragmentwire
