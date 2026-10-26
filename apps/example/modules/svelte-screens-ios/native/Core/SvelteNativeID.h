#pragma once

#include <cstdint>
#include <optional>
#include <string>
#include <utility>
#include <vector>

// Reader for the navigation `nativeID` (apps/platform/modules/svelte-engine/SPEC.md, "Screen API contract (header,
// sheet, tabs)"). The grammar and the defaults are those of `decodeRecords` in packages/svelte-native/src/fabric/navigation.ts;
// test/records_dump.cpp prints the records of every spec so that tests can compare them with that reference decoder.
// No Foundation or UIKit here: the file builds and runs anywhere.

namespace svelte {

/// `svelte:<kind>;key=value;...` with the values still percent-encoded. Not valid for any other string.
struct NativeId {
  bool valid = false;
  std::string kind;
  std::vector<std::pair<std::string, std::string>> pairs;

  /// The raw value of `key`, the last one when repeated; null when absent.
  const std::string *find(const char *key) const;
};

NativeId splitNativeId(const std::string &id);

enum class Kind { Unknown, Stack, Screen, Header, HeaderSlot, Tabs, Tab, TabIcon };
Kind kindOf(const NativeId &id);

/// `0xAARRGGBB`; `set` is false for a color that is absent or not `rrggbbaa`.
struct Color {
  bool set = false;
  uint32_t argb = 0;
};

enum Presentation { kPush = 0, kModal = 1, kTransparentModal = 2, kSheet = 3, kFormSheet = 4 };
enum Animation { kAnimationDefault = 0, kAnimationNone = 1, kAnimationFade = 2, kSlideFromRight = 3, kSlideFromBottom = 4 };
enum Slot { kSlotLeft = 0, kSlotCenter = 1, kSlotRight = 2, kSlotSearch = 3 };
enum BarStyle { kBarAuto = 0, kBarLight = 1, kBarDark = 2 };

/// Records 110, 122 and 125. Flags keep the integer the wire carries (`g=2` is 2); test them with `!= 0`.
struct ScreenSpec {
  int activityState = 2;
  int presentation = kPush;
  int gesture = 1;
  int animation = kAnimationDefault;
  int nativeBack = 1;
  /// Fractions of the largest detent, -1 for "auto"; at most four; empty unless the presentation is a sheet.
  std::vector<double> detents;
  int initialDetent = 0;
  int grabber = 1;
  int dismissible = 1;
  int noBackdrop = 0;
  bool hasBars = false;
  int statusStyle = kBarAuto;
  int statusHidden = 0;
  Color navigationBar;
  int navigationBarStyle = kBarAuto;

  bool isSheet() const { return presentation == kSheet || presentation == kFormSheet; }
};

/// Records 120 and 121.
struct HeaderSpec {
  bool large = false;
  bool translucent = false;
  bool back = false;
  bool hideShadow = false;
  std::optional<std::string> title;
  std::optional<std::string> subtitle;
  std::optional<std::string> backTitle;
  Color tint;
  Color background;
  /// Slot mask: 1 left, 2 center, 4 right, 8 search.
  int slots = 0;
};

/// Records 126 and 127 (the search fields only for the search slot).
struct SlotSpec {
  int slot = kSlotLeft;
  std::optional<std::string> placeholder;
  std::optional<std::string> value;
  int eventCount = 0;
};

/// Record 123.
struct TabsSpec {
  int selected = 0;
  int selectCount = 0;
  Color tint;
  Color inactiveTint;
  Color background;
  int noLabels = 0;
};

enum BadgeKind { kBadgeNone = 0, kBadgeDot = 1, kBadgeText = 2 };

/// Record 124.
struct TabSpec {
  std::optional<std::string> key;
  std::optional<std::string> title;
  std::optional<std::string> icon;
  std::optional<std::string> selectedIcon;
  int iconIsView = 0;
  int badgeKind = kBadgeNone;
  std::optional<std::string> badgeText;
  int disabled = 0;
};

ScreenSpec parseScreen(const NativeId &id);
HeaderSpec parseHeader(const NativeId &id);
SlotSpec parseSlot(const NativeId &id);
TabsSpec parseTabs(const NativeId &id);
TabSpec parseTab(const NativeId &id);

/// Convenience for the views: split and parse in one step. A string that is not a `svelte:` nativeID parses as the defaults.
ScreenSpec parseScreen(const std::string &id);
HeaderSpec parseHeader(const std::string &id);
SlotSpec parseSlot(const std::string &id);
TabsSpec parseTabs(const std::string &id);
TabSpec parseTab(const std::string &id);

}  // namespace svelte
