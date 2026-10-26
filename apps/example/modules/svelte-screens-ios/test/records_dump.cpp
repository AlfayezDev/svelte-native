// Test driver for the pure parts of the module (native/Core). `bun test` in packages/svelte-native builds it with the
// system C++ compiler and compares what it prints with the reference decoder (`decodeRecords`) and with the expected
// plans. Modes (first argument), one input per line on standard input, one JSON value per line on standard output:
//   records  a nativeID               -> null | { "kind", "records": [{ "id", "values" }] } in the shape of `decodeRecords`
//   plan     "1,2,3|1,2,4"            -> { "step", "staged" } of planStack(current|desired)
//   detent   "<fraction> <max> <content>" -> detentHeight

#include <cmath>
#include <cstdio>
#include <iostream>
#include <sstream>
#include <string>
#include <vector>

#include "../native/Core/SvelteNativeID.h"
#include "../native/Core/SvelteScreensCore.h"

namespace {

using svelte::Color;

struct Out {
  std::string text;
  void raw(const std::string &value) { text += value; }
  void integer(long long value) { text += std::to_string(value); }
  void real(double value) {
    if (!std::isfinite(value)) {
      text += "null";
      return;
    }
    char buffer[40];
    std::snprintf(buffer, sizeof buffer, "%.17g", value);
    text += buffer;
  }
  void string(const std::string &value) {
    text += '"';
    for (unsigned char c : value) {
      if (c == '"' || c == '\\') {
        text += '\\';
        text += static_cast<char>(c);
      } else if (c < 0x20) {
        char buffer[8];
        std::snprintf(buffer, sizeof buffer, "\\u%04x", c);
        text += buffer;
      } else {
        text += static_cast<char>(c);
      }
    }
    text += '"';
  }
};

// One record: `values` holds numbers and strings in the order of the SPEC table.
struct Record {
  int id;
  Out values;
  bool first = true;
  explicit Record(int recordId) : id(recordId) {}
  void sep() {
    if (!first) values.raw(",");
    first = false;
  }
  Record &i(long long value) { sep(); values.integer(value); return *this; }
  Record &r(double value) { sep(); values.real(value); return *this; }
  Record &s(const std::optional<std::string> &value) {
    sep();
    if (value) values.string(*value);
    else values.integer(-1);
    return *this;
  }
  Record &c(const Color &value) { return i(value.set ? 1 : 0).i(value.argb); }
};

std::string recordsFor(const std::string &line) {
  const svelte::NativeId id = svelte::splitNativeId(line);
  const svelte::Kind kind = svelte::kindOf(id);
  if (kind == svelte::Kind::Unknown) return "null";
  std::vector<Record> records;
  int kindCode = 0;
  switch (kind) {
    case svelte::Kind::Stack: kindCode = 10; break;
    case svelte::Kind::Screen: {
      kindCode = 11;
      const svelte::ScreenSpec spec = svelte::parseScreen(id);
      records.push_back(Record(110).i(spec.activityState).i(spec.presentation).i(spec.gesture).i(spec.animation).i(spec.nativeBack));
      if (spec.isSheet()) {
        Record sheet(122);
        sheet.i(static_cast<long long>(spec.detents.size()));
        for (double detent : spec.detents) sheet.r(detent);
        sheet.i(spec.initialDetent).i(spec.grabber).i(spec.dismissible).i(spec.noBackdrop);
        records.push_back(sheet);
      }
      if (spec.hasBars) records.push_back(Record(125).i(spec.statusStyle).i(spec.statusHidden).c(spec.navigationBar).i(spec.navigationBarStyle));
      break;
    }
    case svelte::Kind::Header: {
      kindCode = 12;
      const svelte::HeaderSpec spec = svelte::parseHeader(id);
      const int flags = (spec.large ? 1 : 0) | (spec.translucent ? 2 : 0) | (spec.back ? 4 : 0) | (spec.hideShadow ? 8 : 0);
      records.push_back(Record(120).i(flags).s(spec.title).s(spec.subtitle).s(spec.backTitle).c(spec.tint).c(spec.background));
      records.push_back(Record(121).i(spec.slots));
      break;
    }
    case svelte::Kind::HeaderSlot: {
      kindCode = 13;
      const svelte::SlotSpec spec = svelte::parseSlot(id);
      records.push_back(Record(126).i(spec.slot));
      if (spec.slot == svelte::kSlotSearch) records.push_back(Record(127).s(spec.placeholder).s(spec.value).i(spec.eventCount));
      break;
    }
    case svelte::Kind::Tabs: {
      kindCode = 14;
      const svelte::TabsSpec spec = svelte::parseTabs(id);
      records.push_back(Record(123).i(spec.selected).i(spec.selectCount).c(spec.tint).c(spec.inactiveTint).c(spec.background).i(spec.noLabels));
      break;
    }
    case svelte::Kind::Tab: {
      kindCode = 15;
      const svelte::TabSpec spec = svelte::parseTab(id);
      records.push_back(Record(124).s(spec.key).s(spec.title).s(spec.icon).s(spec.selectedIcon).i(spec.iconIsView).i(spec.badgeKind).s(spec.badgeText).i(spec.disabled));
      break;
    }
    case svelte::Kind::TabIcon: kindCode = 16; break;
    case svelte::Kind::Unknown: break;
  }
  Out out;
  out.raw("{\"kind\":");
  out.integer(kindCode);
  out.raw(",\"records\":[");
  for (size_t index = 0; index < records.size(); index++) {
    if (index) out.raw(",");
    out.raw("{\"id\":");
    out.integer(records[index].id);
    out.raw(",\"values\":[");
    out.raw(records[index].values.text);
    out.raw("]}");
  }
  out.raw("]}");
  return out.text;
}

std::vector<int> ids(const std::string &list) {
  std::vector<int> out;
  std::stringstream stream(list);
  std::string item;
  while (std::getline(stream, item, ',')) out.push_back(std::stoi(item));
  return out;
}

std::string planFor(const std::string &line) {
  const size_t bar = line.find('|');
  const svelte::StackPlan plan = svelte::planStack(ids(line.substr(0, bar)), ids(line.substr(bar + 1)));
  const char *names[] = {"none", "replace", "push", "pop"};
  std::string out = std::string("{\"step\":\"") + names[static_cast<int>(plan.step)] + "\",\"staged\":[";
  for (size_t i = 0; i < plan.staged.size(); i++) out += (i ? "," : "") + std::to_string(plan.staged[i]);
  return out + "]}";
}

std::string detentFor(const std::string &line) {
  std::stringstream stream(line);
  double fraction = 0, maximum = 0, content = 0;
  stream >> fraction >> maximum >> content;
  Out out;
  out.real(svelte::detentHeight(fraction, maximum, content));
  return out.text;
}

}  // namespace

int main(int argc, char **argv) {
  const std::string mode = argc > 1 ? argv[1] : "";
  std::string line;
  while (std::getline(std::cin, line)) {
    if (mode == "records") std::cout << recordsFor(line) << "\n";
    else if (mode == "plan") std::cout << planFor(line) << "\n";
    else if (mode == "detent") std::cout << detentFor(line) << "\n";
    else return 2;
  }
  return 0;
}
