#pragma once

// The accessibility prop records of a view (SPEC.md, "Accessibility props"), written from React Native's `AccessibilityProps`.
// Header only and free of JNI and Fabric headers beyond `AccessibilityPrimitives.h` (plain structs), so a host test can run it
// (android/src/test/cpp/A11yWireTest.cpp). `Out` is anything with `begin(id)` (opens a record), `putInt(v)` and `addString(s)`.

#include <react/renderer/components/view/AccessibilityPrimitives.h>

#include <cstdint>
#include <optional>
#include <string>
#include <vector>

namespace expo::svelteengine::a11y {

enum Record : int32_t {
  kState = 16,
  kValue = 17,
  kHint = 18,
  kActions = 19,
  kMode = 25,
  kRole = 26,
};

// kState: one int. bit 0 disabled, bit 1 selected, bit 2 busy, bits 3-4 checked (0 not set, 1 unchecked, 2 checked, 3 mixed),
// bits 5-6 expanded (0 not set, 1 collapsed, 2 expanded). The record exists when the prop does, even if every bit is 0.
constexpr int32_t kDisabled = 1, kSelected = 2, kBusy = 4, kCheckedShift = 3, kExpandedShift = 5;

inline int32_t stateBits(const facebook::react::AccessibilityState &s) {
  using State = facebook::react::AccessibilityState;
  int32_t bits = (s.disabled ? kDisabled : 0) | (s.selected ? kSelected : 0) | (s.busy ? kBusy : 0);
  switch (s.checked) {
    case State::Unchecked: bits |= 1 << kCheckedShift; break;
    case State::Checked: bits |= 2 << kCheckedShift; break;
    case State::Mixed: bits |= 3 << kCheckedShift; break;
    case State::None: break;
  }
  if (s.expanded.has_value()) bits |= (*s.expanded ? 2 : 1) << kExpandedShift;
  return bits;
}

// kValue: a mask (bit 0 min, bit 1 max, bit 2 now, bit 3 text), then the fields the mask names, in that order (ints; text is a string index).
constexpr int32_t kMin = 1, kMax = 2, kNow = 4, kText = 8;

// kMode: bits 0-1 accessibilityLiveRegion (0 none, 1 polite, 2 assertive), bits 2-3 importantForAccessibility (0 auto, 1 yes, 2 no, 3 no-hide-descendants).
inline int32_t modeBits(facebook::react::AccessibilityLiveRegion live, facebook::react::ImportantForAccessibility important) {
  using facebook::react::AccessibilityLiveRegion;
  using facebook::react::ImportantForAccessibility;
  int32_t bits = 0;
  switch (live) {
    case AccessibilityLiveRegion::None: break;
    case AccessibilityLiveRegion::Polite: bits |= 1; break;
    case AccessibilityLiveRegion::Assertive: bits |= 2; break;
  }
  switch (important) {
    case ImportantForAccessibility::Auto: break;
    case ImportantForAccessibility::Yes: bits |= 1 << 2; break;
    case ImportantForAccessibility::No: bits |= 2 << 2; break;
    case ImportantForAccessibility::NoHideDescendants: bits |= 3 << 2; break;
  }
  return bits;
}

struct Fields {
  const std::optional<facebook::react::AccessibilityState> &state;
  const facebook::react::AccessibilityValue &value;
  const std::string &hint;
  const std::vector<facebook::react::AccessibilityAction> &actions;
  facebook::react::AccessibilityLiveRegion liveRegion;
  facebook::react::ImportantForAccessibility important;
  facebook::react::Role role;
  // `role` is the ordinal of `facebook::react::Role`, with `None` (the default, which a view that never set it also has) not sent.
};

// Writes the records of the props that are set, in id order. Returns the number of records written.
template <class Out>
int32_t encode(Out &out, const Fields &f) {
  using facebook::react::Role;
  int32_t records = 0;
  if (f.state.has_value()) {
    out.begin(kState);
    out.putInt(stateBits(*f.state));
    ++records;
  }
  const auto &v = f.value;
  const int32_t mask = (v.min ? kMin : 0) | (v.max ? kMax : 0) | (v.now ? kNow : 0) | (v.text ? kText : 0);
  if (mask != 0) {
    out.begin(kValue);
    out.putInt(mask);
    if (v.min) out.putInt(*v.min);
    if (v.max) out.putInt(*v.max);
    if (v.now) out.putInt(*v.now);
    if (v.text) out.putInt(out.addString(*v.text));
    ++records;
  }
  if (!f.hint.empty()) {
    out.begin(kHint);
    out.putInt(out.addString(f.hint));
    ++records;
  }
  if (!f.actions.empty()) {
    out.begin(kActions);
    out.putInt(static_cast<int32_t>(f.actions.size()));
    for (const auto &action : f.actions) {
      out.putInt(out.addString(action.name));
      out.putInt(action.label ? out.addString(*action.label) : -1);
    }
    ++records;
  }
  const int32_t mode = modeBits(f.liveRegion, f.important);
  if (mode != 0) {
    out.begin(kMode);
    out.putInt(mode);
    ++records;
  }
  if (f.role != Role::None) {
    out.begin(kRole);
    out.putInt(static_cast<int32_t>(f.role));
    ++records;
  }
  return records;
}

} // namespace expo::svelteengine::a11y
