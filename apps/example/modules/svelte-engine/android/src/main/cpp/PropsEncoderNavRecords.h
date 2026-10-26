#pragma once

// The `nativeID` grammar of the navigation tags and the prop records it stands for (SPEC.md, "Screen API contract").
// Standard library only, so a host-compiled test can run it against the reference decoder (`decodeRecords` in
// `packages/svelte-native/src/fabric/navigation.ts`); `Sink` is anything with `putInt`, `putFloat` and `addString`
// (the engine's `Batch`).

#include <cmath>
#include <cstdint>
#include <cstdlib>
#include <optional>
#include <string>
#include <string_view>
#include <utility>
#include <vector>

namespace expo::svelteengine::nav {

// Engine view kinds of the navigation tags; 0 for anything else. Same numbers as `NAV_KINDS` in navigation.ts.
enum NavKind : int32_t {
  kNone = 0,
  kStackNode = 10,
  kScreenNode = 11,
  kHeaderNode = 12,
  kHeaderSlotNode = 13,
  kTabsNode = 14,
  kTabNode = 15,
  kTabIconNode = 16,
};

constexpr std::string_view kPrefix = "svelte:";
constexpr int32_t kDefaultSheetDetentCount = 2;
constexpr float kDefaultSheetDetents[kDefaultSheetDetentCount] = {0.5f, 1.f};
constexpr int32_t kMaxSheetDetents = 4;

enum RecordId : int32_t {
  kScreenRecord = 110,
  kHeaderRecord = 120,
  kHeaderSlotsRecord = 121,
  kSheetRecord = 122,
  kTabsRecord = 123,
  kTabRecord = 124,
  kSystemBarsRecord = 125,
  kSlotRecord = 126,
  kSearchRecord = 127,
};

// A parsed `nativeID`: the kind token and the raw (still percent-encoded) values, as views into the id.
struct Parsed {
  std::string_view kind;
  std::vector<std::pair<std::string_view, std::string_view>> pairs;

  std::optional<std::string_view> find(std::string_view key) const {
    for (const auto &pair : pairs) {
      if (pair.first == key) return pair.second;
    }
    return std::nullopt;
  }
};

inline std::optional<Parsed> parse(std::string_view id) {
  if (id.substr(0, kPrefix.size()) != kPrefix) return std::nullopt;
  id.remove_prefix(kPrefix.size());
  Parsed parsed;
  size_t at = id.find(';');
  parsed.kind = id.substr(0, at);
  while (at != std::string_view::npos) {
    id.remove_prefix(at + 1);
    at = id.find(';');
    std::string_view part = id.substr(0, at);
    size_t equals = part.find('=');
    // `key=` is a key with an empty value; a part without `=` or with an empty key is ignored.
    if (equals != std::string_view::npos && equals > 0) parsed.pairs.emplace_back(part.substr(0, equals), part.substr(equals + 1));
  }
  return parsed;
}

inline NavKind kindOf(std::string_view kind) {
  if (kind == "stack") return kStackNode;
  if (kind == "screen") return kScreenNode;
  if (kind == "header") return kHeaderNode;
  if (kind == "header-left" || kind == "header-center" || kind == "header-right" || kind == "header-search") return kHeaderSlotNode;
  if (kind == "tabs") return kTabsNode;
  if (kind == "tab") return kTabNode;
  if (kind == "tab-icon") return kTabIconNode;
  return kNone;
}

// The navigation kind of a `nativeID`, 0 when it is not one.
inline NavKind kindOfNativeId(std::string_view id) {
  if (id.substr(0, kPrefix.size()) != kPrefix) return kNone;
  id.remove_prefix(kPrefix.size());
  return kindOf(id.substr(0, id.find(';')));
}

inline int hexDigit(char c) {
  if (c >= '0' && c <= '9') return c - '0';
  if (c >= 'a' && c <= 'f') return c - 'a' + 10;
  if (c >= 'A' && c <= 'F') return c - 'A' + 10;
  return -1;
}

// `decodeURIComponent`: `%XX` is a byte of the UTF-8 text; anything malformed stays as it is.
inline std::string decode(std::string_view raw) {
  std::string out;
  out.reserve(raw.size());
  for (size_t i = 0; i < raw.size(); ++i) {
    if (raw[i] == '%' && i + 2 < raw.size() && hexDigit(raw[i + 1]) >= 0 && hexDigit(raw[i + 2]) >= 0) {
      out.push_back(static_cast<char>(hexDigit(raw[i + 1]) * 16 + hexDigit(raw[i + 2])));
      i += 2;
    } else {
      out.push_back(raw[i]);
    }
  }
  return out;
}

// `Number.parseInt(raw, 10)` with a fallback for text without a leading integer.
inline int32_t wireInt(const std::optional<std::string_view> &raw, int32_t fallback) {
  if (!raw || raw->empty()) return fallback;
  std::string text(*raw);
  char *end = nullptr;
  long value = std::strtol(text.c_str(), &end, 10);
  return end == text.c_str() ? fallback : static_cast<int32_t>(value);
}

template <class Sink>
class Writer {
 public:
  Writer(Sink &sink, const Parsed &parsed) : out_(sink), parsed_(parsed) {}

  int32_t count = 0;

  void begin(int32_t id) {
    out_.putInt(id);
    ++count;
  }
  void integer(int32_t value) { out_.putInt(value); }
  void integer(std::string_view key, int32_t fallback) { out_.putInt(wireInt(parsed_.find(key), fallback)); }
  void real(float value) { out_.putFloat(value); }
  // The decoded text of `key` as a string index, -1 when the key is absent.
  void string(std::string_view key) {
    auto raw = parsed_.find(key);
    out_.putInt(raw ? out_.addString(decode(*raw)) : -1);
  }
  // `hasColor` then the ARGB int of an `rrggbbaa` value; (0, 0) when absent or malformed.
  void color(std::string_view key) {
    auto raw = parsed_.find(key);
    bool valid = raw && raw->size() == 8;
    uint32_t rgba = 0;
    if (valid) {
      for (char c : *raw) {
        int digit = hexDigit(c);
        if (digit < 0) {
          valid = false;
          break;
        }
        rgba = (rgba << 4) | static_cast<uint32_t>(digit);
      }
    }
    out_.putInt(valid ? 1 : 0);
    out_.putInt(valid ? static_cast<int32_t>(((rgba & 0xFFu) << 24) | (rgba >> 8)) : 0);
  }
  bool has(std::string_view key) const { return parsed_.find(key).has_value(); }
  std::optional<std::string_view> raw(std::string_view key) const { return parsed_.find(key); }

 private:
  Sink &out_;
  const Parsed &parsed_;
};

inline int32_t barStyleCode(const std::optional<std::string_view> &raw) {
  if (raw && *raw == "l") return 1;
  if (raw && *raw == "d") return 2;
  return 0;
}

inline int32_t presentationCode(const std::optional<std::string_view> &raw) {
  if (!raw) return 0;
  if (*raw == "modal") return 1;
  if (*raw == "transparentModal") return 2;
  if (*raw == "sheet") return 3;
  if (*raw == "formSheet") return 4;
  return 0;
}

inline int32_t animationCode(const std::optional<std::string_view> &raw) {
  if (!raw) return 0;
  if (*raw == "none") return 1;
  if (*raw == "fade") return 2;
  if (*raw == "slide_from_right") return 3;
  if (*raw == "slide_from_bottom") return 4;
  return 0;
}

inline int32_t slotCode(std::string_view kind) {
  if (kind == "header-center") return 1;
  if (kind == "header-right") return 2;
  if (kind == "header-search") return 3;
  return 0;
}

// The detents of a sheet: fractions, -1 for "auto"; at most four; the default pair when the list is empty or absent.
inline std::vector<float> sheetDetents(const Parsed &parsed, bool formSheet) {
  std::vector<float> detents;
  if (formSheet) return {1.f};
  auto raw = parsed.find("dt");
  if (raw) {
    std::string_view rest = *raw;
    while (!rest.empty() && static_cast<int32_t>(detents.size()) < kMaxSheetDetents) {
      size_t comma = rest.find(',');
      std::string item = decode(rest.substr(0, comma));
      detents.push_back(item == "auto" ? -1.f : static_cast<float>(std::strtod(item.c_str(), nullptr)));
      if (comma == std::string_view::npos) break;
      rest.remove_prefix(comma + 1);
    }
  }
  if (detents.empty()) detents.assign(std::begin(kDefaultSheetDetents), std::end(kDefaultSheetDetents));
  return detents;
}

// Writes the records of one navigation node, in the order `decodeRecords` lists them; returns how many.
template <class Sink>
int32_t encodeRecords(Sink &out, std::string_view id) {
  auto parsed = parse(id);
  if (!parsed) return 0;
  Writer<Sink> w(out, *parsed);
  const std::string_view kind = parsed->kind;
  if (kind == "screen") {
    auto presentation = parsed->find("p");
    w.begin(kScreenRecord);
    w.integer("a", 2);
    w.integer(presentationCode(presentation));
    w.integer("g", 1);
    w.integer(animationCode(parsed->find("s")));
    w.integer("b", 1);
    const bool sheet = presentation && *presentation == "sheet";
    const bool form = presentation && *presentation == "formSheet";
    if (sheet || form) {
      std::vector<float> detents = sheetDetents(*parsed, form);
      const int32_t count = static_cast<int32_t>(detents.size());
      w.begin(kSheetRecord);
      w.integer(count);
      for (float detent : detents) w.real(detent);
      int32_t initial = wireInt(parsed->find("di"), 0);
      w.integer(initial < count - 1 ? initial : count - 1);
      w.integer("gr", form ? 0 : 1);
      w.integer("dm", 1);
      w.integer("bd", 0);
    }
    if (w.has("ss") || w.has("sx") || w.has("nc") || w.has("ns")) {
      w.begin(kSystemBarsRecord);
      w.integer(barStyleCode(parsed->find("ss")));
      w.integer("sx", 0);
      w.color("nc");
      w.integer(barStyleCode(parsed->find("ns")));
    }
  } else if (kind == "header") {
    int32_t flags = (wireInt(parsed->find("l"), 0) == 1 ? 1 : 0) | (wireInt(parsed->find("tl"), 0) == 1 ? 2 : 0) |
        (wireInt(parsed->find("bk"), 0) == 1 ? 4 : 0) | (wireInt(parsed->find("hs"), 0) == 1 ? 8 : 0);
    w.begin(kHeaderRecord);
    w.integer(flags);
    w.string("t");
    w.string("st");
    w.string("bt");
    w.color("tc");
    w.color("bg");
    w.begin(kHeaderSlotsRecord);
    w.integer("sl", 0);
  } else if (kind == "header-left" || kind == "header-center" || kind == "header-right" || kind == "header-search") {
    w.begin(kSlotRecord);
    w.integer(slotCode(kind));
    if (kind == "header-search") {
      w.begin(kSearchRecord);
      w.string("ph");
      w.string("v");
      w.integer("ec", 0);
    }
  } else if (kind == "tabs") {
    w.begin(kTabsRecord);
    w.integer("sel", 0);
    w.integer("sc", 0);
    w.color("tc");
    w.color("uc");
    w.color("bg");
    w.integer("lb", 0);
  } else if (kind == "tab") {
    auto badge = parsed->find("bd");
    w.begin(kTabRecord);
    w.string("k");
    w.string("t");
    w.string("ic");
    w.string("is");
    w.integer("iv", 0);
    w.integer(!badge ? 0 : decode(*badge).empty() ? 1 : 2);
    w.string("bd");
    w.integer("ds", 0);
  }
  return w.count;
}

} // namespace expo::svelteengine::nav
