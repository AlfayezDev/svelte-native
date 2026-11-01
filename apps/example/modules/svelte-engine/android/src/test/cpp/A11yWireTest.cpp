// Host test of the accessibility records the engine encodes (A11yWire.h): React Native's accessibility props in, records out.
// No Android, no JNI, no Fabric: the header takes React Native's own plain structs (AccessibilityPrimitives.h). Writes the streams it
// verified to a fixture that A11yRulesCheck.kt decodes with the production Kotlin decoder (A11yRecords), so both halves of the wire
// are checked against the same bytes. Usage: A11yWireTest <react-native ReactCommon directory is on the include path> <fixture output path>
// (src/test/run.sh does both steps).

#include "../../main/cpp/A11yWire.h"

#include <cstdio>
#include <cstring>
#include <fstream>
#include <string>
#include <vector>

using namespace expo::svelteengine::a11y;
using namespace facebook::react;

namespace {

int failures = 0;

#define CHECK(cond, ...)                                                       \
  do {                                                                         \
    if (!(cond)) {                                                             \
      ++failures;                                                              \
      std::fprintf(stderr, "FAIL %s:%d: %s: ", __FILE__, __LINE__, #cond);     \
      std::fprintf(stderr, __VA_ARGS__);                                       \
      std::fprintf(stderr, "\n");                                              \
    }                                                                          \
  } while (0)

// What PropsEncoder's Records adapter is: a record count in front, then the records.
struct Out {
  std::vector<int32_t> ops{0};
  std::vector<std::string> strings;
  void begin(int32_t id) {
    ++ops[0];
    ops.push_back(id);
  }
  void putInt(int32_t v) { ops.push_back(v); }
  int32_t addString(const std::string &s) {
    strings.push_back(s);
    return static_cast<int32_t>(strings.size() - 1);
  }
};

struct Inputs {
  std::optional<AccessibilityState> state;
  AccessibilityValue value;
  std::string hint;
  std::vector<AccessibilityAction> actions;
  AccessibilityLiveRegion live = AccessibilityLiveRegion::None;
  ImportantForAccessibility important = ImportantForAccessibility::Auto;
  Role role = Role::None;
};

std::ofstream fixture;

std::string hex(const std::string &s) {
  std::string out;
  char buffer[3];
  for (unsigned char c : s) {
    std::snprintf(buffer, sizeof(buffer), "%02x", c);
    out += buffer;
  }
  return out.empty() ? "00" : out; // a leading 00 byte marks an empty string (strings never contain NUL)
}

// Encodes `p`, checks the records against `ops` (what the wire must carry, written out by hand) and `strings`, and records the stream
// with the text the Kotlin decoder must render for it.
void run(const char *name, const Inputs &p, const std::vector<int32_t> &ops, const std::vector<std::string> &strings, const std::string &rendered) {
  Out out;
  const int32_t records = encode(out, Fields{p.state, p.value, p.hint, p.actions, p.live, p.important, p.role});
  CHECK(records == out.ops[0], "%s: returned %d records, wrote %d", name, records, out.ops[0]);
  CHECK(out.ops == ops, "%s: ops differ (got %zu ints, wanted %zu)", name, out.ops.size(), ops.size());
  for (size_t i = 0; i < out.ops.size() && i < ops.size(); ++i) {
    if (out.ops[i] != ops[i]) std::fprintf(stderr, "   %s: ops[%zu] is %d, wanted %d\n", name, i, out.ops[i], ops[i]);
  }
  CHECK(out.strings == strings, "%s: strings differ", name);
  fixture << name << '\t';
  for (size_t i = 0; i < out.ops.size(); ++i) fixture << (i ? "," : "") << out.ops[i];
  fixture << '\t';
  if (out.strings.empty()) fixture << "-";
  for (size_t i = 0; i < out.strings.size(); ++i) fixture << (i ? "," : "") << hex(out.strings[i]);
  fixture << '\t' << rendered << '\n';
}

AccessibilityState state(bool disabled, bool selected, bool busy, AccessibilityState::CheckedState checked, std::optional<bool> expanded) {
  AccessibilityState s;
  s.disabled = disabled;
  s.selected = selected;
  s.busy = busy;
  s.checked = checked;
  s.expanded = expanded;
  return s;
}

} // namespace

int main(int argc, char **argv) {
  if (argc < 2) {
    std::fprintf(stderr, "usage: A11yWireTest <fixture output path>\n");
    return 2;
  }
  fixture.open(argv[1]);

  // The ordinals the wire carries for `role` are the order of React Native's enum (A11yRulesCheck reads the header and the Kotlin tables from it).
  CHECK(static_cast<int>(Role::Alert) == 0, "Role::Alert");
  CHECK(static_cast<int>(Role::Button) == 5, "Role::Button");
  CHECK(static_cast<int>(Role::None) == 35, "Role::None");
  CHECK(static_cast<int>(Role::Slider) == 49, "Role::Slider");
  CHECK(static_cast<int>(Role::Treeitem) == 64, "Role::Treeitem");

  using S = AccessibilityState;

  // Nothing set: no records, so a plain view costs nothing on the wire.
  run("nothing", Inputs{}, {0}, {}, "");

  // The state, one bit at a time, then together. A state with every default is still a record: the prop was set.
  {
    Inputs p;
    p.state = S{};
    run("state-empty", p, {1, 16, 0}, {}, "state=0");
    p.state = state(true, false, false, S::None, std::nullopt);
    run("state-disabled", p, {1, 16, 1}, {}, "state=1");
    p.state = state(false, true, false, S::None, std::nullopt);
    run("state-selected", p, {1, 16, 2}, {}, "state=2");
    p.state = state(false, false, true, S::None, std::nullopt);
    run("state-busy", p, {1, 16, 4}, {}, "state=4");
    p.state = state(false, false, false, S::Unchecked, std::nullopt);
    run("state-unchecked", p, {1, 16, 8}, {}, "state=8");
    p.state = state(false, false, false, S::Checked, std::nullopt);
    run("state-checked", p, {1, 16, 16}, {}, "state=16");
    p.state = state(false, false, false, S::Mixed, std::nullopt);
    run("state-mixed", p, {1, 16, 24}, {}, "state=24");
    p.state = state(false, false, false, S::None, false);
    run("state-collapsed", p, {1, 16, 32}, {}, "state=32");
    p.state = state(false, false, false, S::None, true);
    run("state-expanded", p, {1, 16, 64}, {}, "state=64");
    p.state = state(true, true, true, S::Checked, true);
    run("state-all", p, {1, 16, 1 + 2 + 4 + 16 + 64}, {}, "state=87");
  }

  // The value: the mask names the fields that follow.
  {
    Inputs p;
    p.value.text = "Half";
    run("value-text", p, {1, 17, 8, 0}, {"Half"}, "value=mask:8,text:Half");
    p.value = {};
    p.value.min = 0;
    p.value.max = 10;
    p.value.now = 3;
    run("value-range", p, {1, 17, 7, 0, 10, 3}, {}, "value=mask:7,min:0,max:10,now:3");
    p.value.min = -5;
    p.value.text = "3 of 10";
    run("value-all", p, {1, 17, 15, -5, 10, 3, 0}, {"3 of 10"}, "value=mask:15,min:-5,max:10,now:3,text:3 of 10");
    p.value = {};
    p.value.now = 4;
    run("value-now-only", p, {1, 17, 4, 4}, {}, "value=mask:4,now:4");
  }

  // The hint, the actions (a label is optional: -1), the live region and importantForAccessibility, and the role.
  {
    Inputs p;
    p.hint = "Opens the thread";
    run("hint", p, {1, 18, 0}, {"Opens the thread"}, "hint=Opens the thread");
    p = Inputs{};
    p.actions = {AccessibilityAction{"activate", std::nullopt}, AccessibilityAction{"archive", std::string("Archive")}};
    run("actions", p, {1, 19, 2, 0, -1, 1, 2}, {"activate", "archive", "Archive"}, "actions=activate|,archive|Archive");
    p = Inputs{};
    p.live = AccessibilityLiveRegion::Polite;
    run("live-polite", p, {1, 25, 1}, {}, "mode=1");
    p.live = AccessibilityLiveRegion::Assertive;
    run("live-assertive", p, {1, 25, 2}, {}, "mode=2");
    p = Inputs{};
    p.important = ImportantForAccessibility::Yes;
    run("important-yes", p, {1, 25, 4}, {}, "mode=4");
    p.important = ImportantForAccessibility::No;
    run("important-no", p, {1, 25, 8}, {}, "mode=8");
    p.important = ImportantForAccessibility::NoHideDescendants;
    p.live = AccessibilityLiveRegion::Polite;
    run("important-hide-and-live", p, {1, 25, 13}, {}, "mode=13");
    p = Inputs{};
    p.role = Role::Button;
    run("role-button", p, {1, 26, 5}, {}, "role=5");
    p.role = Role::Slider;
    run("role-slider", p, {1, 26, 49}, {}, "role=49");
  }

  // Everything at once, in id order: a slider, and the records of a checkbox.
  {
    Inputs p;
    p.state = state(false, false, false, S::Checked, std::nullopt);
    p.value.min = 0;
    p.value.max = 100;
    p.value.now = 40;
    p.value.text = "40 percent";
    p.hint = "Adjusts the volume";
    p.actions = {AccessibilityAction{"increment", std::nullopt}, AccessibilityAction{"decrement", std::nullopt}};
    p.live = AccessibilityLiveRegion::Assertive;
    p.role = Role::Slider;
    run("slider", p,
        {6, 16, 16, 17, 15, 0, 100, 40, 0, 18, 1, 19, 2, 2, -1, 3, -1, 25, 2, 26, 49},
        {"40 percent", "Adjusts the volume", "increment", "decrement"},
        "state=16 value=mask:15,min:0,max:100,now:40,text:40 percent hint=Adjusts the volume actions=increment|,decrement| mode=2 role=49");
  }

  fixture.close();
  if (failures) {
    std::fprintf(stderr, "%d check(s) failed\n", failures);
    return 1;
  }
  std::fprintf(stderr, "A11yWireTest: all checks passed\n");
  return 0;
}
