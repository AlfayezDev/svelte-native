#pragma once

#include <react/renderer/mounting/ShadowView.h>

#include "PropsEncoder.h"

namespace expo::svelteengine {

// Navigation kinds (SPEC.md "Navigation" and "Native screens, Android"): plain RCTView nodes whose nativeID starts with
// `svelte:<kind>` (stack, screen, header, header slots, tabs, tab, tab icon, toolbar, toolbar item; the toolbar's center
// slot is a header slot). Their configuration travels in the nativeID (see fabric/navigation.ts); the grammar and the
// records are in PropsEncoderNavRecords.h.
inline bool isNavKind(Kind kind) {
  return kind == kStack || kind == kScreen || kind == kHeader || kind == kHeaderSlot || kind == kTabs || kind == kTab ||
      kind == kTabIcon || kind == kToolbar || kind == kToolbarItem;
}

// kindForComponent, refined for RCTView nodes carrying a navigation nativeID.
Kind kindForView(const facebook::react::ShadowView &view);

// The navigation records of a node (110 screen, 122 sheet, 125 system bars, 120/121 header, 126/127 slots, 123 tabs,
// 124 tab, 128 toolbar, 129 toolbar item). Appends them after the common ones and returns how many were written.
int32_t encodeNavProps(Batch &batch, Kind kind, const facebook::react::ShadowView &view);

// Registers the Kotlin object `NavEvents` natives (dismissed, exited, appear, disappear, detentChange, metrics, cancel, select, press).
void registerNavEventNatives();

} // namespace expo::svelteengine
