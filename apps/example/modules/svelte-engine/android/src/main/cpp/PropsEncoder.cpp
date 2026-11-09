#include "PropsEncoder.h"

#include "A11yWire.h"
#include "PropsEncoderNav.h"
#include "PropsEncoderViews.h"

#include <react/renderer/attributedstring/AttributedString.h>
#include <react/renderer/components/scrollview/ScrollViewProps.h>
#include <react/renderer/components/text/ParagraphProps.h>
#include <react/renderer/components/text/ParagraphState.h>
#include <react/renderer/components/view/ViewProps.h>
#include <react/renderer/core/ConcreteState.h>
#include <react/renderer/core/LayoutMetrics.h>

#include <cmath>
#include <limits>
#include <cstring>

using namespace facebook::react;

namespace expo::svelteengine {

namespace {

enum PropId : int32_t {
  kBackgroundColor = 1,
  kOpacity = 2,
  kBorderRadius = 3,
  kBorderWidth = 4,
  kBorderColor = 5,
  kTransform = 6,
  kOverflow = 7,
  kPointerEvents = 8,
  kElevation = 9,
  kTestId = 10,
  kAccessibilityLabel = 11,
  kAccessible = 12,
  kAccessibilityRole = 13,
  kHitSlop = 14,
  kViewFlags = 15,
  kParagraph = 20,
  kFragment = 21,
  kPreparedLayout = 22,
  kParagraphExtra = 23,
  kFragmentExtra = 24,
  kHorizontal = 30,
  kShowsScrollIndicator = 31,
  kScrollEnabled = 32,
  kScrollEventThrottle = 33,
  kScrollContentOffset = 34,
  kScrollSnap = 35,
  kScrollSnapOffsets = 36,
  kScrollDecelerationRate = 37,
  kScrollKeyboardDismiss = 38,
  kScrollOverScroll = 39,
};

inline int32_t colorInt(const SharedColor &c) {
  return c ? static_cast<int32_t>(*c) : 0;
}

inline float sanitize(float v) {
  return std::isfinite(v) ? v : 0.f;
}

inline bool layoutIsEmpty(const LayoutMetrics &m) {
  return m == EmptyLayoutMetrics;
}

inline float scaleOf(const ShadowView &view, float fallback) {
  return layoutIsEmpty(view.layoutMetrics) ? fallback : static_cast<float>(view.layoutMetrics.pointScaleFactor);
}

// Counts records by tracking the position of the nProps slot.
struct Records {
  Batch &batch;
  size_t countSlot;
  int32_t count = 0;

  explicit Records(Batch &b) : batch(b), countSlot(b.ops.size()) { b.putInt(0); }
  void begin(int32_t id) {
    batch.putInt(id);
    ++count;
  }
  void finish() { batch.ops[countSlot] = count; }
};

void encodeCommon(Records &r, const ShadowView &view, float scale) {
  auto &b = r.batch;
  const auto &p = static_cast<const ViewProps &>(*view.props);
  const auto &lm = view.layoutMetrics;

  r.begin(kBackgroundColor);
  b.putInt(colorInt(p.backgroundColor));

  r.begin(kOpacity);
  b.putFloat(static_cast<float>(p.opacity));

  auto metrics = p.resolveBorderMetrics(layoutIsEmpty(lm) ? LayoutMetrics{} : lm);

  r.begin(kBorderRadius);
  b.putFloat(sanitize(metrics.borderRadii.topLeft.horizontal * scale));
  b.putFloat(sanitize(metrics.borderRadii.topRight.horizontal * scale));
  b.putFloat(sanitize(metrics.borderRadii.bottomRight.horizontal * scale));
  b.putFloat(sanitize(metrics.borderRadii.bottomLeft.horizontal * scale));

  r.begin(kBorderWidth);
  b.putFloat(sanitize(metrics.borderWidths.left * scale));
  b.putFloat(sanitize(metrics.borderWidths.top * scale));
  b.putFloat(sanitize(metrics.borderWidths.right * scale));
  b.putFloat(sanitize(metrics.borderWidths.bottom * scale));

  // One colour for all sides in the spike: the first side that has one.
  int32_t borderColor = 0;
  for (const SharedColor *c :
       {&metrics.borderColors.left, &metrics.borderColors.top, &metrics.borderColors.right, &metrics.borderColors.bottom}) {
    if (*c) {
      borderColor = colorInt(*c);
      break;
    }
  }
  r.begin(kBorderColor);
  b.putInt(borderColor);

  float tx = 0, ty = 0, sx = 1, sy = 1, rot = 0;
  if (!p.transform.operations.empty()) {
    Transform t = p.resolveTransform(layoutIsEmpty(lm) ? LayoutMetrics{} : lm);
    const auto &m = t.matrix; // row-major, row-vector convention: translation in m[12], m[13]
    tx = static_cast<float>(m[12]) * scale;
    ty = static_cast<float>(m[13]) * scale;
    sx = std::hypot(static_cast<float>(m[0]), static_cast<float>(m[1]));
    sy = std::hypot(static_cast<float>(m[4]), static_cast<float>(m[5]));
    rot = std::atan2(static_cast<float>(m[1]), static_cast<float>(m[0])) * 180.f / static_cast<float>(M_PI);
  }
  r.begin(kTransform);
  b.putFloat(sanitize(tx));
  b.putFloat(sanitize(ty));
  b.putFloat(sx);
  b.putFloat(sy);
  b.putFloat(sanitize(rot));

  r.begin(kOverflow);
  b.putInt(p.getClipsContentToBounds() ? 1 : 0);

  int32_t pe = 0;
  switch (p.pointerEvents) {
    case PointerEventsMode::Auto: pe = 0; break;
    case PointerEventsMode::None: pe = 1; break;
    case PointerEventsMode::BoxNone: pe = 2; break;
    case PointerEventsMode::BoxOnly: pe = 3; break;
  }
  r.begin(kPointerEvents);
  b.putInt(pe);

  // zIndex (unitless draw/hit order) and elevation (View.elevation, converted to px here).
  const float zIndex = p.zIndex.has_value() ? static_cast<float>(*p.zIndex) : 0.f;
  const float elevation = sanitize(static_cast<float>(p.elevation) * scale);
  if (zIndex != 0.f || elevation != 0.f) {
    r.begin(kElevation);
    b.putFloat(zIndex);
    b.putFloat(elevation);
  }
  const auto &slop = p.hitSlop;
  if (slop.left != 0 || slop.top != 0 || slop.right != 0 || slop.bottom != 0) {
    r.begin(kHitSlop);
    b.putFloat(sanitize(static_cast<float>(slop.left) * scale));
    b.putFloat(sanitize(static_cast<float>(slop.top) * scale));
    b.putFloat(sanitize(static_cast<float>(slop.right) * scale));
    b.putFloat(sanitize(static_cast<float>(slop.bottom) * scale));
  }
  if (p.accessible) {
    r.begin(kAccessible);
    b.putInt(1);
  }
  // Android-only view flags: bit 1 needsOffscreenAlphaCompositing, bit 2 renderToHardwareTextureAndroid, bit 4 a node that
  // listens for `click` (a Pressable): the view is clickable for accessibility services, whose activation comes back as a
  // `click` event (React Native's ReactViewGroup does the same through its accessibility delegate).
  const int32_t viewFlags = (p.needsOffscreenAlphaCompositing ? 1 : 0) | (p.renderToHardwareTextureAndroid ? 2 : 0) |
      (p.events[ViewEvents::Offset::Click] ? 4 : 0);
  if (viewFlags != 0) {
    r.begin(kViewFlags);
    b.putInt(viewFlags);
  }
  if (!p.accessibilityRole.empty()) {
    r.begin(kAccessibilityRole);
    b.putInt(b.addString(p.accessibilityRole));
  }
  // State, value, hint, actions, live region, importantForAccessibility and `role`: records 16..19, 25 and 26 (A11yWire.h).
  struct Out {
    Records &r;
    void begin(int32_t id) { r.begin(id); }
    void putInt(int32_t v) { r.batch.putInt(v); }
    int32_t addString(const std::string &s) { return r.batch.addString(s); }
  } out{r};
  a11y::encode(out, a11y::Fields{p.accessibilityState, p.accessibilityValue, p.accessibilityHint, p.accessibilityActions,
      p.accessibilityLiveRegion, p.importantForAccessibility, p.role});
  if (!p.testId.empty()) {
    r.begin(kTestId);
    b.putInt(b.addString(p.testId));
  }
  if (!p.accessibilityLabel.empty()) {
    r.begin(kAccessibilityLabel);
    b.putInt(b.addString(p.accessibilityLabel));
  }
}

int32_t alignmentCode(const std::optional<TextAlignment> &a) {
  if (!a.has_value()) return 0;
  switch (*a) {
    case TextAlignment::Center: return 1;
    case TextAlignment::Right: return 2;
    case TextAlignment::Justified: return 3;
    default: return 0;
  }
}

int32_t ellipsizeCode(EllipsizeMode m) {
  switch (m) {
    case EllipsizeMode::Tail: return 0;
    case EllipsizeMode::Head: return 1;
    case EllipsizeMode::Middle: return 2;
    case EllipsizeMode::Clip: return 3;
  }
  return 0;
}

void encodeParagraphRecord(Records &r, const ShadowView &view, const ParagraphAttributes *stateAttrs) {
  const auto &pp = static_cast<const ParagraphProps &>(*view.props);
  const auto &attrs = stateAttrs ? *stateAttrs : pp.paragraphAttributes;
  r.begin(kParagraph);
  r.batch.putInt(alignmentCode(pp.textAttributes.alignment));
  r.batch.putInt(attrs.maximumNumberOfLines);
  r.batch.putInt(ellipsizeCode(attrs.ellipsizeMode));

  // Everything TextLayoutManager reads from ParagraphAttributes (PA_KEY_*) plus the layout direction.
  int32_t breakStrategy = 1;
  switch (attrs.textBreakStrategy) {
    case TextBreakStrategy::Simple: breakStrategy = 0; break;
    case TextBreakStrategy::HighQuality: breakStrategy = 1; break;
    case TextBreakStrategy::Balanced: breakStrategy = 2; break;
  }
  int32_t hyphenation = 0;
  switch (attrs.android_hyphenationFrequency) {
    case HyphenationFrequency::None: hyphenation = 0; break;
    case HyphenationFrequency::Normal: hyphenation = 1; break;
    case HyphenationFrequency::Full: hyphenation = 2; break;
  }
  int32_t vertical = 0;
  if (attrs.textAlignVertical.has_value()) {
    switch (*attrs.textAlignVertical) {
      case TextAlignmentVertical::Center: vertical = 1; break;
      case TextAlignmentVertical::Bottom: vertical = 2; break;
      default: vertical = 0; break;
    }
  }
  r.begin(kParagraphExtra);
  r.batch.putInt(breakStrategy);
  r.batch.putInt(attrs.includeFontPadding ? 1 : 0);
  r.batch.putInt(hyphenation);
  r.batch.putInt(attrs.adjustsFontSizeToFit ? 1 : 0);
  r.batch.putFloat(static_cast<float>(attrs.minimumFontSize)); // NaN when unset; used as px like React Native does
  r.batch.putInt(vertical);
  r.batch.putInt(view.layoutMetrics.layoutDirection == LayoutDirection::RightToLeft ? 1 : 0);
}

} // namespace

Kind kindForComponent(const char *name) {
  if (!name) return kView;
  if (!std::strcmp(name, "RCTRawText") || !std::strcmp(name, "RCTVirtualText") || !std::strcmp(name, "RawText") ||
      !std::strcmp(name, "VirtualText") || !std::strcmp(name, "Text")) {
    return kSkip;
  }
  if (!std::strcmp(name, "RCTText") || !std::strcmp(name, "Paragraph")) return kText;
  if (!std::strcmp(name, "RCTScrollView") || !std::strcmp(name, "ScrollView")) return kScroll;
  if (!std::strcmp(name, "AndroidTextInput")) return kInput;
  if (!std::strcmp(name, "AndroidSwitch")) return kSwitch;
  if (!std::strcmp(name, "AndroidProgressBar")) return kProgress;
  if (!std::strcmp(name, "Image") || !std::strcmp(name, "RCTImageView")) return kImage;
  if (!std::strcmp(name, "ModalHostView") || !std::strcmp(name, "RCTModalHostView")) return kModal;
  return kView;
}

void encodeProps(Batch &batch, Kind kind, const ShadowView &view, float fallbackScale) {
  Records r(batch);
  if (view.props) {
    float scale = scaleOf(view, fallbackScale);
    encodeCommon(r, view, scale);
    if (kind == kText) {
      encodeParagraphRecord(r, view, nullptr);
    } else if (kind == kScroll) {
      const auto &sp = static_cast<const ScrollViewProps &>(*view.props);
      r.begin(kHorizontal);
      batch.putInt(sp.horizontal ? 1 : 0);
      r.begin(kShowsScrollIndicator);
      batch.putInt((sp.horizontal ? sp.showsHorizontalScrollIndicator : sp.showsVerticalScrollIndicator) ? 1 : 0);
      r.begin(kScrollEnabled);
      batch.putInt(sp.scrollEnabled ? 1 : 0);
      r.begin(kScrollEventThrottle);
      batch.putFloat(static_cast<float>(sp.scrollEventThrottle));
      if (sp.contentOffset.x != 0 || sp.contentOffset.y != 0) {
        r.begin(kScrollContentOffset);
        batch.putFloat(sanitize(static_cast<float>(sp.contentOffset.x) * scale));
        batch.putFloat(sanitize(static_cast<float>(sp.contentOffset.y) * scale));
      }
      int32_t alignment = 0;
      switch (sp.snapToAlignment) {
        case ScrollViewSnapToAlignment::Start: alignment = 1; break;
        case ScrollViewSnapToAlignment::Center: alignment = 2; break;
        case ScrollViewSnapToAlignment::End: alignment = 3; break;
      }
      r.begin(kScrollSnap);
      batch.putInt(sp.pagingEnabled ? 1 : 0);
      batch.putFloat(sanitize(static_cast<float>(sp.snapToInterval) * scale));
      batch.putInt(alignment);
      batch.putInt(sp.disableIntervalMomentum ? 1 : 0);
      batch.putInt(sp.snapToStart ? 1 : 0);
      batch.putInt(sp.snapToEnd ? 1 : 0);
      if (!sp.snapToOffsets.empty()) {
        r.begin(kScrollSnapOffsets);
        batch.putInt(static_cast<int32_t>(sp.snapToOffsets.size()));
        for (auto offset : sp.snapToOffsets) batch.putFloat(sanitize(static_cast<float>(offset) * scale));
      }
      r.begin(kScrollDecelerationRate);
      batch.putFloat(static_cast<float>(sp.decelerationRate));
      r.begin(kScrollKeyboardDismiss);
      batch.putInt(sp.keyboardDismissMode == ScrollViewKeyboardDismissMode::OnDrag ? 1 :
          (sp.keyboardDismissMode == ScrollViewKeyboardDismissMode::Interactive ? 2 : 0));
      int32_t overScroll = 0; // auto
      if (sp.overScrollMode == "always") overScroll = 1;
      else if (sp.overScrollMode == "never") overScroll = 2;
      r.begin(kScrollOverScroll);
      batch.putInt(overScroll);
    } else if (isViewKind(kind)) {
      r.count += encodeViewKindProps(batch, kind, view, scale);
    } else if (isNavKind(kind)) {
      r.count += encodeNavProps(batch, kind, view);
    }
  }
  r.finish();
}

void encodeState(Batch &batch, Kind kind, const ShadowView &view, float fallbackScale) {
  Records r(batch);
  if (kind == kText && view.state && view.props) {
    const float scale = scaleOf(view, fallbackScale);
    const auto &data = static_cast<const ConcreteState<ParagraphState> &>(*view.state).getData();
    encodeParagraphRecord(r, view, &data.paragraphAttributes);

    for (const auto &fragment : data.attributedString.getFragments()) {
      if (fragment.isAttachment()) continue;
      const auto &ta = fragment.textAttributes;
      float fontSize = std::isnan(ta.fontSize) ? 14.f : static_cast<float>(ta.fontSize);
      float multiplier = 1.f;
      if (!std::isnan(ta.fontSizeMultiplier) && ta.allowFontScaling.value_or(true)) {
        multiplier = static_cast<float>(ta.fontSizeMultiplier);
      }
      float lineHeight = std::isnan(ta.lineHeight) ? 0.f : static_cast<float>(ta.lineHeight) * multiplier * scale;
      float letterSpacing = std::isnan(ta.letterSpacing) ? 0.f : static_cast<float>(ta.letterSpacing) * multiplier * scale;

      r.begin(kFragment);
      batch.putInt(batch.addString(fragment.string));
      batch.putFloat(fontSize * multiplier * scale);
      batch.putInt(ta.foregroundColor ? colorInt(ta.foregroundColor) : static_cast<int32_t>(0xFF000000));
      // 0 = no weight set: React Native adds its font span (subpixel, linear text) only when a weight, style or family is set, and Kotlin follows that.
      batch.putInt(ta.fontWeight.has_value() ? static_cast<int32_t>(*ta.fontWeight) : 0);
      batch.putInt(ta.fontStyle.has_value() && *ta.fontStyle != FontStyle::Normal ? 1 : 0);
      batch.putInt(ta.fontFamily.empty() ? -1 : batch.addString(ta.fontFamily));
      batch.putFloat(letterSpacing);
      batch.putFloat(lineHeight);

      // Attributes TextLayoutManager.buildSpannableFromFragments turns into more spans.
      int32_t flags = 0;
      if (ta.textDecorationLineType.has_value()) {
        switch (*ta.textDecorationLineType) {
          case TextDecorationLineType::Underline: flags |= 1; break;
          case TextDecorationLineType::Strikethrough: flags |= 2; break;
          case TextDecorationLineType::UnderlineStrikethrough: flags |= 3; break;
          default: break;
        }
      }
      if (ta.backgroundColor) flags |= 4;
      float dx = 0, dy = 0, radius = 0;
      int32_t shadowColor = 0;
      if (ta.textShadowOffset.has_value()) {
        dx = static_cast<float>(ta.textShadowOffset->width) * scale;
        dy = static_cast<float>(ta.textShadowOffset->height) * scale;
      }
      if (!std::isnan(ta.textShadowRadius)) radius = static_cast<float>(ta.textShadowRadius) * scale;
      if (ta.textShadowColor) shadowColor = colorInt(ta.textShadowColor);
      int32_t transform = 0;
      if (ta.textTransform.has_value()) {
        switch (*ta.textTransform) {
          case TextTransform::Uppercase: transform = 1; break;
          case TextTransform::Lowercase: transform = 2; break;
          case TextTransform::Capitalize: transform = 3; break;
          default: break;
        }
      }
      r.begin(kFragmentExtra);
      batch.putInt(flags);
      batch.putInt(transform);
      batch.putInt(ta.backgroundColor ? colorInt(ta.backgroundColor) : 0);
      batch.putFloat(std::isnan(ta.opacity) ? std::numeric_limits<float>::quiet_NaN() : static_cast<float>(ta.opacity));
      batch.putFloat(sanitize(dx));
      batch.putFloat(sanitize(dy));
      batch.putFloat(sanitize(radius));
      batch.putInt(shadowColor);
      batch.putInt(ta.fontVariant.has_value() ? static_cast<int32_t>(*ta.fontVariant) : 0);
    }

    // Prepared android.text.Layout (com.facebook.react.views.text.PreparedLayout) when RN built one.
    // Only present with the enablePreparedTextLayout feature flag.
    if (data.measuredLayout.preparedTextLayout) {
      auto prepared = data.getJNIReference();
      if (prepared) {
        r.begin(kPreparedLayout);
        batch.putInt(batch.addObject(std::move(prepared)));
      }
    }
  }
  if (kind == kInput) {
    r.count += encodeViewKindState(batch, kind, view, fallbackScale);
  }
  r.finish();
}

void encodeLayout(Batch &batch, const ShadowView &view) {
  const auto &lm = view.layoutMetrics;
  const float s = static_cast<float>(lm.pointScaleFactor);
  batch.putFloat(sanitize(static_cast<float>(lm.frame.origin.x) * s));
  batch.putFloat(sanitize(static_cast<float>(lm.frame.origin.y) * s));
  batch.putFloat(sanitize(static_cast<float>(lm.frame.size.width) * s));
  batch.putFloat(sanitize(static_cast<float>(lm.frame.size.height) * s));
  batch.putFloat(sanitize(static_cast<float>(lm.contentInsets.left) * s));
  batch.putFloat(sanitize(static_cast<float>(lm.contentInsets.top) * s));
  batch.putFloat(sanitize(static_cast<float>(lm.contentInsets.right) * s));
  batch.putFloat(sanitize(static_cast<float>(lm.contentInsets.bottom) * s));
  batch.putInt(lm.displayType == DisplayType::None ? 1 : 0);
}

} // namespace expo::svelteengine
