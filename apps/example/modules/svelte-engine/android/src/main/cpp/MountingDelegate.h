#pragma once

#include <fbjni/fbjni.h>
#include <react/renderer/core/EventEmitter.h>
#include <react/renderer/core/State.h>
#include <react/renderer/mounting/MountingOverrideDelegate.h>

#include <memory>
#include <mutex>
#include <string>
#include <unordered_map>
#include <unordered_set>
#include <vector>

#include "ForeignSplit.h"

namespace expo::svelteengine {

// Kotlin expo.modules.svelteengine.MountingManager
struct JMountingManager : facebook::jni::JavaClass<JMountingManager> {
  static constexpr auto kJavaDescriptor = "Lexpo/modules/svelteengine/MountingManager;";
};

class MountingDelegate : public facebook::react::MountingOverrideDelegate {
 public:
  explicit MountingDelegate(facebook::jni::global_ref<JMountingManager::javaobject> manager);

  bool shouldOverridePullTransaction() const override { return true; }

  std::optional<facebook::react::MountingTransaction> pullTransaction(
      facebook::react::SurfaceId surfaceId,
      facebook::react::MountingTransaction::Number number,
      const facebook::react::TransactionTelemetry &telemetry,
      facebook::react::ShadowViewMutationList mutations) const override;

  // JS reports whether Reanimated's module proxy (and so its commit hook) existed when the engine was installed;
  // only used for the "delegate order" log line.
  void setReanimatedHookFirst(bool first) { reanimatedHookFirst_ = first; }

  facebook::react::EventEmitter::Shared emitterFor(facebook::react::Tag tag) const;
  // How many nodes the delegate keeps an event emitter / a ScrollView state for (the soak runner's native leak check).
  size_t emitterCount() const;
  size_t scrollStateCount() const;
  // Latest shadow-node state of a ScrollView (used by updateScrollState); null for other tags.
  facebook::react::State::Shared scrollStateFor(facebook::react::Tag tag) const;

  // Foreign views (SPEC.md, "Foreign views"): components other libraries mount through React Native's own Java
  // mounting. The host registers a component's name before its first node is committed; the delegate keeps those
  // nodes, and everything under them, out of the engine's batch and returns their mutations to React Native.
  void registerForeignComponent(const std::string &name);
  // Whether React Native's mounting owns [tag] (a foreign view or something inside one); any thread.
  bool isForeignTag(facebook::react::Tag tag) const;
  // Nodes (roots and descendants) React Native's mounting owns right now; any thread.
  size_t foreignNodeCount() const;

 private:
  void setEmitter(facebook::react::Tag tag, const facebook::react::EventEmitter::Shared &emitter) const;
  void eraseEmitter(facebook::react::Tag tag) const;
  void setScrollState(facebook::react::Tag tag, const facebook::react::State::Shared &state) const;
  // One owner per mutation, or empty when every mutation is the engine's (see the definition).
  std::vector<foreign::Owner> classifyForeign(const facebook::react::ShadowViewMutationList &mutations) const;
  // Caller holds foreignMutex_.
  bool isForeignName(const char *componentName) const;

  facebook::jni::global_ref<JMountingManager::javaobject> manager_;
  mutable std::mutex emittersMutex_;
  mutable std::unordered_map<facebook::react::Tag, facebook::react::EventEmitter::Shared> emitters_;
  mutable std::unordered_map<facebook::react::Tag, facebook::react::State::Shared> scrollStates_;
  mutable float lastScale_{1.f};
  mutable std::mutex foreignMutex_;
  std::unordered_set<std::string> foreignNames_;
  mutable foreign::Ownership foreign_;
  // Foreign roots React Native created and has not inserted yet. Only the thread that pulls transactions touches it.
  mutable std::unordered_set<facebook::react::Tag> foreignAwaitingInsert_;
  bool reanimatedHookFirst_{false};
  mutable std::unordered_map<facebook::react::SurfaceId, bool> loggedSurfaces_;
};

// What actually sits in a surface's override-delegate chain. React Native keeps delegates as weak pointers, so
// dropping a handle removes it from the chain and appending a fresh one moves the engine behind delegates added
// since (SvelteEngineNative, "reanimatedLoaded").
class DelegateHandle : public facebook::react::MountingOverrideDelegate {
 public:
  explicit DelegateHandle(std::shared_ptr<MountingDelegate> core) : core_(std::move(core)) {}
  bool shouldOverridePullTransaction() const override { return true; }
  std::optional<facebook::react::MountingTransaction> pullTransaction(
      facebook::react::SurfaceId surfaceId,
      facebook::react::MountingTransaction::Number number,
      const facebook::react::TransactionTelemetry &telemetry,
      facebook::react::ShadowViewMutationList mutations) const override {
    return core_->pullTransaction(surfaceId, number, telemetry, std::move(mutations));
  }

 private:
  std::shared_ptr<MountingDelegate> core_;
};

} // namespace expo::svelteengine
