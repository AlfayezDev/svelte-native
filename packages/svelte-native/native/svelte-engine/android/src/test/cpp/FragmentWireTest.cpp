// Host test of the record a text's state carries for each fragment (FragmentWire.h, SPEC.md "Touches on nested Text"): the node the fragment's text sits in and whether that
// node is a link, from React Native's `Role` and `AccessibilityRole` (plain structs, AccessibilityPrimitives.h: no Android, no JNI, no Fabric), and which component names
// are a Text nested in a Text. Writes the streams it verified to a fixture that FragmentWireCheck.kt decodes with the production Kotlin decoder (FragmentWire.kt), so both
// halves of the wire are checked against the same bytes. Usage: FragmentWireTest <fixture output path> (src/test/run.sh does both steps).

#include "../../main/cpp/FragmentWire.h"

#include <cstdio>
#include <fstream>
#include <optional>
#include <string>
#include <vector>

using namespace expo::svelteengine::fragmentwire;
using facebook::react::AccessibilityRole;
using facebook::react::Role;

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
  void begin(int32_t id) {
    ++ops[0];
    ops.push_back(id);
  }
  void putInt(int32_t v) { ops.push_back(v); }
};

std::ofstream fixture;

void run(const char *name, int32_t tag, std::optional<Role> role, std::optional<AccessibilityRole> accessibilityRole, bool link) {
  Out out;
  encodeTarget(out, tag, role, accessibilityRole);
  const std::vector<int32_t> wanted{1, 27, tag, link ? 1 : 0};
  CHECK(out.ops == wanted, "%s: wrote %zu ints, wanted %zu", name, out.ops.size(), wanted.size());
  for (size_t i = 0; i < out.ops.size() && i < wanted.size(); ++i) {
    if (out.ops[i] != wanted[i]) std::fprintf(stderr, "   %s: ops[%zu] is %d, wanted %d\n", name, i, out.ops[i], wanted[i]);
  }
  CHECK(isLink(role, accessibilityRole) == link, "%s: isLink", name);
  fixture << name << '\t';
  for (size_t i = 0; i < out.ops.size(); ++i) fixture << (i ? "," : "") << out.ops[i];
  fixture << '\t' << tag << '\t' << (link ? 1 : 0) << '\n';
}

} // namespace

int main(int argc, char **argv) {
  if (argc < 2) {
    std::fprintf(stderr, "usage: FragmentWireTest <fixture output path>\n");
    return 2;
  }
  fixture.open(argv[1]);

  CHECK(kFragmentTarget == 27, "the record id");
  CHECK(kLink == 1, "the link flag");

  // The tag is the node's, whatever it is.
  run("plain", 7, std::nullopt, std::nullopt, false);
  run("tag-is-the-nodes", 123456, std::nullopt, std::nullopt, false);
  // `role` or `accessibilityRole` "link" makes a link; `role` decides when it is set at all (TextLayoutManager.roleIsLink).
  run("role-link", 9, Role::Link, std::nullopt, true);
  run("accessibility-role-link", 11, std::nullopt, AccessibilityRole::Link, true);
  run("role-link-over-button", 13, Role::Link, AccessibilityRole::Button, true);
  run("role-button-over-link", 15, Role::Button, AccessibilityRole::Link, false);
  run("role-none-over-link", 17, Role::None, AccessibilityRole::Link, false);
  run("accessibility-role-button", 19, std::nullopt, AccessibilityRole::Button, false);
  run("accessibility-role-none", 21, std::nullopt, AccessibilityRole::None, false);
  run("role-button", 23, Role::Button, std::nullopt, false);

  // Two fragments of one paragraph: two records in a stream, in order.
  {
    Out out;
    encodeTarget(out, 5, std::nullopt, std::nullopt);
    encodeTarget(out, 8, Role::Link, std::nullopt);
    const std::vector<int32_t> wanted{2, 27, 5, 0, 27, 8, 1};
    CHECK(out.ops == wanted, "two fragments");
  }

  // The nodes whose event emitters the delegate keeps although they have no view.
  CHECK(isNestedTextName("Text"), "Text");
  CHECK(isNestedTextName("VirtualText"), "VirtualText");
  CHECK(isNestedTextName("RCTVirtualText"), "RCTVirtualText");
  CHECK(!isNestedTextName("RCTText"), "RCTText is the paragraph");
  CHECK(!isNestedTextName("Paragraph"), "Paragraph is the paragraph");
  CHECK(!isNestedTextName("RawText"), "RawText");
  CHECK(!isNestedTextName("RCTRawText"), "RCTRawText");
  CHECK(!isNestedTextName("View"), "View");
  CHECK(!isNestedTextName("RCTView"), "RCTView");
  CHECK(!isNestedTextName("AndroidTextInput"), "AndroidTextInput");
  CHECK(!isNestedTextName("Texts"), "a name that starts with one");
  CHECK(!isNestedTextName(""), "an empty name");
  CHECK(!isNestedTextName(nullptr), "no name");

  fixture.close();
  if (failures) {
    std::fprintf(stderr, "%d check(s) failed\n", failures);
    return 1;
  }
  std::fprintf(stderr, "FragmentWireTest: all checks passed\n");
  return 0;
}
