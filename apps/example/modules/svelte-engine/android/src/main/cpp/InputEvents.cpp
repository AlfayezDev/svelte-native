#include "InputEvents.h"

#include <android/log.h>
#include <fbjni/fbjni.h>
#include <folly/dynamic.h>
#include <react/renderer/components/FBReactNativeSpec/EventEmitters.h>
#include <react/renderer/components/image/ImageEventEmitter.h>
#include <react/renderer/core/EventEmitter.h>

#include <memory>
#include <mutex>
#include <string>

#include "PropsEncoderViews.h"

using namespace facebook;
using namespace facebook::jni;
using namespace facebook::react;

namespace expo::svelteengine {

namespace {

constexpr const char *kTag = "SvelteEngine";

std::mutex gMutex;
std::weak_ptr<MountingDelegate> gDelegate;

EventEmitter::Shared emitterFor(jint tag) {
  std::shared_ptr<MountingDelegate> delegate;
  {
    std::lock_guard<std::mutex> lock(gMutex);
    delegate = gDelegate.lock();
  }
  return delegate ? delegate->emitterFor(tag) : nullptr;
}

void send(const EventEmitter &emitter, const char *name, folly::dynamic payload) {
  emitter.dispatchEvent(std::string(name), std::move(payload));
}

std::string toStd(jni::alias_ref<jstring> s) {
  return s ? s->toStdString() : std::string();
}

// Input kinds (ViewEvents.INPUT_*). Payloads match React Native's ReactTextChangedEvent etc.
void input(
    jni::alias_ref<jclass>,
    jint tag,
    jint kind,
    jni::alias_ref<jstring> text,
    jint eventCount,
    jint selStart,
    jint selEnd) {
  auto emitter = emitterFor(tag);
  if (!emitter) return;
  switch (kind) {
    case 0:  // change: text, eventCount, selection
      send(*emitter, "change",
          folly::dynamic::object("text", toStd(text))("eventCount", eventCount)("target", tag)(
              "selection", folly::dynamic::object("start", selStart)("end", selEnd)));
      break;
    case 1: send(*emitter, "focus", folly::dynamic::object("target", tag)); break;
    case 2: send(*emitter, "blur", folly::dynamic::object("target", tag)); break;
    case 3:  // endEditing, sent after blur like ReactTextInputEndEditingEvent
      send(*emitter, "endEditing", folly::dynamic::object("target", tag)("text", toStd(text)));
      break;
    case 4:  // submitEditing
      send(*emitter, "submitEditing", folly::dynamic::object("target", tag)("text", toStd(text)));
      break;
    case 5: send(*emitter, "keyPress", folly::dynamic::object("key", toStd(text))); break;
    case 6:
      send(*emitter, "selectionChange",
          folly::dynamic::object("selection", folly::dynamic::object("start", selStart)("end", selEnd)));
      break;
    default: break;
  }
}

void switchChange(jni::alias_ref<jclass>, jint tag, jboolean value) {
  auto emitter = emitterFor(tag);
  if (!emitter) return;
  // AndroidSwitchEventEmitter::onChange: topChange { value, target }
  std::static_pointer_cast<const AndroidSwitchEventEmitter>(emitter)->onChange(
      AndroidSwitchEventEmitter::OnChange{.value = value == JNI_TRUE, .target = tag});
}

// Image kinds (ViewEvents.IMAGE_*): 0 loadStart, 1 load, 2 error, 3 loadEnd.
void image(
    jni::alias_ref<jclass>,
    jint tag,
    jint kind,
    jfloat width,
    jfloat height,
    jni::alias_ref<jstring> uri,
    jni::alias_ref<jstring> error) {
  auto emitter = emitterFor(tag);
  if (!emitter) return;
  auto imageEmitter = std::static_pointer_cast<const ImageEventEmitter>(emitter);
  switch (kind) {
    case 0: imageEmitter->onLoadStart(); break;
    case 1: {
      ImageSource source;
      source.type = ImageSource::Type::Remote;
      source.uri = toStd(uri);
      source.scale = 1;
      source.size = Size{width, height};  // pixels; onLoad multiplies by scale (1)
      imageEmitter->onLoad(source);
      break;
    }
    case 2: {
      ImageErrorInfo info;
      info.error = toStd(error);
      imageEmitter->onError(info);
      break;
    }
    case 3: imageEmitter->onLoadEnd(); break;
    default: break;
  }
}

// Modal kinds (ViewEvents.MODAL_*): 0 requestClose, 1 show, 2 dismiss.
void modal(jni::alias_ref<jclass>, jint tag, jint kind) {
  auto emitter = emitterFor(tag);
  if (!emitter) return;
  auto modalEmitter = std::static_pointer_cast<const ModalHostViewEventEmitter>(emitter);
  switch (kind) {
    case 0: modalEmitter->onRequestClose(ModalHostViewEventEmitter::OnRequestClose{}); break;
    case 1: modalEmitter->onShow(ModalHostViewEventEmitter::OnShow{}); break;
    case 2: modalEmitter->onDismiss(ModalHostViewEventEmitter::OnDismiss{}); break;
    default: break;
  }
}

void modalSize(jni::alias_ref<jclass>, jint tag, jfloat widthDp, jfloat heightDp) {
  if (!updateModalSize(tag, widthDp, heightDp)) {
    __android_log_print(ANDROID_LOG_WARN, kTag, "modalSize: no state for tag %d", tag);
  }
}

} // namespace

EventEmitter::Shared emitterForTag(Tag tag) {
  return emitterFor(static_cast<jint>(tag));
}

void setViewEventsDelegate(std::shared_ptr<MountingDelegate> delegate) {
  std::lock_guard<std::mutex> lock(gMutex);
  gDelegate = std::move(delegate);
}

void registerViewEventNatives() {
  jni::findClassStatic("expo/modules/svelteengine/ViewEvents")
      ->registerNatives({
          makeNativeMethod("input", input),
          makeNativeMethod("switchChange", switchChange),
          makeNativeMethod("image", image),
          makeNativeMethod("modal", modal),
          makeNativeMethod("modalSize", modalSize),
      });
}

} // namespace expo::svelteengine
