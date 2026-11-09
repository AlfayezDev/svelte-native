#include "PropsEncoderNav.h"

#include <fbjni/fbjni.h>
#include <folly/dynamic.h>
#include <react/renderer/core/EventEmitter.h>

#include <string>

#include "InputEvents.h"
#include "PropsEncoderNavRecords.h"

using namespace facebook;
using namespace facebook::react;

namespace expo::svelteengine {

namespace {

// Dispatches `topXxx` on the emitter of [tag]; the host maps it to the `onXxx` attribute.
void dispatch(jint tag, const char *name, folly::dynamic payload) {
  auto emitter = emitterForTag(tag);
  if (!emitter) return;
  emitter->dispatchEvent(std::string(name), std::move(payload));
}

// Screen dismissed by the user (back button or gesture): `topDismissed { dismissCount: 1 }`, as react-native-screens.
void dismissed(jni::alias_ref<jclass>, jint tag) {
  dispatch(tag, "dismissed", folly::dynamic::object("dismissCount", 1)("target", tag));
}

// JavaScript set the screen's activityState to 0 and the stack finished taking it away (SPEC, "Screen exit").
void exited(jni::alias_ref<jclass>, jint tag) {
  dispatch(tag, "exited", folly::dynamic::object("target", tag));
}

void appear(jni::alias_ref<jclass>, jint tag) {
  dispatch(tag, "appear", folly::dynamic::object("target", tag));
}

void disappear(jni::alias_ref<jclass>, jint tag) {
  dispatch(tag, "disappear", folly::dynamic::object("target", tag));
}

// A user drag settled a sheet on another detent: `index` into the detents as given, `fraction` of the available height.
void detentChange(jni::alias_ref<jclass>, jint tag, jint index, jfloat fraction) {
  dispatch(tag, "detentChange", folly::dynamic::object("index", index)("fraction", fraction)("target", tag));
}

// Header, tab bar or toolbar size in dp: `height` including the inset, and the inset itself.
void metrics(jni::alias_ref<jclass>, jint tag, jfloat height, jfloat inset) {
  dispatch(tag, "metrics", folly::dynamic::object("height", height)("inset", inset)("target", tag));
}

// The header search was dismissed (close button, back key).
void cancel(jni::alias_ref<jclass>, jint tag) {
  dispatch(tag, "cancel", folly::dynamic::object("target", tag));
}

// A tab bar press.
void select(jni::alias_ref<jclass>, jint tag, jni::alias_ref<jstring> key, jint index) {
  dispatch(tag, "select", folly::dynamic::object("key", key ? key->toStdString() : std::string())("index", index)("target", tag));
}

// A toolbar item press, sent to the toolbar node: `topPress { key, index }`; `index` counts the item nodes, spacers included.
void press(jni::alias_ref<jclass>, jint tag, jni::alias_ref<jstring> key, jint index) {
  dispatch(tag, "press", folly::dynamic::object("key", key ? key->toStdString() : std::string())("index", index)("target", tag));
}

} // namespace

Kind kindForView(const ShadowView &view) {
  Kind kind = kindForComponent(view.componentName);
  if (kind != kView || !view.props) return kind;
  switch (nav::kindOfNativeId(view.props->nativeId)) {
    case nav::kStackNode: return kStack;
    case nav::kScreenNode: return kScreen;
    case nav::kHeaderNode: return kHeader;
    case nav::kHeaderSlotNode: return kHeaderSlot;
    case nav::kTabsNode: return kTabs;
    case nav::kTabNode: return kTab;
    case nav::kTabIconNode: return kTabIcon;
    case nav::kToolbarNode: return kToolbar;
    case nav::kToolbarItemNode: return kToolbarItem;
    default: return kind;
  }
}

int32_t encodeNavProps(Batch &batch, Kind kind, const ShadowView &view) {
  if (!isNavKind(kind) || !view.props) return 0;
  return nav::encodeRecords(batch, view.props->nativeId);
}

void registerNavEventNatives() {
  jni::findClassStatic("expo/modules/svelteengine/NavEvents")
      ->registerNatives({
          makeNativeMethod("dismissed", dismissed),
          makeNativeMethod("exited", exited),
          makeNativeMethod("appear", appear),
          makeNativeMethod("disappear", disappear),
          makeNativeMethod("detentChange", detentChange),
          makeNativeMethod("metrics", metrics),
          makeNativeMethod("cancel", cancel),
          makeNativeMethod("select", select),
          makeNativeMethod("press", press),
      });
}

} // namespace expo::svelteengine
