#include "SvelteEngineNative.h"

#include <react/renderer/core/ShadowNodeFragment.h>
#include <unordered_map>

#include "AnimatedBridge.h"
#include "InputEvents.h"
#include "PropsEncoderNav.h"

#include <android/log.h>
#include <react/fabric/FabricUIManagerBinding.h>
#include <react/renderer/components/scrollview/ScrollViewEventEmitter.h>
#include <react/renderer/components/view/TouchEventEmitter.h>
#include <react/renderer/mounting/ShadowTree.h>
#include <react/renderer/mounting/ShadowTreeRegistry.h>
#include <react/renderer/scheduler/Scheduler.h>
#include <react/renderer/uimanager/UIManager.h>
#include <react/renderer/uimanager/UIManagerCommitHook.h>
#include <react/timing/primitives.h>

using namespace facebook;
using namespace facebook::react;

namespace expo::svelteengine {

namespace {
constexpr const char *kTag = "SvelteEngine";
}

// Attaches our delegate to each surface on its first commit seen by this hook (same trick as Reanimated's commit hook).
// Commit hooks run in registration order. When Reanimated is loaded before install (an app that imports it at start)
// its hook is registered first, so on a surface's first commit its LayoutAnimationsProxy is already in the chain and
// ours lands after it: the proxy sees the real mutations and rewrites them, our delegate mounts the rewritten list.
// The Fabric host loads Reanimated on the first animated view instead (reanimatedLoaded below), after our hook: then
// Reanimated's hook appends its proxy on the next commit, and one commit later we append a fresh handle behind it.
class SurfaceHook : public UIManagerCommitHook {
 public:
  SurfaceHook(std::shared_ptr<UIManager> uiManager, std::shared_ptr<MountingDelegate> core)
      : uiManager_(std::move(uiManager)), core_(std::move(core)), handle_(std::make_shared<DelegateHandle>(core_)) {
    uiManager_->registerCommitHook(*this);
  }
  ~SurfaceHook() noexcept override {
    uiManager_->unregisterCommitHook(*this);
  }

  void commitHookWasRegistered(const UIManager &) noexcept override {}
  void commitHookWasUnregistered(const UIManager &) noexcept override {}

  // Every surface seen so far re-attaches two commits from now (its own commits: Reanimated's hook, registered after
  // ours, appends its proxy during the first of them).
  void scheduleReattach() {
    std::lock_guard<std::mutex> lock(mutex_);
    for (const auto surfaceId : seen_) reattachIn_[surfaceId] = 2;
  }

  RootShadowNode::Unshared shadowTreeWillCommit(
      const ShadowTree &,
      const RootShadowNode::Shared &,
      const RootShadowNode::Unshared &newRootShadowNode,
      const ShadowTreeCommitOptions &) noexcept override {
    const SurfaceId surfaceId = newRootShadowNode->getSurfaceId();
    std::lock_guard<std::mutex> lock(mutex_);
    auto pending = reattachIn_.find(surfaceId);
    if (pending != reattachIn_.end() && --pending->second == 0) {
      reattachIn_.erase(pending);
      // The handle is per hook, not per surface; a fresh one is appended wherever the re-attach is due, the old one
      // expires everywhere at once (its last owner is this field), so surfaces still counting down briefly have no
      // delegate of ours in their chain. Only the first surface exists when Reanimated loads in practice.
      handle_ = std::make_shared<DelegateHandle>(core_);
      uiManager_->getShadowTreeRegistry().visit(surfaceId, [this](const ShadowTree &shadowTree) {
        shadowTree.getMountingCoordinator()->setMountingOverrideDelegate(handle_);
      });
      __android_log_print(ANDROID_LOG_INFO, kTag, "delegate re-attached behind Reanimated's proxy (surface %d)", static_cast<int>(surfaceId));
    }
    if (seen_.insert(surfaceId).second) {
      // Appends to a list: must run once per surface.
      uiManager_->getShadowTreeRegistry().visit(surfaceId, [this](const ShadowTree &shadowTree) {
        shadowTree.getMountingCoordinator()->setMountingOverrideDelegate(handle_);
      });
    }
    return newRootShadowNode;
  }

 private:
  std::mutex mutex_;
  std::set<SurfaceId> seen_;
  std::unordered_map<SurfaceId, int> reattachIn_;
  std::shared_ptr<UIManager> uiManager_;
  std::shared_ptr<MountingDelegate> core_;
  std::shared_ptr<DelegateHandle> handle_;
};

SvelteEngineNative::SvelteEngineNative(jni::global_ref<JMountingManager::javaobject> mountingManager)
    : delegate_(std::make_shared<MountingDelegate>(std::move(mountingManager))) {
  setViewEventsDelegate(delegate_);
}

SvelteEngineNative::~SvelteEngineNative() {
  hook_.reset();
}

jni::local_ref<SvelteEngineNative::jhybriddata> SvelteEngineNative::initHybrid(
    jni::alias_ref<jhybridobject>,
    jni::alias_ref<JFabricUIManager::javaobject>,
    jni::alias_ref<JMountingManager::javaobject> mountingManager) {
  return makeCxxInstance(jni::make_global(mountingManager));
}

void SvelteEngineNative::install(jni::alias_ref<JFabricUIManager::javaobject> fabricUIManager, jboolean reanimatedReady) {
  auto binding = fabricUIManager->getBinding();
  auto scheduler = binding ? binding->getScheduler() : nullptr;
  if (!scheduler) {
    __android_log_print(ANDROID_LOG_ERROR, kTag, "install: no scheduler (Fabric not started?)");
    return;
  }
  scheduler_ = scheduler;
  uiManager_ = scheduler->getUIManager();
  hook_ = std::make_unique<SurfaceHook>(uiManager_, delegate_);
  delegate_->setReanimatedHookFirst(reanimatedReady);
  __android_log_print(
      ANDROID_LOG_INFO, kTag, "install: commit hook registered, delegate attaches on each surface's first commit (reanimated hook %s)",
      reanimatedReady ? "registered before ours" : "not present yet");
}

// The Fabric host loaded Reanimated after install. Two empty commits per surface: during the first, Reanimated's
// commit hook appends its LayoutAnimationsProxy; during the second, ours appends a fresh handle behind it. The
// animated commit that triggered the load then already runs through the proxy first.
void SvelteEngineNative::reanimatedLoaded() {
  if (!hook_ || !uiManager_) return;
  delegate_->setReanimatedHookFirst(true);
  hook_->scheduleReattach();
  for (int round = 0; round < 2; ++round) {
    uiManager_->getShadowTreeRegistry().enumerate([](const ShadowTree &shadowTree, bool &) {
      shadowTree.commit(
          [](const RootShadowNode &oldRoot) { return std::static_pointer_cast<RootShadowNode>(oldRoot.ShadowNode::clone(ShadowNodeFragment{})); },
          ShadowTreeCommitOptions{});
    });
  }
}

void SvelteEngineNative::registerForeign(jni::alias_ref<jstring> name) {
  const std::string component = name->toStdString();
  delegate_->registerForeignComponent(component);
  __android_log_print(ANDROID_LOG_INFO, kTag, "foreign component registered: %s", component.c_str());
}

jboolean SvelteEngineNative::isForeign(jint tag) {
  return delegate_->isForeignTag(tag) ? JNI_TRUE : JNI_FALSE;
}

jint SvelteEngineNative::foreignCount() {
  return static_cast<jint>(delegate_->foreignNodeCount());
}

// An accessibility service activated a clickable node (ACTION_CLICK -> performClick -> here): the node's emitter sends
// `click`, which the host turns into the press (as the Android touch path would).
void SvelteEngineNative::dispatchClick(jint tag) {
  auto emitter = delegate_->emitterFor(tag);
  if (!emitter) {
    return;
  }
  emitter->dispatchEvent("click", folly::dynamic::object(), RawEvent::Category::Discrete);
}

void SvelteEngineNative::dispatchScroll(
    jint tag,
    jint kind,
    jfloat offsetX,
    jfloat offsetY,
    jfloat contentW,
    jfloat contentH,
    jfloat containerW,
    jfloat containerH,
    jfloat velocityX,
    jfloat velocityY) {
  auto emitter = delegate_->emitterFor(tag);
  if (!emitter) {
    return;
  }
  auto scrollEmitter = std::static_pointer_cast<const ScrollViewEventEmitter>(emitter);  // only scroll views call this
  if (!scrollEmitter) {
    return;
  }

  ScrollEvent event;
  event.contentOffset = Point{offsetX, offsetY};
  event.contentSize = Size{contentW, contentH};
  event.containerSize = Size{containerW, containerH};
  event.contentInset = EdgeInsets{};
  event.zoomScale = 1;
  // ScrollEvent::timestamp is in seconds (JS multiplies by 1000); same clock as MotionEvent uptime.
  event.timestamp = static_cast<Float>(
      std::chrono::duration<double>(std::chrono::steady_clock::now().time_since_epoch()).count());

  switch (kind) {
    case 0: scrollEmitter->onScroll(event); break;
    case 1: scrollEmitter->onScrollBeginDrag(event); break;
    case 2: {
      ScrollEndDragEvent end(event);
      end.targetContentOffset = event.contentOffset;
      end.velocity = Point{velocityX, velocityY};
      scrollEmitter->onScrollEndDrag(end);
      break;
    }
    case 3: scrollEmitter->onMomentumScrollBegin(event); break;
    case 4: scrollEmitter->onMomentumScrollEnd(event); break;
    default: break;
  }
}

void SvelteEngineNative::registerNatives() {
  registerHybrid({
      makeNativeMethod("initHybrid", SvelteEngineNative::initHybrid),
      makeNativeMethod("install", SvelteEngineNative::install),
      makeNativeMethod("dispatchTouch", SvelteEngineNative::dispatchTouch),
      makeNativeMethod("dispatchScroll", SvelteEngineNative::dispatchScroll),
      makeNativeMethod("dispatchClick", SvelteEngineNative::dispatchClick),
      makeNativeMethod("reportMount", SvelteEngineNative::reportMount),
      makeNativeMethod("reanimatedLoaded", SvelteEngineNative::reanimatedLoaded),
      makeNativeMethod("registerForeign", SvelteEngineNative::registerForeign),
      makeNativeMethod("isForeign", SvelteEngineNative::isForeign),
      makeNativeMethod("foreignCount", SvelteEngineNative::foreignCount),
      makeNativeMethod("updateScrollState", SvelteEngineNative::updateScrollState),
  });
  registerViewEventNatives();
  registerAnimatedBridgeNatives();
  registerNavEventNatives();
}

} // namespace expo::svelteengine

void expo::svelteengine::SvelteEngineNative::reportMount(jint surfaceId) {
  if (scheduler_) scheduler_->reportMount(static_cast<facebook::react::SurfaceId>(surfaceId));
}
