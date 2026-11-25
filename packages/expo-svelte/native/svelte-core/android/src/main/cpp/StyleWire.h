#pragma once

// The box style records of a view that React Native's Java views draw and the engine had no record for (SPEC.md, "Box styles"): its box shadows, the colour
// of each border side and the border style, and the transform origin. Header only and free of JNI and Fabric headers (plain structs, filled by PropsEncoder.cpp
// from React Native's `BoxShadow`, `BorderMetrics` and `TransformOrigin`), so a host test can run it (android/src/test/cpp/StyleWireTest.cpp). `Out` is anything with
// `begin(id)` (opens a record), `putInt(v)` and `putFloat(v)`.

#include <cstdint>
#include <optional>

namespace expo::svelteengine::stylewire {

enum Record : int32_t {
  kBoxShadow = 140,
  kBorderSides = 141,
  kTransformOrigin = 142,
};

constexpr int32_t kBlack = static_cast<int32_t>(0xFF000000);

// One `boxShadow` layer as React Native's `BoxShadow` holds it: lengths in points (dp, React Native's unit: its drawables multiply by the density themselves) and the colour
// as it came, 0 being transparent (React Native's Android views draw a layer written without a colour black: the JavaScript side says so, `boxShadowFor` in `view-configs.ts`,
// because Fabric's Android colour cannot tell none from transparent).
struct Shadow {
  float offsetX = 0, offsetY = 0, blurRadius = 0, spreadDistance = 0;
  int32_t color = 0;
  bool inset = false;
};

// kBoxShadow: the layer count, then per layer offsetX, offsetY, blurRadius, spreadDistance (floats), the colour (ARGB int) and inset (0 or 1), in the order of the style
// (first is topmost). Absent when the view has no shadow.
template <class Out>
void encodeShadows(Out &out, const Shadow *shadows, int32_t count) {
  if (count <= 0) return;
  out.begin(kBoxShadow);
  out.putInt(count);
  for (int32_t i = 0; i < count; ++i) {
    out.putFloat(shadows[i].offsetX);
    out.putFloat(shadows[i].offsetY);
    out.putFloat(shadows[i].blurRadius);
    out.putFloat(shadows[i].spreadDistance);
    out.putInt(shadows[i].color);
    out.putInt(shadows[i].inset ? 1 : 0);
  }
}

// The colour of each border side as the style gave them (React Native's resolved `borderColors`: sides are left, top, right, bottom, in that order) and the border
// style (0 solid, 1 dashed, 2 dotted).
struct Sides {
  bool set[4] = {false, false, false, false};
  int32_t color[4] = {0, 0, 0, 0};
  int32_t style = 0;
};

// What a side is drawn with: its colour, or black when the style gave it none (React Native's `ColorEdges` default).
inline int32_t sideColor(const Sides &s, int32_t side) { return s.set[side] ? s.color[side] : kBlack; }

inline bool sidesUniform(const Sides &s) {
  const int32_t first = sideColor(s, 0);
  for (int32_t i = 1; i < 4; ++i) {
    if (sideColor(s, i) != first) return false;
  }
  return true;
}

// The colour record 5 (`borderColor`) carries: the one colour of a border whose sides agree, the top side's otherwise (record 141 says the rest).
inline int32_t uniformColor(const Sides &s) { return sidesUniform(s) ? sideColor(s, 0) : sideColor(s, 1); }

// kBorderSides: style, a mask (bit i: side i has a colour), then the four colours (0 for a side without one). Only for a border the plain path cannot draw: sides of
// different colours, or a dashed or dotted border. Absent otherwise: the one colour of record 5 and a solid line.
template <class Out>
bool encodeSides(Out &out, const Sides &s) {
  if (sidesUniform(s) && s.style == 0) return false;
  out.begin(kBorderSides);
  out.putInt(s.style);
  int32_t mask = 0;
  for (int32_t i = 0; i < 4; ++i) {
    if (s.set[i]) mask |= 1 << i;
  }
  out.putInt(mask);
  for (int32_t i = 0; i < 4; ++i) out.putInt(s.set[i] ? s.color[i] : 0);
  return true;
}

// `transformOrigin` as React Native parsed it: per axis a unit (0 not set, the axis keeps the centre; 1 a length, px; 2 a percentage of the view's extent, 0 to 100).
struct Origin {
  int32_t xUnit = 0, yUnit = 0;
  float x = 0, y = 0;
};

// kTransformOrigin: xUnit, x, yUnit, y. Absent when neither axis is set (the origin is the centre). The transform record (6) never carries the origin: the view pivots on it.
template <class Out>
bool encodeOrigin(Out &out, const Origin &o) {
  if (o.xUnit == 0 && o.yUnit == 0) return false;
  out.begin(kTransformOrigin);
  out.putInt(o.xUnit);
  out.putFloat(o.x);
  out.putInt(o.yUnit);
  out.putFloat(o.y);
  return true;
}

// A right-to-left layout with `swapLeftAndRightInRTL` (React Native's default on Android) turns `left` and `right` of the colours, the radii and the styles of the props into `start` and
// `end` (`YogaLayoutableShadowNode::swapLeftAndRightInViewProps`), overwriting what `start` and `end` held, and does the same to the style Yoga lays out by, but not to the widths of the props
// that `resolveBorderMetrics` reads. This is that turn, for the optional edges of a cascaded width (`CascadedRectangleEdges`): after it `left` and `right` are unset.
template <class T>
void turnLeftAndRight(std::optional<T> &left, std::optional<T> &right, std::optional<T> &start, std::optional<T> &end) {
  if (left.has_value()) {
    start = left;
    left.reset();
  }
  if (right.has_value()) {
    end = right;
    right.reset();
  }
}

} // namespace expo::svelteengine::stylewire
