#include "SvelteNativeID.h"

#include <cctype>
#include <climits>
#include <cmath>
#include <cstdlib>

namespace svelte {

namespace {

const char kPrefix[] = "svelte:";

int hexDigit(char c) {
  if (c >= '0' && c <= '9') return c - '0';
  if (c >= 'a' && c <= 'f') return 10 + (c - 'a');
  if (c >= 'A' && c <= 'F') return 10 + (c - 'A');
  return -1;
}

// `decodeURIComponent`, lenient: a `%` that does not start a hex pair stays as it is.
std::string percentDecode(const std::string &raw) {
  std::string out;
  out.reserve(raw.size());
  for (size_t i = 0; i < raw.size(); i++) {
    if (raw[i] == '%' && i + 2 < raw.size() && hexDigit(raw[i + 1]) >= 0 && hexDigit(raw[i + 2]) >= 0) {
      out.push_back(static_cast<char>(hexDigit(raw[i + 1]) * 16 + hexDigit(raw[i + 2])));
      i += 2;
    } else {
      out.push_back(raw[i]);
    }
  }
  return out;
}

std::optional<std::string> text(const NativeId &id, const char *key) {
  const std::string *raw = id.find(key);
  if (!raw) return std::nullopt;
  return percentDecode(*raw);
}

// `Number.parseInt(raw, 10)` with a fallback for NaN: optional sign and leading digits, anything after them ignored.
int integer(const NativeId &id, const char *key, int fallback) {
  const std::string *raw = id.find(key);
  if (!raw) return fallback;
  size_t i = 0;
  while (i < raw->size() && std::isspace(static_cast<unsigned char>((*raw)[i]))) i++;
  bool negative = false;
  if (i < raw->size() && ((*raw)[i] == '+' || (*raw)[i] == '-')) negative = (*raw)[i++] == '-';
  if (i >= raw->size() || !std::isdigit(static_cast<unsigned char>((*raw)[i]))) return fallback;
  long long value = 0;
  while (i < raw->size() && std::isdigit(static_cast<unsigned char>((*raw)[i]))) {
    value = value * 10 + ((*raw)[i++] - '0');
    if (value > INT_MAX) value = INT_MAX;
  }
  return static_cast<int>(negative ? -value : value);
}

// `Number(text)` for the characters a decimal number is made of; NaN for anything else.
double number(const std::string &raw) {
  size_t begin = 0;
  size_t end = raw.size();
  while (begin < end && std::isspace(static_cast<unsigned char>(raw[begin]))) begin++;
  while (end > begin && std::isspace(static_cast<unsigned char>(raw[end - 1]))) end--;
  if (begin == end) return 0;
  const std::string trimmed = raw.substr(begin, end - begin);
  if (trimmed.find_first_not_of("+-.0123456789eE") != std::string::npos) return std::nan("");
  char *stop = nullptr;
  const double value = std::strtod(trimmed.c_str(), &stop);
  return stop == trimmed.c_str() + trimmed.size() ? value : std::nan("");
}

// `rrggbbaa` in lower case; anything else is no color.
Color color(const NativeId &id, const char *key) {
  const std::string *raw = id.find(key);
  if (!raw || raw->size() != 8) return {};
  uint32_t rgba = 0;
  for (char c : *raw) {
    if (!((c >= '0' && c <= '9') || (c >= 'a' && c <= 'f'))) return {};
    rgba = (rgba << 4) | static_cast<uint32_t>(hexDigit(c));
  }
  return {true, ((rgba & 0xff) << 24) | (rgba >> 8)};
}

int barStyle(const NativeId &id, const char *key) {
  const std::string *raw = id.find(key);
  if (!raw) return kBarAuto;
  if (*raw == "l") return kBarLight;
  if (*raw == "d") return kBarDark;
  return kBarAuto;
}

bool flagIs1(const NativeId &id, const char *key) {
  const std::string *raw = id.find(key);
  return raw && *raw == "1";
}

int presentationCode(const std::string *raw) {
  if (!raw) return kPush;
  if (*raw == "modal") return kModal;
  if (*raw == "transparentModal") return kTransparentModal;
  if (*raw == "sheet") return kSheet;
  if (*raw == "formSheet") return kFormSheet;
  return kPush;
}

int animationCode(const std::string *raw) {
  if (!raw) return kAnimationDefault;
  if (*raw == "none") return kAnimationNone;
  if (*raw == "fade") return kAnimationFade;
  if (*raw == "slide_from_right") return kSlideFromRight;
  if (*raw == "slide_from_bottom") return kSlideFromBottom;
  return kAnimationDefault;
}

}  // namespace

const std::string *NativeId::find(const char *key) const {
  for (size_t i = pairs.size(); i > 0; i--) {
    if (pairs[i - 1].first == key) return &pairs[i - 1].second;
  }
  return nullptr;
}

NativeId splitNativeId(const std::string &id) {
  NativeId out;
  if (id.compare(0, sizeof(kPrefix) - 1, kPrefix) != 0) return out;
  out.valid = true;
  size_t begin = sizeof(kPrefix) - 1;
  size_t end = id.find(';', begin);
  out.kind = id.substr(begin, end == std::string::npos ? std::string::npos : end - begin);
  while (end != std::string::npos) {
    begin = end + 1;
    end = id.find(';', begin);
    const std::string part = id.substr(begin, end == std::string::npos ? std::string::npos : end - begin);
    const size_t at = part.find('=');
    if (at != std::string::npos && at > 0) out.pairs.emplace_back(part.substr(0, at), part.substr(at + 1));
  }
  return out;
}

Kind kindOf(const NativeId &id) {
  if (!id.valid) return Kind::Unknown;
  if (id.kind == "stack") return Kind::Stack;
  if (id.kind == "screen") return Kind::Screen;
  if (id.kind == "header") return Kind::Header;
  if (id.kind == "header-left" || id.kind == "header-center" || id.kind == "header-right" || id.kind == "header-search" || id.kind == "toolbar-center") {
    return Kind::HeaderSlot;
  }
  if (id.kind == "tabs") return Kind::Tabs;
  if (id.kind == "tab") return Kind::Tab;
  if (id.kind == "tab-icon") return Kind::TabIcon;
  if (id.kind == "toolbar") return Kind::Toolbar;
  if (id.kind == "toolbar-item") return Kind::ToolbarItem;
  return Kind::Unknown;
}

ScreenSpec parseScreen(const NativeId &id) {
  ScreenSpec spec;
  spec.activityState = integer(id, "a", 2);
  spec.presentation = presentationCode(id.find("p"));
  spec.gesture = integer(id, "g", 1);
  spec.animation = animationCode(id.find("s"));
  spec.nativeBack = integer(id, "b", 1);
  const std::string *presentation = id.find("p");
  if (presentation && (*presentation == "sheet" || *presentation == "formSheet")) {
    const bool form = *presentation == "formSheet";
    std::vector<double> detents;
    if (form) {
      detents = {1};
    } else if (const std::string *raw = id.find("dt")) {
      // A list is its items encoded and joined by `,`; the empty string is the empty list.
      if (!raw->empty()) {
        size_t begin = 0;
        while (true) {
          const size_t comma = raw->find(',', begin);
          const std::string item = percentDecode(raw->substr(begin, comma == std::string::npos ? std::string::npos : comma - begin));
          detents.push_back(item == "auto" ? -1 : number(item));
          if (comma == std::string::npos) break;
          begin = comma + 1;
        }
      }
    } else {
      detents = {0.5, 1};
    }
    if (detents.size() > 4) detents.resize(4);
    spec.detents = detents;
    const int last = static_cast<int>(detents.size()) - 1;
    const int initial = integer(id, "di", 0);
    spec.initialDetent = initial < last ? initial : last;
    spec.grabber = integer(id, "gr", form ? 0 : 1);
    spec.dismissible = integer(id, "dm", 1);
    spec.noBackdrop = integer(id, "bd", 0);
  }
  if (id.find("ss") || id.find("sx") || id.find("nc") || id.find("ns")) {
    spec.hasBars = true;
    spec.statusStyle = barStyle(id, "ss");
    spec.statusHidden = integer(id, "sx", 0);
    spec.navigationBar = color(id, "nc");
    spec.navigationBarStyle = barStyle(id, "ns");
  }
  return spec;
}

HeaderSpec parseHeader(const NativeId &id) {
  HeaderSpec spec;
  spec.large = flagIs1(id, "l");
  spec.translucent = flagIs1(id, "tl");
  spec.back = flagIs1(id, "bk");
  spec.hideShadow = flagIs1(id, "hs");
  spec.title = text(id, "t");
  spec.subtitle = text(id, "st");
  spec.backTitle = text(id, "bt");
  spec.tint = color(id, "tc");
  spec.background = color(id, "bg");
  spec.slots = integer(id, "sl", 0);
  return spec;
}

SlotSpec parseSlot(const NativeId &id) {
  SlotSpec spec;
  if (id.kind == "header-center") spec.slot = kSlotCenter;
  else if (id.kind == "header-right") spec.slot = kSlotRight;
  else if (id.kind == "header-search") spec.slot = kSlotSearch;
  else if (id.kind == "toolbar-center") spec.slot = kSlotToolbarCenter;
  else spec.slot = kSlotLeft;
  spec.placeholder = text(id, "ph");
  spec.value = text(id, "v");
  spec.eventCount = integer(id, "ec", 0);
  return spec;
}

TabsSpec parseTabs(const NativeId &id) {
  TabsSpec spec;
  spec.selected = integer(id, "sel", 0);
  spec.selectCount = integer(id, "sc", 0);
  spec.tint = color(id, "tc");
  spec.inactiveTint = color(id, "uc");
  spec.background = color(id, "bg");
  spec.noLabels = integer(id, "lb", 0);
  return spec;
}

TabSpec parseTab(const NativeId &id) {
  TabSpec spec;
  spec.key = text(id, "k");
  spec.title = text(id, "t");
  spec.icon = text(id, "ic");
  spec.selectedIcon = text(id, "is");
  spec.iconIsView = integer(id, "iv", 0);
  if (id.find("bd")) {
    spec.badgeText = text(id, "bd");
    spec.badgeKind = spec.badgeText->empty() ? kBadgeDot : kBadgeText;
  }
  spec.disabled = integer(id, "ds", 0);
  return spec;
}

ToolbarSpec parseToolbar(const NativeId &id) {
  ToolbarSpec spec;
  spec.hidden = flagIs1(id, "hd");
  spec.translucent = flagIs1(id, "tl");
  spec.tint = color(id, "tc");
  spec.background = color(id, "bg");
  spec.slots = integer(id, "sl", 0);
  return spec;
}

ToolbarItemSpec parseToolbarItem(const NativeId &id) {
  ToolbarItemSpec spec;
  spec.key = text(id, "k");
  spec.title = text(id, "t");
  spec.icon = text(id, "ic");
  spec.iconIsView = integer(id, "iv", 0);
  if (id.find("bd")) {
    spec.badgeText = text(id, "bd");
    spec.badgeKind = spec.badgeText->empty() ? kBadgeDot : kBadgeText;
  }
  spec.disabled = integer(id, "ds", 0);
  spec.spacer = integer(id, "sp", 0);
  return spec;
}

ScreenSpec parseScreen(const std::string &id) { return parseScreen(splitNativeId(id)); }
HeaderSpec parseHeader(const std::string &id) { return parseHeader(splitNativeId(id)); }
SlotSpec parseSlot(const std::string &id) { return parseSlot(splitNativeId(id)); }
TabsSpec parseTabs(const std::string &id) { return parseTabs(splitNativeId(id)); }
TabSpec parseTab(const std::string &id) { return parseTab(splitNativeId(id)); }
ToolbarSpec parseToolbar(const std::string &id) { return parseToolbar(splitNativeId(id)); }
ToolbarItemSpec parseToolbarItem(const std::string &id) { return parseToolbarItem(splitNativeId(id)); }

}  // namespace svelte
