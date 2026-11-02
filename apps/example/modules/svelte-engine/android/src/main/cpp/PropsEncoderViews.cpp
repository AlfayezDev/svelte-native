#include "PropsEncoderViews.h"

#include <react/renderer/attributedstring/AttributedStringBox.h>
#include <react/renderer/components/FBReactNativeSpec/Props.h>
#include <react/renderer/components/androidtextinput/AndroidTextInputProps.h>
#include <react/renderer/components/androidtextinput/AndroidTextInputState.h>
#include <react/renderer/components/image/ImageProps.h>
#include <react/renderer/core/ConcreteState.h>
#include <react/renderer/core/State.h>
#include <react/renderer/mounting/ShadowView.h>

#include <cmath>
#include <limits>
#include <mutex>
#include <unordered_map>

using namespace facebook::react;

namespace expo::svelteengine {

namespace {

// Prop ids reserved for the view kinds (SPEC-views.md).
enum ViewPropId : int32_t {
  kInputTextStyle = 40,
  kInputTextProp = 41,
  kInputPlaceholder = 42,
  kInputBehavior = 43,
  kInputKeyboard = 44,
  kInputReturnKey = 45,
  kInputColors = 46,
  kInputFocusFlags = 47,
  kInputStateText = 48,
  kSwitchValue = 60,
  kSwitchEnabled = 61,
  kSwitchThumb = 62,
  kSwitchTrackFalse = 63,
  kSwitchTrackTrue = 64,
  kSwitchTrackTint = 65,
  kSpinnerStyle = 70,
  kSpinnerAnimating = 71,
  kSpinnerColor = 72,
  kSpinnerProgress = 73,
  kImageSource = 80,
  kImageResizeMode = 81,
  kImageTint = 82,
  kImageHeaders = 83,
  kModalProps = 100,
};

struct Out {
  Batch &b;
  int32_t count = 0;
  void begin(int32_t id) {
    b.putInt(id);
    ++count;
  }
  void optColor(const SharedColor &c) {
    b.putInt(c ? 1 : 0);
    b.putInt(c ? static_cast<int32_t>(*c) : 0);
  }
  int32_t str(const std::string &s) { return b.addString(s); }
};

inline float scaleOf(const ShadowView &view, float fallback) {
  return view.layoutMetrics == EmptyLayoutMetrics ? fallback : static_cast<float>(view.layoutMetrics.pointScaleFactor);
}

int32_t keyboardCode(const std::string &k) {
  if (k == "numeric") return 1;
  if (k == "number-pad") return 2;
  if (k == "decimal-pad") return 3;
  if (k == "email-address") return 4;
  if (k == "phone-pad") return 5;
  if (k == "visible-password") return 6;
  if (k == "url") return 7;
  return 0;
}

int32_t capitalizeCode(const std::string &c) {
  if (c == "none") return 0;
  if (c == "characters") return 1;
  if (c == "words") return 2;
  return 3;  // sentences, also the default
}

int32_t returnKeyCode(const std::string &r) {
  if (r == "go") return 1;
  if (r == "next") return 2;
  if (r == "none") return 3;
  if (r == "previous") return 4;
  if (r == "search") return 5;
  if (r == "send") return 6;
  return 0;  // done
}

int32_t textAlignCode(const std::optional<TextAlignment> &a) {
  if (!a.has_value()) return 0;
  switch (*a) {
    case TextAlignment::Center: return 1;
    case TextAlignment::Right: return 2;
    case TextAlignment::Justified: return 3;
    default: return 0;
  }
}

int32_t spinnerStyleCode(const std::string &s) {
  if (s == "Small") return 1;
  if (s == "Large") return 2;
  if (s == "Horizontal") return 3;
  if (s == "Inverse") return 4;
  if (s == "SmallInverse") return 5;
  if (s == "LargeInverse") return 6;
  return 0;  // Normal
}

// React Native's `setAutoCorrect` takes a nullable Boolean: unset leaves the keyboard alone, false turns suggestions (and the platform's spell
// checker) off. The typed prop is false until set, so what this commit's raw props carried says which it was (InputRules.kt: 1 on, 2 off,
// 0 removed, -1 not part of this update, the view keeps what it had).
int32_t autoCorrectCode(const AndroidTextInputProps &p) {
  const folly::dynamic *raw = p.rawProps.isObject() ? p.rawProps.get_ptr("autoCorrect") : nullptr;
  if (raw == nullptr) return -1;
  if (raw->isBool()) return raw->getBool() ? 1 : 2;
  return 0;
}

void encodeInput(Out &o, const ShadowView &view, float scale) {
  const auto &p = static_cast<const AndroidTextInputProps &>(*view.props);
  auto &b = o.b;

  const auto &ta = p.textAttributes;
  float fontSize = std::isnan(ta.fontSize) ? 14.f : static_cast<float>(ta.fontSize);
  float multiplier = 1.f;
  if (!std::isnan(ta.fontSizeMultiplier) && ta.allowFontScaling.value_or(true)) {
    multiplier = static_cast<float>(ta.fontSizeMultiplier);
  }
  o.begin(kInputTextStyle);
  b.putFloat(fontSize * multiplier * scale);
  o.optColor(ta.foregroundColor);
  b.putInt(ta.fontWeight.has_value() ? static_cast<int32_t>(*ta.fontWeight) : 400);
  b.putInt(ta.fontStyle.has_value() && *ta.fontStyle != FontStyle::Normal ? 1 : 0);
  b.putInt(ta.fontFamily.empty() ? -1 : o.str(ta.fontFamily));
  b.putFloat(std::isnan(ta.letterSpacing) ? 0.f : static_cast<float>(ta.letterSpacing) * multiplier * scale);
  b.putFloat(std::isnan(ta.lineHeight) ? 0.f : static_cast<float>(ta.lineHeight) * multiplier * scale);
  b.putInt(textAlignCode(ta.alignment));

  o.begin(kInputTextProp);
  b.putInt(o.str(p.text));
  b.putInt(p.mostRecentEventCount);

  o.begin(kInputPlaceholder);
  b.putInt(p.placeholder.empty() ? -1 : o.str(p.placeholder));
  o.optColor(p.placeholderTextColor);

  o.begin(kInputBehavior);
  b.putInt(p.secureTextEntry ? 1 : 0);
  b.putInt(p.multiline ? 1 : 0);
  b.putInt(p.editable && !p.readOnly ? 1 : 0);
  b.putInt(p.maxLength == std::numeric_limits<int>::max() ? -1 : p.maxLength);

  o.begin(kInputKeyboard);
  b.putInt(keyboardCode(p.keyboardType));
  b.putInt(capitalizeCode(p.autoCapitalize));
  b.putInt(autoCorrectCode(p));

  int32_t submit = 0;
  switch (p.getNonDefaultSubmitBehavior()) {
    case SubmitBehavior::Submit: submit = 1; break;
    case SubmitBehavior::BlurAndSubmit: submit = 2; break;
    case SubmitBehavior::Newline: submit = 3; break;
    default: break;
  }
  o.begin(kInputReturnKey);
  b.putInt(returnKeyCode(p.returnKeyType));
  b.putInt(submit);

  o.begin(kInputColors);
  o.optColor(p.selectionColor);
  o.optColor(p.cursorColor);

  o.begin(kInputFocusFlags);
  b.putInt(p.autoFocus ? 1 : 0);
  b.putInt(p.selectTextOnFocus ? 1 : 0);
  b.putInt(p.caretHidden ? 1 : 0);
}

void encodeSwitch(Out &o, const ShadowView &view) {
  const auto &p = static_cast<const AndroidSwitchProps &>(*view.props);
  auto &b = o.b;
  o.begin(kSwitchValue);
  b.putInt(p.value || p.on ? 1 : 0);
  o.begin(kSwitchEnabled);
  b.putInt(p.enabled && !p.disabled ? 1 : 0);
  o.begin(kSwitchThumb);
  o.optColor(p.thumbColor ? p.thumbColor : p.thumbTintColor);
  o.begin(kSwitchTrackFalse);
  o.optColor(p.trackColorForFalse);
  o.begin(kSwitchTrackTrue);
  o.optColor(p.trackColorForTrue);
  o.begin(kSwitchTrackTint);
  o.optColor(p.trackTintColor);
}

void encodeSpinner(Out &o, const ShadowView &view) {
  const auto &p = static_cast<const AndroidProgressBarProps &>(*view.props);
  auto &b = o.b;
  o.begin(kSpinnerStyle);
  b.putInt(spinnerStyleCode(p.styleAttr));
  o.begin(kSpinnerAnimating);
  b.putInt(p.animating ? 1 : 0);
  o.begin(kSpinnerColor);
  o.optColor(p.color);
  o.begin(kSpinnerProgress);
  b.putInt(p.indeterminate ? 1 : 0);
  b.putFloat(static_cast<float>(p.progress));
}

void encodeImage(Out &o, const ShadowView &view) {
  const auto &p = static_cast<const ImageProps &>(*view.props);
  auto &b = o.b;
  o.begin(kImageSource);
  if (p.sources.empty() || p.sources[0].uri.empty()) {
    b.putInt(-1);
    b.putFloat(0);
    b.putFloat(0);
    b.putFloat(1);
  } else {
    const auto &s = p.sources[0];
    b.putInt(o.str(s.uri));
    b.putFloat(static_cast<float>(s.size.width));
    b.putFloat(static_cast<float>(s.size.height));
    b.putFloat(static_cast<float>(s.scale));
  }
  o.begin(kImageResizeMode);
  b.putInt(static_cast<int32_t>(p.resizeMode));
  o.begin(kImageTint);
  o.optColor(p.tintColor);
  if (!p.sources.empty() && !p.sources[0].headers.empty()) {
    const auto &h = p.sources[0].headers;
    o.begin(kImageHeaders);
    b.putInt(static_cast<int32_t>(h.size()));
    for (const auto &kv : h) {
      b.putInt(o.str(kv.first));
      b.putInt(o.str(kv.second));
    }
  }
}

void encodeModal(Out &o, const ShadowView &view) {
  const auto &p = static_cast<const ModalHostViewProps &>(*view.props);
  auto &b = o.b;
  o.begin(kModalProps);
  int32_t anim = 0;
  switch (p.animationType) {
    case ModalHostViewAnimationType::Slide: anim = 1; break;
    case ModalHostViewAnimationType::Fade: anim = 2; break;
    default: break;
  }
  b.putInt(anim);
  b.putInt(p.transparent ? 1 : 0);
  b.putInt(p.statusBarTranslucent ? 1 : 0);
  b.putInt(p.navigationBarTranslucent ? 1 : 0);
  b.putInt(p.hardwareAccelerated ? 1 : 0);
  b.putInt(p.visible ? 1 : 0);
}

std::mutex gStatesMutex;
std::unordered_map<Tag, State::Shared> gModalStates;

} // namespace

int32_t encodeViewKindProps(Batch &batch, Kind kind, const ShadowView &view, float fallbackScale) {
  if (!view.props) return 0;
  Out o{batch};
  switch (kind) {
    case kInput: encodeInput(o, view, scaleOf(view, fallbackScale)); break;
    case kSwitch: encodeSwitch(o, view); break;
    case kProgress: encodeSpinner(o, view); break;
    case kImage: encodeImage(o, view); break;
    case kModal: encodeModal(o, view); break;
    default: break;
  }
  return o.count;
}

int32_t encodeViewKindState(Batch &batch, Kind kind, const ShadowView &view, float) {
  if (kind != kInput || !view.state) return 0;
  const auto &data = static_cast<const ConcreteState<AndroidTextInputState> &>(*view.state).getData();
  std::string text;
  if (data.attributedStringBox.getMode() == AttributedStringBox::Mode::Value) {
    for (const auto &fragment : data.attributedStringBox.getValue().getFragments()) {
      if (!fragment.isAttachment()) text += fragment.string;
    }
  }
  Out o{batch};
  o.begin(kInputStateText);
  batch.putInt(o.str(text));
  batch.putInt(static_cast<int32_t>(data.mostRecentEventCount));
  return o.count;
}

void noteViewState(Kind kind, const ShadowView &view) {
  if (kind != kModal || !view.state) return;
  std::lock_guard<std::mutex> lock(gStatesMutex);
  gModalStates[view.tag] = view.state;
}

void forgetViewState(Tag tag) {
  std::lock_guard<std::mutex> lock(gStatesMutex);
  gModalStates.erase(tag);
}

bool updateModalSize(Tag tag, float widthDp, float heightDp) {
  State::Shared state;
  {
    std::lock_guard<std::mutex> lock(gStatesMutex);
    auto it = gModalStates.find(tag);
    if (it == gModalStates.end()) return false;
    state = it->second;
  }
  // Same payload as ReactModalHostView.DialogRootViewGroup.updateState.
  state->updateState(folly::dynamic::object("screenWidth", widthDp)("screenHeight", heightDp));
  return true;
}

} // namespace expo::svelteengine
