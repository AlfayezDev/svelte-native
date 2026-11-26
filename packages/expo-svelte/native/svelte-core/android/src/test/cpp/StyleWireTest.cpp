// Host test of the box style records the engine encodes (StyleWire.h): box shadows, the colour of each border side with the border style, and the transform origin.
// No Android, no JNI, no Fabric: the header takes plain structs. Writes the streams it verified to a fixture that StyleRulesCheck.kt decodes with the production
// Kotlin decoder (StyleRecords), so both halves of the wire are checked against the same bytes. Usage: StyleWireTest <fixture output path> (src/test/engine.sh).

#include "../../main/cpp/StyleWire.h"

#include <cstdio>
#include <cstring>
#include <fstream>
#include <string>
#include <vector>

using namespace expo::svelteengine::stylewire;

namespace {

int failures = 0;

#define CHECK(cond, ...)                                                       \
  do {                                                                         \
    if (!(cond)) {                                                             \
      ++failures;                                                              \
      std::fprintf(stderr, "FAIL %s:%d: %s: ", __FILE__, __LINE__, #cond);     \
      std::fprintf(stderr, __VA_ARGS__);                                       \
      std::fprintf(stderr, "\n");                                              \
    }                                                                          \
  } while (0)

// What PropsEncoder's StyleOut is: a record count in front, then the records.
struct Out {
  std::vector<int32_t> ops{0};
  void begin(int32_t id) {
    ++ops[0];
    ops.push_back(id);
  }
  void putInt(int32_t v) { ops.push_back(v); }
  void putFloat(float f) {
    int32_t bits;
    std::memcpy(&bits, &f, sizeof(bits));
    ops.push_back(bits);
  }
};

std::ofstream fixture;

int32_t bits(float f) {
  int32_t b;
  std::memcpy(&b, &f, sizeof(b));
  return b;
}

// Checks the stream against what the wire must carry (written out by hand) and records it with the text the Kotlin decoder must render for it.
void run(const char *name, const Out &out, const std::vector<int32_t> &ops, const std::string &rendered) {
  CHECK(out.ops == ops, "%s: ops differ (got %zu ints, wanted %zu)", name, out.ops.size(), ops.size());
  for (size_t i = 0; i < out.ops.size() && i < ops.size(); ++i) {
    if (out.ops[i] != ops[i]) std::fprintf(stderr, "   %s: ops[%zu] is %d, wanted %d\n", name, i, out.ops[i], ops[i]);
  }
  fixture << name << '\t';
  for (size_t i = 0; i < out.ops.size(); ++i) fixture << (i ? "," : "") << out.ops[i];
  fixture << '\t' << rendered << '\n';
}

Shadow shadow(float x, float y, float blur, float spread, int32_t color, bool inset) {
  Shadow s;
  s.offsetX = x;
  s.offsetY = y;
  s.blurRadius = blur;
  s.spreadDistance = spread;
  s.color = color;
  s.inset = inset;
  return s;
}

} // namespace

int main(int argc, char **argv) {
  if (argc < 2) {
    std::fprintf(stderr, "usage: StyleWireTest <fixture output path>\n");
    return 2;
  }
  fixture.open(argv[1]);

  // The ids are the contract with StyleRecords.kt.
  {
    // The widths of a style turn with its colours in a right-to-left layout that swaps left and right.
    std::optional<float> left, right, start, end;
    left = 3.0f;
    turnLeftAndRight(left, right, start, end);
    CHECK(!left && !right && !end && start && *start == 3.0f, "borderLeftWidth becomes the start width");
    left.reset(); right.reset(); start.reset(); end.reset();
    right = 4.0f;
    turnLeftAndRight(left, right, start, end);
    CHECK(!left && !right && !start && end && *end == 4.0f, "borderRightWidth becomes the end width");
    left = 1.0f; right = 2.0f; start = 9.0f; end = 8.0f;
    turnLeftAndRight(left, right, start, end);
    CHECK(!left && !right && start && *start == 1.0f && end && *end == 2.0f, "both turn and overwrite what start and end held, as Fabric's props do");
    std::optional<float> none, none2, s2 = 5.0f, e2 = 6.0f;
    turnLeftAndRight(none, none2, s2, e2);
    CHECK(!none && !none2 && s2 && *s2 == 5.0f && e2 && *e2 == 6.0f, "start and end alone stay");
    // Resolved as `CascadedRectangleEdges::resolve` does in a right-to-left layout (left reads the trailing edge `end`, right the leading edge `start`): a left width lands on the right.
    std::optional<float> l3 = 3.0f, r3, s3, e3;
    turnLeftAndRight(l3, r3, s3, e3);
    const bool isRTL = true;
    const std::optional<float> leading = isRTL ? e3 : s3, trailing = isRTL ? s3 : e3;
    const float physicalLeft = l3.value_or(leading.value_or(0.0f)), physicalRight = r3.value_or(trailing.value_or(0.0f));
    CHECK(physicalLeft == 0.0f && physicalRight == 3.0f, "a left width is drawn on the right in a right-to-left layout");
  }
  CHECK(kBoxShadow == 140 && kBorderSides == 141 && kTransformOrigin == 142, "record ids");
  CHECK(kBlack == static_cast<int32_t>(0xFF000000), "black");

  // Nothing set: no records, so a plain view costs nothing on the wire.
  {
    Out out;
    encodeShadows(out, nullptr, 0);
    CHECK(!encodeSides(out, Sides{}), "no sides record for a plain border");
    CHECK(!encodeOrigin(out, Origin{}), "no origin record for the centre");
    run("nothing", out, {0}, "");
  }

  // The focus ring and the halo of an input: `0 0 0 1px #66666f, 0 0 0 4px rgba(9,9,11,0.07)`, the first layer on top.
  {
    const int32_t ring = static_cast<int32_t>(0xFF66666F);
    const int32_t haloArgb = static_cast<int32_t>((18u << 24) | (9u << 16) | (9u << 8) | 11u); // rgba(9,9,11,0.07): alpha 18, then 09 09 0b
    Shadow layers[2] = {shadow(0, 0, 0, 1, ring, false), shadow(0, 0, 0, 4, haloArgb, false)};
    Out out;
    encodeShadows(out, layers, 2);
    run("focus-ring", out,
        {1, 140, 2,
         0, 0, 0, bits(1.f), ring, 0,
         0, 0, 0, bits(4.f), haloArgb, 0},
        "shadows=2 [0 0 0 1 #ff66666f outset, 0 0 0 4 #1209090b outset]");
  }

  // `inset 0 0 0 1px #66666f`.
  {
    const int32_t ring = static_cast<int32_t>(0xFF66666F);
    Shadow layers[1] = {shadow(0, 0, 0, 1, ring, true)};
    Out out;
    encodeShadows(out, layers, 1);
    run("inset-ring", out, {1, 140, 1, 0, 0, 0, bits(1.f), ring, 1}, "shadows=1 [0 0 0 1 #ff66666f inset]");
  }

  // The dialog card: `0 10px 30px -10px rgba(9,9,11,0.18)` (a negative spread, a blur, an offset), and a shadow with a fractional length.
  {
    const int32_t card = static_cast<int32_t>((46u << 24) | (9u << 16) | (9u << 8) | 11u);
    Shadow layers[2] = {shadow(0, 10, 30, -10, card, false), shadow(0.5f, 1.5f, 2, 0, kBlack, false)};
    Out out;
    encodeShadows(out, layers, 2);
    run("dialog-card", out,
        {1, 140, 2,
         0, bits(10.f), bits(30.f), bits(-10.f), card, 0,
         bits(0.5f), bits(1.5f), bits(2.f), 0, kBlack, 0},
        "shadows=2 [0 10 30 -10 #2e09090b outset, 0.5 1.5 2 0 #ff000000 outset]");
  }

  // The colour is carried as it is: black is black, 0 is transparent (`0 0 0 0 transparent`: the view keeps React Native's drawables).
  {
    Shadow layers[2] = {shadow(0, 0, 0, 0, kBlack, false), Shadow{}};
    Out out;
    encodeShadows(out, layers, 2);
    run("black-and-transparent", out,
        {1, 140, 2,
         0, 0, 0, 0, kBlack, 0,
         0, 0, 0, 0, 0, 0},
        "shadows=2 [0 0 0 0 #ff000000 outset, 0 0 0 0 #00000000 outset]");
  }

  // Border sides. Left, top, right, bottom.
  {
    // One colour on every side, solid: record 5 carries it, no record 141.
    Sides s;
    for (int i = 0; i < 4; ++i) {
      s.set[i] = true;
      s.color[i] = static_cast<int32_t>(0xFF336699);
    }
    Out out;
    CHECK(sidesUniform(s) && uniformColor(s) == static_cast<int32_t>(0xFF336699), "uniform colour");
    CHECK(!encodeSides(out, s), "no record for one colour");
    run("sides-uniform", out, {0}, "");

    // No colour at all: black on every side (React Native's default), nothing to send.
    Sides none;
    CHECK(sidesUniform(none) && uniformColor(none) == kBlack, "an unset border is black");
    CHECK(!encodeSides(out, none), "no record for an unset border");

    // A colour on some sides only: the others are black, so the sides differ.
    Sides bottom;
    bottom.set[3] = true;
    bottom.color[3] = static_cast<int32_t>(0xFFFF0000);
    CHECK(!sidesUniform(bottom), "a red bottom over black sides");
    CHECK(uniformColor(bottom) == kBlack, "record 5 of mixed sides is the top side's colour");
    Out mixed;
    CHECK(encodeSides(mixed, bottom), "record for mixed sides");
    run("sides-bottom-only", mixed, {1, 141, 0, 8, 0, 0, 0, static_cast<int32_t>(0xFFFF0000)}, "sides style=0 mask=8 colors=[#00000000 #00000000 #00000000 #ffff0000]");

    // The same colour set on every side, and a side that has none but would be black anyway: the same, so no record.
    Sides black;
    black.set[0] = true;
    black.color[0] = kBlack;
    CHECK(sidesUniform(black), "an explicit black left beside unset sides is one colour");

    // Four colours.
    Sides four;
    const int32_t colors[4] = {static_cast<int32_t>(0xFFFF0000), static_cast<int32_t>(0xFF00FF00), static_cast<int32_t>(0xFF0000FF), static_cast<int32_t>(0xFFFFFF00)};
    for (int i = 0; i < 4; ++i) {
      four.set[i] = true;
      four.color[i] = colors[i];
    }
    Out all;
    encodeSides(all, four);
    run("sides-four", all, {1, 141, 0, 15, colors[0], colors[1], colors[2], colors[3]}, "sides style=0 mask=15 colors=[#ffff0000 #ff00ff00 #ff0000ff #ffffff00]");

    // Dashed and dotted with one colour: the style alone needs the record.
    Sides dashed;
    for (int i = 0; i < 4; ++i) {
      dashed.set[i] = true;
      dashed.color[i] = static_cast<int32_t>(0xFF666666);
    }
    dashed.style = 1;
    Out d;
    CHECK(encodeSides(d, dashed), "dashed needs the record");
    run("sides-dashed", d, {1, 141, 1, 15, static_cast<int32_t>(0xFF666666), static_cast<int32_t>(0xFF666666), static_cast<int32_t>(0xFF666666), static_cast<int32_t>(0xFF666666)},
        "sides style=1 mask=15 colors=[#ff666666 #ff666666 #ff666666 #ff666666]");
    dashed.style = 2;
    Out dot;
    encodeSides(dot, dashed);
    run("sides-dotted", dot, {1, 141, 2, 15, static_cast<int32_t>(0xFF666666), static_cast<int32_t>(0xFF666666), static_cast<int32_t>(0xFF666666), static_cast<int32_t>(0xFF666666)},
        "sides style=2 mask=15 colors=[#ff666666 #ff666666 #ff666666 #ff666666]");

    // A dashed border that has no colour: black, dashed.
    Sides dashedNone;
    dashedNone.style = 1;
    Out dn;
    encodeSides(dn, dashedNone);
    run("sides-dashed-unset", dn, {1, 141, 1, 0, 0, 0, 0, 0}, "sides style=1 mask=0 colors=[#00000000 #00000000 #00000000 #00000000]");
  }

  // The transform origin: a length in px, a percentage, one axis only.
  {
    Origin topLeft;
    topLeft.xUnit = 1;
    topLeft.x = 0;
    topLeft.yUnit = 1;
    topLeft.y = 0;
    Out out;
    encodeOrigin(out, topLeft);
    run("origin-top-left", out, {1, 142, 1, 0, 1, 0}, "origin x=1:0.0 y=1:0.0");

    Origin mixed;
    mixed.xUnit = 2;
    mixed.x = 25;
    mixed.yUnit = 1;
    mixed.y = 52.5f;
    Out m;
    encodeOrigin(m, mixed);
    run("origin-mixed", m, {1, 142, 2, bits(25.f), 1, bits(52.5f)}, "origin x=2:25.0 y=1:52.5");

    Origin oneAxis;
    oneAxis.yUnit = 2;
    oneAxis.y = 100;
    Out o;
    encodeOrigin(o, oneAxis);
    run("origin-y-only", o, {1, 142, 0, 0, 2, bits(100.f)}, "origin x=0:0.0 y=2:100.0");
  }

  // Everything at once, in the order PropsEncoder writes them (sides, origin, shadows): the records of one view side by side.
  {
    Sides sides;
    sides.style = 2;
    sides.set[2] = true;
    sides.color[2] = static_cast<int32_t>(0xFF123456);
    Origin origin;
    origin.xUnit = 2;
    origin.x = 100;
    origin.yUnit = 2;
    origin.y = 0;
    Shadow layers[1] = {shadow(1, 2, 3, 4, static_cast<int32_t>(0x80FFFFFF), true)};
    Out out;
    encodeSides(out, sides);
    encodeOrigin(out, origin);
    encodeShadows(out, layers, 1);
    run("all-three", out,
        {3,
         141, 2, 4, 0, 0, static_cast<int32_t>(0xFF123456), 0,
         142, 2, bits(100.f), 2, 0,
         140, 1, bits(1.f), bits(2.f), bits(3.f), bits(4.f), static_cast<int32_t>(0x80FFFFFF), 1},
        "shadows=1 [1 2 3 4 #80ffffff inset] sides style=2 mask=4 colors=[#00000000 #00000000 #ff123456 #00000000] origin x=2:100.0 y=2:0.0");
  }

  fixture.close();
  if (failures != 0) {
    std::fprintf(stderr, "%d failure(s)\n", failures);
    return 1;
  }
  std::printf("StyleWireTest: ok\n");
  return 0;
}
