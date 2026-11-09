#pragma once
#include <react/renderer/scheduler/Scheduler.h>

#include <fbjni/fbjni.h>
#include <react/fabric/JFabricUIManager.h>

#include <memory>
#include <mutex>
#include <set>

#include "MountingDelegate.h"

namespace facebook::react {
class UIManager;
}

namespace expo::svelteengine {

class SurfaceHook;

// Java: expo.modules.svelteengine.SvelteEngineNative
class SvelteEngineNative : public facebook::jni::HybridClass<SvelteEngineNative> {
 public:
  static constexpr auto kJavaDescriptor = "Lexpo/modules/svelteengine/SvelteEngineNative;";

  static facebook::jni::local_ref<jhybriddata> initHybrid(
      facebook::jni::alias_ref<jhybridobject>,
      facebook::jni::alias_ref<facebook::react::JFabricUIManager::javaobject> fabricUIManager,
      facebook::jni::alias_ref<JMountingManager::javaobject> mountingManager);

  static void registerNatives();
  /** Tells Fabric a transaction was mounted (fires UIManagerMountHooks, which Reanimated uses to drop removed nodes). */
  void reportMount(jint surfaceId);
  void reanimatedLoaded();
  // Foreign views (SPEC.md, "Foreign views"): a component name whose nodes React Native's Java mounting owns, whether
  // React Native's mounting owns a tag, and how many nodes it owns now.
  void registerForeign(facebook::jni::alias_ref<jstring> name);
  jboolean isForeign(jint tag);
  jint foreignCount();
  // Live sizes of the delegate's tables (emitters, scroll states), for the soak runner.
  jint emitterCount();
  jint scrollStateCount();

  ~SvelteEngineNative();

  void install(facebook::jni::alias_ref<facebook::react::JFabricUIManager::javaobject> fabricUIManager, jboolean reanimatedReady);
  // Multi-pointer touch: per-pointer arrays are read up to `count` entries (see TouchDispatch.cpp).
  void dispatchTouch(
      jint surfaceId,
      jint type,
      jint changedIndex,
      jint count,
      facebook::jni::alias_ref<jintArray> targets,
      facebook::jni::alias_ref<jintArray> identifiers,
      facebook::jni::alias_ref<jfloatArray> pageX,
      facebook::jni::alias_ref<jfloatArray> pageY,
      facebook::jni::alias_ref<jfloatArray> localX,
      facebook::jni::alias_ref<jfloatArray> localY,
      jdouble timestampMs);
  /** An accessibility click on a clickable node: emits `click` on its event emitter. */
  void dispatchClick(jint tag);
  // Pushes a ScrollView's content offset (points) into its Fabric state (Commands.cpp).
  void updateScrollState(jint tag, jfloat offsetX, jfloat offsetY);
  void dispatchScroll(
      jint tag,
      jint kind,
      jfloat offsetX,
      jfloat offsetY,
      jfloat contentW,
      jfloat contentH,
      jfloat containerW,
      jfloat containerH,
      jfloat velocityX,
      jfloat velocityY);

 private:
  friend HybridBase;
  explicit SvelteEngineNative(facebook::jni::global_ref<JMountingManager::javaobject> mountingManager);

  std::shared_ptr<MountingDelegate> delegate_;
  std::shared_ptr<facebook::react::UIManager> uiManager_;
  std::shared_ptr<facebook::react::Scheduler> scheduler_;
  std::unique_ptr<SurfaceHook> hook_;
};

} // namespace expo::svelteengine
