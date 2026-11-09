#pragma once

#include <fbjni/fbjni.h>
#include <react/renderer/mounting/ShadowView.h>

#include <cstdint>
#include <cstring>
#include <string>
#include <vector>

namespace expo::svelteengine {

// Component kinds, as in SPEC.md. 10..18 are the navigation kinds with the numbers of `NAV_KINDS` in navigation.ts.
enum Kind : int32_t { kSkip = 0, kView = 1, kText = 2, kScroll = 4, kInput = 5, kSwitch = 6, kProgress = 7, kImage = 8, kModal = 9, kStack = 10, kScreen = 11, kHeader = 12, kHeaderSlot = 13, kTabs = 14, kTab = 15, kTabIcon = 16, kToolbar = 17, kToolbarItem = 18, kForeign = 19 };

enum Op : int32_t {
  kOpCreate = 1,
  kOpDelete = 2,
  kOpInsert = 3,
  kOpRemove = 4,
  kOpUpdateProps = 5,
  kOpUpdateLayout = 6,
  kOpUpdateState = 7,
  kOpEnd = 9,
};

// One transaction: flat ints plus the string and object side tables.
struct Batch {
  std::vector<int32_t> ops;
  std::vector<std::string> strings;
  std::vector<facebook::jni::local_ref<jobject>> objects;

  void putInt(int32_t v) { ops.push_back(v); }
  void putFloat(float f) {
    int32_t bits;
    std::memcpy(&bits, &f, sizeof(bits));
    ops.push_back(bits);
  }
  int32_t addString(const std::string &s) {
    strings.push_back(s);
    return static_cast<int32_t>(strings.size() - 1);
  }
  int32_t addObject(facebook::jni::local_ref<jobject> o) {
    objects.push_back(std::move(o));
    return static_cast<int32_t>(objects.size() - 1);
  }
};

Kind kindForComponent(const char *componentName);

// Writes `nProps` (a record count) followed by the prop records for a CREATE / UPDATE_PROPS.
// `scale` is the point scale factor (px per point) used when the view has no valid layout yet.
void encodeProps(Batch &batch, Kind kind, const facebook::react::ShadowView &view, float scale);

// Writes the state payload after `UPDATE_STATE tag kind`: Text records 20 / 21 / 22; nothing for others.
// Writes `nProps` first (record count) so Kotlin can parse it like props.
void encodeState(Batch &batch, Kind kind, const facebook::react::ShadowView &view, float scale);

// UPDATE_LAYOUT payload after the tag: x y w h padL padT padR padB displayNone.
void encodeLayout(Batch &batch, const facebook::react::ShadowView &view);

} // namespace expo::svelteengine
