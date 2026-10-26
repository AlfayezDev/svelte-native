#pragma once

// Which mounting layer owns which node of a transaction (SPEC.md, "Foreign views").
//
// A foreign view is a view another library mounts through React Native's own Java mounting: a component whose name the
// host registered (`RNCWebView`, `RNMapsMapView`, an Expo module's `ViewManagerAdapter_...`), and everything below it.
// The engine owns every other node. A foreign component directly under an engine node is a root: the engine keeps a
// frame for it (`EngineForeign`) and React Native creates and updates the view itself. A node under a foreign node is a
// descendant, whatever its component name: React Native mounts it into the foreign view's own ViewGroupManager.
//
// No React Native and no JNI in this header, so `android/src/test` compiles and runs it on the host.

#include <cstddef>
#include <cstdint>
#include <unordered_map>
#include <unordered_set>
#include <vector>

namespace expo::svelteengine::foreign {

using Tag = int32_t;

enum class Type : uint8_t { Create, Delete, Insert, Remove, Update };
enum class Owner : uint8_t { Engine, Root, Descendant };

// One mutation of a transaction, reduced to what ownership depends on. `parent` is the parent tag of an Insert (the only
// mutation that moves a node under a parent); `named` says the node's component name is a registered foreign component.
struct Item {
  Type type;
  Tag tag;
  Tag parent;
  bool named;
};

// The tags React Native's Java mounting owns, kept across transactions. Single-threaded (the thread that pulls
// transactions) except `contains` and `size`, which callers guard with their own lock.
class Ownership {
 public:
  bool empty() const { return roots_.empty() && descendants_.empty(); }
  size_t size() const { return roots_.size() + descendants_.size(); }
  size_t roots() const { return roots_.size(); }
  bool contains(Tag tag) const { return roots_.count(tag) != 0 || descendants_.count(tag) != 0; }

  // Classifies the items of one transaction in order, writing one owner per item, and updates the registry: a Create or
  // an Insert of a foreign node adds it, a Delete drops it after it was classified (a Delete is still foreign).
  void classify(const Item *items, size_t count, Owner *owners);

 private:
  Owner resolve(Tag tag, bool named, const std::unordered_map<Tag, Tag> &parentOf, const std::unordered_set<Tag> &namedInBatch) const;

  std::unordered_set<Tag> roots_;
  std::unordered_set<Tag> descendants_;
};

inline Owner Ownership::resolve(
    Tag tag, bool named, const std::unordered_map<Tag, Tag> &parentOf, const std::unordered_set<Tag> &namedInBatch) const {
  if (roots_.count(tag)) return Owner::Root;
  if (descendants_.count(tag)) return Owner::Descendant;
  // Under a foreign node a node is a descendant even when its own component is foreign (a map's marker): React Native
  // mounts it into its parent. The parent's owner comes from the same rules, so a chain resolves bottom up.
  auto parent = parentOf.find(tag);
  if (parent != parentOf.end() && parent->second != tag) {
    if (resolve(parent->second, namedInBatch.count(parent->second) != 0, parentOf, namedInBatch) != Owner::Engine) {
      return Owner::Descendant;
    }
  }
  return named ? Owner::Root : Owner::Engine;
}

inline void Ownership::classify(const Item *items, size_t count, Owner *owners) {
  // The parents of the nodes this transaction inserts, and the nodes of foreign components it mentions. A Create comes
  // before the Insert that gives the node its parent, so the whole list is read first.
  std::unordered_map<Tag, Tag> parentOf;
  std::unordered_set<Tag> namedInBatch;
  for (size_t i = 0; i < count; ++i) {
    if (items[i].type == Type::Insert) parentOf[items[i].tag] = items[i].parent;
    if (items[i].named) namedInBatch.insert(items[i].tag);
  }
  for (size_t i = 0; i < count; ++i) {
    const Item &item = items[i];
    const Owner owner = resolve(item.tag, item.named, parentOf, namedInBatch);
    owners[i] = owner;
    switch (item.type) {
      case Type::Create:
      case Type::Insert:
      case Type::Update:
        if (owner == Owner::Root) roots_.insert(item.tag);
        else if (owner == Owner::Descendant) descendants_.insert(item.tag);
        break;
      case Type::Delete:
        roots_.erase(item.tag);
        descendants_.erase(item.tag);
        break;
      case Type::Remove:
        break;
    }
  }
}

// Whether a transaction can contain anything foreign: the registry has nodes, or one of the components it creates is a
// registered foreign component. Lets an engine-only transaction skip the classification.
inline bool mayContainForeign(const Ownership &ownership, bool anyNamedCreate) {
  return !ownership.empty() || anyNamedCreate;
}

} // namespace expo::svelteengine::foreign
