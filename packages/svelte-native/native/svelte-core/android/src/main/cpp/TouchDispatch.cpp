#include <android/log.h>
#include <react/renderer/components/view/TouchEventEmitter.h>
#include <react/timing/primitives.h>

#include <chrono>
#include <vector>

#include "SvelteEngineNative.h"

using namespace facebook;
using namespace facebook::react;

namespace expo::svelteengine {

namespace {
constexpr const char *kTag = "SvelteEngine";
constexpr jint kMaxPointers = 32;

enum TouchType : jint { kStart = 0, kMove = 1, kEnd = 2, kCancel = 3 };
} // namespace

// Mirrors JSTouchDispatcher + TouchesHelper (NOTES.md section 5), for all active pointers of one gesture.
//
//  type          emitted to                          touches            changedTouches
//  0 START       target of pointer `changedIndex`    all pointers       [changedIndex]
//  1 MOVE        each distinct target, once          all pointers       all pointers
//  2 END         target of pointer `changedIndex`    all but changed    [changedIndex]
//  3 CANCEL      each distinct target, once          []                 all pointers
//
// `targetTouches` = the `touches` whose target is the event's target. `Touch.target` is the tag fixed at DOWN for that
// pointer. Arrays hold `count` entries: DOWN target tag, pointer id, page and target-local coordinates in points.
void SvelteEngineNative::dispatchTouch(
    jint surfaceId,
    jint type,
    jint changedIndex,
    jint count,
    jni::alias_ref<jintArray> targets,
    jni::alias_ref<jintArray> identifiers,
    jni::alias_ref<jfloatArray> pageX,
    jni::alias_ref<jfloatArray> pageY,
    jni::alias_ref<jfloatArray> localX,
    jni::alias_ref<jfloatArray> localY,
    jdouble timestampMs) {
  (void)surfaceId;
  if (count <= 0 || count > kMaxPointers) {
    return;
  }
  jint tg[kMaxPointers];
  jint id[kMaxPointers];
  jfloat px[kMaxPointers], py[kMaxPointers], lx[kMaxPointers], ly[kMaxPointers];
  targets->getRegion(0, count, tg);
  identifiers->getRegion(0, count, id);
  pageX->getRegion(0, count, px);
  pageY->getRegion(0, count, py);
  localX->getRegion(0, count, lx);
  localY->getRegion(0, count, ly);

  const auto stamp = HighResTimeStamp::fromChronoSteadyClockTimePoint(std::chrono::steady_clock::time_point(
      std::chrono::duration_cast<std::chrono::steady_clock::duration>(std::chrono::duration<double, std::milli>(timestampMs))));

  auto makeTouch = [&](int i) {
    Touch touch;
    touch.pagePoint = Point{px[i], py[i]};
    touch.offsetPoint = Point{lx[i], ly[i]};
    touch.screenPoint = Point{px[i], py[i]};
    touch.identifier = id[i];
    touch.target = tg[i];
    touch.force = 0;
    touch.timestamp = static_cast<Float>(timestampMs / 1000.0); // deprecated field, seconds
    touch.timeStamp = stamp;
    return touch;
  };

  const bool single = type == kStart || type == kEnd;
  if (single && (changedIndex < 0 || changedIndex >= count)) {
    return;
  }

  // Event targets in first-appearance order.
  std::vector<Tag> eventTargets;
  if (single) {
    eventTargets.push_back(tg[changedIndex]);
  } else {
    for (int i = 0; i < count; ++i) {
      bool seen = false;
      for (Tag t : eventTargets) seen = seen || t == tg[i];
      if (!seen) eventTargets.push_back(tg[i]);
    }
  }

  for (Tag target : eventTargets) {
    auto emitter = delegate_->emitterFor(target);
    if (!emitter) {
      __android_log_print(ANDROID_LOG_WARN, kTag, "dispatchTouch: no event emitter for tag %d", target);
      continue;
    }
    // Every engine view maps to a ViewEventEmitter (or a subclass), which derives from TouchEventEmitter; cast
    // statically like React Native does (type info may be hidden across the libreactnative boundary).
    auto touchEmitter = std::static_pointer_cast<const TouchEventEmitter>(emitter);

    TouchEvent event;
    for (int i = 0; i < count; ++i) {
      Touch touch = makeTouch(i);
      const bool isChanged = type == kMove || type == kCancel || i == changedIndex;
      const bool inTouches = type != kCancel && !(type == kEnd && i == changedIndex);
      if (isChanged) event.changedTouches.insert(touch);
      if (inTouches) {
        event.touches.insert(touch);
        if (tg[i] == target) event.targetTouches.insert(touch);
      }
    }

    switch (type) {
      case kStart: touchEmitter->onTouchStart(std::move(event)); break;
      case kMove: touchEmitter->onTouchMove(std::move(event)); break;
      case kEnd: touchEmitter->onTouchEnd(std::move(event)); break;
      case kCancel: touchEmitter->onTouchCancel(std::move(event)); break;
      default: break;
    }
  }
}

} // namespace expo::svelteengine
