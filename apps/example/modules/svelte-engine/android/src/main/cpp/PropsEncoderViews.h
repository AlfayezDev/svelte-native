#pragma once

#include <react/renderer/core/ReactPrimitives.h>

#include "PropsEncoder.h"

namespace expo::svelteengine {

// Records for the kinds 5..9 (TextInput, Switch, ActivityIndicator, Image, Modal), see SPEC-views.md.
// Appends the records after the common ones written by encodeProps and returns how many were written.
int32_t encodeViewKindProps(Batch &batch, Kind kind, const facebook::react::ShadowView &view, float scale);

// Same for UPDATE_STATE (TextInput: the text and mostRecentEventCount of AndroidTextInputState).
int32_t encodeViewKindState(Batch &batch, Kind kind, const facebook::react::ShadowView &view, float scale);

// Kinds whose UPDATE_STATE carries a payload.
inline bool kindHasState(Kind kind) {
  return kind == kText || kind == kInput;
}

inline bool isViewKind(Kind kind) {
  return kind >= kInput && kind <= kModal;
}

// The Modal's State is kept per tag so the Kotlin side can report the dialog size (ModalHostViewState).
void noteViewState(Kind kind, const facebook::react::ShadowView &view);
void forgetViewState(facebook::react::Tag tag);
bool updateModalSize(facebook::react::Tag tag, float widthDp, float heightDp);

} // namespace expo::svelteengine
