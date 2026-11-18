#pragma once

// Typed path for Reanimated's per-frame prop writes (SPEC.md, "Animated write path").
//
// Reanimated (patched, vendor-patches/react-native-reanimated/0001-engine-views-and-direct-props.patch) serializes the synchronous prop updates of one frame
// into two flat buffers (SynchronousPropsBufferSerializer.cpp) and hands them to a sink function before they cross JNI
// as Java arrays. The sink below keeps the views the engine can write without a ReadableMap, encodes them as flat
// records for Kotlin (AnimatedWire.kt) and gives every other view back untouched.
//
// This header has no JNI and no React Native includes so the encoder runs in a host test
// (src/test/cpp/AnimatedWireTest.cpp). The JNI half is AnimatedBridge.cpp.

#include <cmath>
#include <cstddef>
#include <cstdint>
#include <cstring>
#include <limits>
#include <vector>

namespace expo::svelteengine::animated {

// Reanimated's command stream. Keep in sync with Common/cpp/reanimated/NativeModules/SynchronousPropsBufferSerializer.cpp
// (enum Command) and android/.../SynchronousPropsBufferParser.kt.
namespace stream {
constexpr int32_t kStartOfView = 1;
constexpr int32_t kStartOfTransform = 2;
constexpr int32_t kEndOfTransform = 3;
constexpr int32_t kEndOfView = 4;

constexpr int32_t kOpacity = 10;
constexpr int32_t kElevation = 11;
constexpr int32_t kZIndex = 12;
constexpr int32_t kBackgroundColor = 15;
constexpr int32_t kTintColor = 17;
constexpr int32_t kPlaceholderTextColor = 18;
constexpr int32_t kShadowColor = 19;
constexpr int32_t kBorderRadius = 20;
constexpr int32_t kBorderRadiusLast = 32;  // 20..32 are the radius commands: a unit int and a double follow
constexpr int32_t kBorderColorFirst = 40;
constexpr int32_t kBorderColorLast = 50;  // 40..50 are colour commands: one int follows (50 is outlineColor)
constexpr int32_t kOutlineOffset = 51;
constexpr int32_t kOutlineWidth = 52;

constexpr int32_t kTranslateX = 100;
constexpr int32_t kTranslateY = 101;
constexpr int32_t kScale = 102;
constexpr int32_t kScaleX = 103;
constexpr int32_t kScaleY = 104;
constexpr int32_t kRotate = 105;
constexpr int32_t kRotateX = 106;
constexpr int32_t kRotateY = 107;
constexpr int32_t kRotateZ = 108;
constexpr int32_t kSkewX = 109;
constexpr int32_t kSkewY = 110;
constexpr int32_t kMatrix = 111;
constexpr int32_t kPerspective = 112;

constexpr int32_t kUnitDeg = 200;
constexpr int32_t kUnitRad = 201;
constexpr int32_t kUnitPx = 202;
constexpr int32_t kUnitPercent = 203;
}  // namespace stream

// Record ids of the typed buffer: the engine's prop ids (PropsEncoder.cpp, PropId), same payload layout. Lengths are dp
// here (Reanimated's unit; committed records carry pixels) and Kotlin applies the density.
namespace rec {
constexpr int32_t kBackgroundColor = 1;  // ARGB int
constexpr int32_t kOpacity = 2;          // float
constexpr int32_t kBorderRadius = 3;     // topLeft, topRight, bottomRight, bottomLeft (float)
constexpr int32_t kTransform = 6;        // tx, ty (dp), sx, sy, rotation (degrees) (float)
constexpr int32_t kElevation = 9;        // zIndex, elevation (dp) (float); NaN = not animated
}  // namespace rec

// Typed buffer layout (int32 words, floats as raw bits):
//   [0]  view count (on return from the Kotlin flush: the number of rejected views, their ordinals follow at [1..])
//   then per view: tag, record count, then records `id, payload...`.
constexpr size_t kBufferInts = 4096;
// The most ints one view can take: tag + count + background 2 + opacity 2 + radius 5 + transform 6 + elevation 3.
constexpr size_t kMaxViewInts = 2 + 2 + 2 + 5 + 6 + 3;

inline int32_t floatBits(float value) {
  int32_t bits;
  std::memcpy(&bits, &value, sizeof(bits));
  return bits;
}

inline float notAnimated() {
  return std::numeric_limits<float>::quiet_NaN();
}

// What one view's command stream asks for. `ok` turns false when it carries anything the typed path does not write; the
// view then goes back to Reanimated's Java path with every prop (so no prop of a view is ever split across two paths).
struct ViewUpdate {
  int32_t tag = 0;
  bool ok = true;

  bool hasOpacity = false;
  double opacity = 1;
  bool hasBackground = false;
  int32_t background = 0;
  bool hasRadius = false;
  double radius = 0;
  bool hasZIndex = false;
  double zIndex = 0;
  bool hasElevation = false;
  double elevation = 0;

  bool hasTransform = false;
  // The transform list folded into one 2D affine matrix: a b c d are matrix[0], [1], [4], [5] and tx ty are matrix[12],
  // [13] of React Native's row-major row-vector Transform (the first list entry is the outermost, as in CSS).
  double a = 1, b = 0, c = 0, d = 1, tx = 0, ty = 0;

  // Appends `op * current`, the order of Transform::operator* (graphics/Transform.cpp).
  void compose(double a2, double b2, double c2, double d2, double tx2, double ty2) {
    const double na = a2 * a + b2 * c;
    const double nb = a2 * b + b2 * d;
    const double nc = c2 * a + d2 * c;
    const double nd = c2 * b + d2 * d;
    const double ntx = tx2 * a + ty2 * c + tx;
    const double nty = tx2 * b + ty2 * d + ty;
    a = na;
    b = nb;
    c = nc;
    d = nd;
    tx = ntx;
    ty = nty;
  }

  // Translation, scale and rotation (degrees) the way Props.setTransform applies them: Android scales, then rotates, then
  // translates, all about the view centre. A matrix without rotation keeps the signs of its scales (a mirrored view);
  // otherwise the decomposition is PropsEncoder's, with the second scale taken from the determinant so a mirror survives.
  void decompose(float &outTx, float &outTy, float &outSx, float &outSy, float &outRotation) const {
    outTx = static_cast<float>(tx);
    outTy = static_cast<float>(ty);
    if (b == 0 && c == 0) {
      outSx = static_cast<float>(a);
      outSy = static_cast<float>(d);
      outRotation = 0.f;
      return;
    }
    const double sx = std::hypot(a, b);
    if (sx == 0) {
      outSx = 0.f;
      outSy = static_cast<float>(std::hypot(c, d));
      outRotation = 0.f;
      return;
    }
    outSx = static_cast<float>(sx);
    outSy = static_cast<float>((a * d - b * c) / sx);
    outRotation = static_cast<float>(std::atan2(b, a) * 180.0 / M_PI);
  }
};

// Reads one view's commands: the stream cursor is `ints[i]` / `doubles[d]`, just after the tag. Stops at kEndOfView.
// Returns false when the stream is truncated or carries an operand layout this build does not know (the caller then
// passes the rest of the stream through untouched).
class StreamReader {
 public:
  StreamReader(const int32_t *ints, size_t intCount, const double *doubles, size_t doubleCount)
      : ints_(ints), intCount_(intCount), doubles_(doubles), doubleCount_(doubleCount) {}

  size_t intPos() const { return i_; }
  size_t doublePos() const { return d_; }
  void seek(size_t i, size_t d) {
    i_ = i;
    d_ = d;
  }
  bool atEnd() const { return i_ >= intCount_; }

  bool readInt(int32_t &out) {
    if (i_ >= intCount_) return false;
    out = ints_[i_++];
    return true;
  }
  bool readDouble(double &out) {
    if (d_ >= doubleCount_) return false;
    out = doubles_[d_++];
    return true;
  }

  // From the cursor to kEndOfView. `update.ok` records whether every command was one the typed path writes.
  bool readView(ViewUpdate &update) {
    for (;;) {
      int32_t command;
      if (!readInt(command)) return false;
      if (command == stream::kEndOfView) return true;
      switch (command) {
        case stream::kOpacity: {
          double v;
          if (!readDouble(v)) return false;
          update.hasOpacity = true;
          update.opacity = v;
          break;
        }
        case stream::kElevation: {
          double v;
          if (!readDouble(v)) return false;
          update.hasElevation = true;
          update.elevation = v;
          break;
        }
        case stream::kZIndex: {
          double v;
          if (!readDouble(v)) return false;
          update.hasZIndex = true;
          update.zIndex = v;
          break;
        }
        case stream::kBackgroundColor: {
          int32_t color;
          if (!readInt(color)) return false;
          update.hasBackground = true;
          update.background = color;
          break;
        }
        case stream::kStartOfTransform:
          if (!readTransform(update)) return false;
          break;
        case stream::kOutlineOffset:
        case stream::kOutlineWidth: {
          double v;
          if (!readDouble(v)) return false;
          update.ok = false;
          break;
        }
        default:
          if (command == stream::kBorderRadius) {
            int32_t unit;
            double v;
            if (!readInt(unit) || !readDouble(v)) return false;
            if (unit == stream::kUnitPx) {
              update.hasRadius = true;
              update.radius = v;
            } else {
              update.ok = false;
            }
          } else if (command > stream::kBorderRadius && command <= stream::kBorderRadiusLast) {
            int32_t unit;
            double v;
            if (!readInt(unit) || !readDouble(v)) return false;
            update.ok = false;
          } else if (
              command == stream::kShadowColor || command == stream::kTintColor ||
              command == stream::kPlaceholderTextColor ||
              (command >= stream::kBorderColorFirst && command <= stream::kBorderColorLast)) {
            int32_t color;
            if (!readInt(color)) return false;
            update.ok = false;
          } else {
            return false;
          }
          break;
      }
    }
  }

 private:
  bool readTransform(ViewUpdate &update) {
    update.hasTransform = true;
    for (;;) {
      int32_t command;
      if (!readInt(command)) return false;
      if (command == stream::kEndOfTransform) return true;
      switch (command) {
        case stream::kTranslateX:
        case stream::kTranslateY: {
          int32_t unit;
          double v;
          if (!readInt(unit) || !readDouble(v)) return false;
          if (unit != stream::kUnitPx) {
            update.ok = false;  // a percentage needs the view's size
          } else if (command == stream::kTranslateX) {
            update.compose(1, 0, 0, 1, v, 0);
          } else {
            update.compose(1, 0, 0, 1, 0, v);
          }
          break;
        }
        case stream::kScale:
        case stream::kScaleX:
        case stream::kScaleY: {
          double v;
          if (!readDouble(v)) return false;
          update.compose(
              command == stream::kScaleY ? 1 : v, 0, 0, command == stream::kScaleX ? 1 : v, 0, 0);
          break;
        }
        case stream::kRotate:
        case stream::kRotateZ: {
          int32_t unit;
          double v;
          if (!readInt(unit) || !readDouble(v)) return false;
          const double radians = unit == stream::kUnitDeg ? v * M_PI / 180.0 : v;
          const double cosine = std::cos(radians);
          const double sine = std::sin(radians);
          update.compose(cosine, sine, -sine, cosine, 0, 0);
          break;
        }
        case stream::kRotateX:
        case stream::kRotateY:
        case stream::kSkewX:
        case stream::kSkewY: {
          int32_t unit;
          double v;
          if (!readInt(unit) || !readDouble(v)) return false;
          update.ok = false;
          break;
        }
        case stream::kPerspective: {
          double v;
          if (!readDouble(v)) return false;
          update.ok = false;
          break;
        }
        case stream::kMatrix: {
          int32_t size;
          if (!readInt(size) || size < 0) return false;
          double m[16] = {0};
          for (int32_t k = 0; k < size; ++k) {
            double v;
            if (!readDouble(v)) return false;
            if (k < 16) m[k] = v;
          }
          // Only a 2D affine matrix (no z, no perspective) folds into the six numbers.
          const bool flat = size == 16 && m[2] == 0 && m[3] == 0 && m[6] == 0 && m[7] == 0 && m[8] == 0 &&
              m[9] == 0 && m[10] == 1 && m[11] == 0 && m[14] == 0 && m[15] == 1;
          if (flat) {
            update.compose(m[0], m[1], m[4], m[5], m[12], m[13]);
          } else {
            update.ok = false;
          }
          break;
        }
        default:
          return false;
      }
    }
  }

  const int32_t *ints_;
  size_t intCount_;
  const double *doubles_;
  size_t doubleCount_;
  size_t i_ = 0;
  size_t d_ = 0;
};

// Appends the typed records of `update` (a view whose `ok` is true) to `out`: tag, record count, records.
inline void encodeView(const ViewUpdate &update, int32_t *out, size_t &at) {
  const size_t header = at;
  out[at++] = update.tag;
  out[at++] = 0;
  int32_t records = 0;
  if (update.hasBackground) {
    out[at++] = rec::kBackgroundColor;
    out[at++] = update.background;
    ++records;
  }
  if (update.hasOpacity) {
    out[at++] = rec::kOpacity;
    out[at++] = floatBits(static_cast<float>(update.opacity));
    ++records;
  }
  if (update.hasRadius) {
    const int32_t radius = floatBits(static_cast<float>(update.radius));
    out[at++] = rec::kBorderRadius;
    out[at++] = radius;
    out[at++] = radius;
    out[at++] = radius;
    out[at++] = radius;
    ++records;
  }
  if (update.hasTransform) {
    float tx, ty, sx, sy, rotation;
    update.decompose(tx, ty, sx, sy, rotation);
    out[at++] = rec::kTransform;
    out[at++] = floatBits(tx);
    out[at++] = floatBits(ty);
    out[at++] = floatBits(sx);
    out[at++] = floatBits(sy);
    out[at++] = floatBits(rotation);
    ++records;
  }
  if (update.hasZIndex || update.hasElevation) {
    out[at++] = rec::kElevation;
    out[at++] = floatBits(update.hasZIndex ? static_cast<float>(update.zIndex) : notAnimated());
    out[at++] = floatBits(update.hasElevation ? static_cast<float>(update.elevation) : notAnimated());
    ++records;
  }
  out[header + 1] = records;
}

// Where a typed view came from in Reanimated's buffers, to hand it back when Kotlin rejects it.
struct ViewSpan {
  size_t intBegin, intEnd, doubleBegin, doubleEnd;
};

// Per-process scratch of the splitter; sized once, reused every frame.
struct Staging {
  std::vector<int32_t> ints;
  std::vector<ViewSpan> spans;
  std::vector<int32_t> rejected;

  Staging() {
    ints.reserve(kBufferInts);
    spans.reserve(kBufferInts / 4);
    rejected.reserve(64);
  }
};

// Splits Reanimated's batch. Views the typed path writes are encoded into `staging` and delivered through
// `flush(const int32_t *buffer, size_t count, std::vector<int32_t> &rejected)` (once per full buffer and once at the
// end); the callback appends the ordinals of the views Kotlin did not take. Everything else (views with props the typed
// path does not cover, rejected views, a stream this build cannot read) is copied to the rest buffers, which the caller
// sized like the input. Returns the number of ints left; `restDoubleCount` receives the number of doubles.
template <typename Flush>
size_t split(
    const int32_t *ints,
    size_t intCount,
    const double *doubles,
    size_t doubleCount,
    int32_t *restInts,
    double *restDoubles,
    size_t *restDoubleCount,
    Staging &staging,
    Flush &&flush) {
  size_t restI = 0;
  size_t restD = 0;
  const auto passThrough = [&](size_t intBegin, size_t intEnd, size_t doubleBegin, size_t doubleEnd) {
    if (intEnd > intBegin) std::memcpy(restInts + restI, ints + intBegin, (intEnd - intBegin) * sizeof(int32_t));
    restI += intEnd - intBegin;
    if (doubleEnd > doubleBegin) std::memcpy(restDoubles + restD, doubles + doubleBegin, (doubleEnd - doubleBegin) * sizeof(double));
    restD += doubleEnd - doubleBegin;
  };

  staging.ints.assign(1, 0);
  staging.spans.clear();
  const auto deliver = [&]() {
    if (staging.spans.empty()) return;
    staging.ints[0] = static_cast<int32_t>(staging.spans.size());
    staging.rejected.clear();
    flush(staging.ints.data(), staging.ints.size(), staging.rejected);
    for (const int32_t ordinal : staging.rejected) {
      if (ordinal < 0 || static_cast<size_t>(ordinal) >= staging.spans.size()) continue;
      const ViewSpan &span = staging.spans[static_cast<size_t>(ordinal)];
      passThrough(span.intBegin, span.intEnd, span.doubleBegin, span.doubleEnd);
    }
    staging.ints.assign(1, 0);
    staging.spans.clear();
  };

  StreamReader reader(ints, intCount, doubles, doubleCount);
  while (!reader.atEnd()) {
    const size_t viewInt = reader.intPos();
    const size_t viewDouble = reader.doublePos();
    int32_t command = 0;
    ViewUpdate update;
    bool readable = reader.readInt(command) && command == stream::kStartOfView && reader.readInt(update.tag) &&
        reader.readView(update);
    if (!readable) {
      // Not a stream this build understands: Reanimated's own parser sees the rest exactly as it was.
      passThrough(viewInt, intCount, viewDouble, doubleCount);
      break;
    }
    if (!update.ok) {
      passThrough(viewInt, reader.intPos(), viewDouble, reader.doublePos());
      continue;
    }
    if (staging.ints.size() + kMaxViewInts > kBufferInts) deliver();
    size_t at = staging.ints.size();
    staging.ints.resize(at + kMaxViewInts);
    encodeView(update, staging.ints.data(), at);
    staging.ints.resize(at);
    staging.spans.push_back(ViewSpan{viewInt, reader.intPos(), viewDouble, reader.doublePos()});
  }
  deliver();
  *restDoubleCount = restD;
  return restI;
}

}  // namespace expo::svelteengine::animated

namespace expo::svelteengine {

// Registers the Kotlin object expo.modules.svelteengine.AnimatedBridge natives (called from registerNatives).
void registerAnimatedBridgeNatives();

}  // namespace expo::svelteengine
