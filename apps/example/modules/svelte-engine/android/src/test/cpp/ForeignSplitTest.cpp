// Host test of the foreign-view ownership rules (ForeignSplit.h): which mounting layer owns which node of a transaction.
// No Android, no JNI, no React Native. Usage: ForeignSplitTest   (src/test/run.sh runs it under ASan and UBSan)

#include "../../main/cpp/ForeignSplit.h"

#include <cstdio>
#include <vector>

using namespace expo::svelteengine::foreign;

namespace {

int failures = 0;

#define CHECK(cond, ...)                                                      \
  do {                                                                        \
    if (!(cond)) {                                                            \
      ++failures;                                                             \
      std::fprintf(stderr, "FAIL %s:%d: %s: ", __FILE__, __LINE__, #cond);    \
      std::fprintf(stderr, __VA_ARGS__);                                      \
      std::fprintf(stderr, "\n");                                             \
    }                                                                         \
  } while (0)

constexpr Tag kSurface = 1;

Item create(Tag tag, bool named = false) { return Item{Type::Create, tag, -1, named}; }
Item insert(Tag tag, Tag parent, bool named = false) { return Item{Type::Insert, tag, parent, named}; }
Item remove(Tag tag, Tag parent) { return Item{Type::Remove, tag, parent, false}; }
Item update(Tag tag, bool named = false) { return Item{Type::Update, tag, -1, named}; }
Item destroy(Tag tag) { return Item{Type::Delete, tag, -1, false}; }

std::vector<Owner> run(Ownership &ownership, const std::vector<Item> &items) {
  std::vector<Owner> owners(items.size(), Owner::Engine);
  ownership.classify(items.data(), items.size(), owners.data());
  return owners;
}

const char *name(Owner owner) { return owner == Owner::Engine ? "engine" : owner == Owner::Root ? "root" : "descendant"; }

void expect(const std::vector<Owner> &actual, const std::vector<Owner> &wanted, const char *what) {
  CHECK(actual.size() == wanted.size(), "%s: %zu owners for %zu items", what, actual.size(), wanted.size());
  for (size_t i = 0; i < actual.size() && i < wanted.size(); ++i) {
    CHECK(actual[i] == wanted[i], "%s: item %zu is %s, wanted %s", what, i, name(actual[i]), name(wanted[i]));
  }
}

constexpr Owner E = Owner::Engine;
constexpr Owner R = Owner::Root;
constexpr Owner D = Owner::Descendant;

void engineOnly() {
  Ownership ownership;
  expect(run(ownership, {create(10), create(12), insert(12, 10), insert(10, kSurface), update(12), remove(12, 10), destroy(12)}),
         {E, E, E, E, E, E, E}, "engine only");
  CHECK(ownership.empty(), "an engine-only transaction must leave the registry empty");
}

void rootUnderEngineParent() {
  Ownership ownership;
  // A web view in a row: the container is the engine's, the view is a root.
  expect(run(ownership, {create(10), create(12, true), insert(12, 10), insert(10, kSurface)}), {E, R, R, E}, "root create");
  CHECK(ownership.contains(12) && !ownership.contains(10), "only the web view is foreign");
  CHECK(ownership.roots() == 1 && ownership.size() == 1, "one root, nothing else");
  // A later transaction: props update, then a move out of the row.
  expect(run(ownership, {update(12, true), update(10)}), {R, E}, "root update");
  expect(run(ownership, {remove(12, 10), insert(12, 20)}), {R, R}, "root moves");
  expect(run(ownership, {remove(12, 20), destroy(12)}), {R, R}, "root delete");
  CHECK(!ownership.contains(12) && ownership.empty(), "a deleted root leaves the registry");
}

void descendantsByParent() {
  Ownership ownership;
  // A map with a marker (a foreign component under a foreign parent) and a plain view in the marker.
  expect(run(ownership, {create(30, true), create(32, true), create(34), insert(34, 32), insert(32, 30), insert(30, kSurface)}),
         {R, D, D, D, D, R}, "map with marker");
  CHECK(ownership.size() == 3 && ownership.roots() == 1, "map, marker and the view inside it");
  // A marker added later: its parent is known from the registry.
  expect(run(ownership, {create(36, true), insert(36, 30)}), {D, D}, "later marker");
  // A plain view under a foreign parent with no foreign name.
  expect(run(ownership, {create(38), insert(38, 30)}), {D, D}, "plain child of a foreign view");
  // Updates and removals of descendants stay foreign; an engine node next to the map stays the engine's.
  expect(run(ownership, {update(34), update(40), remove(36, 30), destroy(36), destroy(34), destroy(32), destroy(30)}),
         {D, E, D, D, D, D, R}, "updates and deletes");
  CHECK(ownership.size() == 1, "the plain child of the first map is still foreign: %zu", ownership.size());
  expect(run(ownership, {destroy(38)}), {D}, "last descendant");
  CHECK(ownership.empty(), "everything foreign is gone");
}

void childCreatedBeforeParent() {
  Ownership ownership;
  // The creates may come in any order; the inserts say who is under whom.
  expect(run(ownership, {create(52), create(50, true), create(54), insert(54, 52), insert(52, 50), insert(50, 10)}),
         {D, R, D, D, D, R}, "children created first");
  CHECK(ownership.size() == 3, "root and two descendants");
}

void deepChainAndEngineSiblings() {
  Ownership ownership;
  expect(run(ownership, {create(60), create(62), create(64, true), insert(62, 60), insert(64, 62), insert(60, kSurface)}),
         {E, E, R, E, R, E}, "foreign leaf under engine chain");
  Ownership nested;
  expect(run(nested, {create(70, true), create(72), create(74), create(76), insert(76, 74), insert(74, 72), insert(72, 70), insert(70, kSurface)}),
         {R, D, D, D, D, D, D, R}, "foreign root over a chain");
  CHECK(nested.size() == 4, "root and three descendants");
}

void tagReuseInOneTransaction() {
  Ownership ownership;
  run(ownership, {create(80, true), insert(80, kSurface)});
  // The node is deleted and a node of an engine component takes the tag in the same transaction.
  expect(run(ownership, {destroy(80), create(80), insert(80, kSurface)}), {R, E, E}, "tag reuse by an engine node");
  CHECK(ownership.empty(), "the reused tag is the engine's");
}

void noFalseForeignFromBatch() {
  Ownership ownership;
  // A foreign name in the batch must not turn an unrelated engine tree foreign.
  expect(run(ownership, {create(90, true), create(92), create(94), insert(94, 92), insert(92, kSurface), insert(90, kSurface)}),
         {R, E, E, E, E, R}, "unrelated engine tree");
}

void selfParentIsHarmless() {
  Ownership ownership;
  // A malformed insert must not recurse forever.
  expect(run(ownership, {create(100), insert(100, 100)}), {E, E}, "self parent");
}

} // namespace

// A shadow view says the name Fabric gives a component (`componentNameByReactViewName`): a registered "RCTVideo" has to match "Video".
void fabricNames() {
  const struct { const char *registered; const char *fabric; } cases[] = {
    {"RCTVideo", "Video"}, {"RNCWebView", "RNCWebView"}, {"RNMapsMapView", "RNMapsMapView"}, {"ViewManagerAdapter_ExpoImage", "ViewManagerAdapter_ExpoImage"},
    {"RiveReactNativeView", "RiveReactNativeView"}, {"RC", "RC"}, {"", ""}, {"RCT", ""}, {"MyRCTView", "MyRCTView"},
  };
  for (const auto &entry : cases) {
    const std::string got = fabricComponentName(entry.registered);
    if (got != entry.fabric) {
      std::fprintf(stderr, "FAIL fabric name of %s: got %s, wanted %s\n", entry.registered, got.c_str(), entry.fabric);
      failures++;
    }
  }
}

int main() {
  fabricNames();
  engineOnly();
  rootUnderEngineParent();
  descendantsByParent();
  childCreatedBeforeParent();
  deepChainAndEngineSiblings();
  tagReuseInOneTransaction();
  noFalseForeignFromBatch();
  selfParentIsHarmless();
  if (failures != 0) {
    std::fprintf(stderr, "%d failure(s)\n", failures);
    return 1;
  }
  std::printf("ForeignSplitTest: ok\n");
  return 0;
}
