// Host test of the typed animated path's C++ half (AnimatedBridge.h): Reanimated's command stream in, typed buffer and
// rest buffers out. No Android, no JNI. Writes the typed buffers it verified to a fixture file that
// AnimatedWireCheck.kt decodes with the real Kotlin decoder, so the two halves of the wire format are checked against
// the same bytes. Usage: AnimatedWireTest <fixture output path>   (src/test/run.sh does both steps)
//
// The command numbers below are written as literals, copied from Reanimated's SynchronousPropsBufferSerializer.cpp, so
// a renamed constant in AnimatedBridge.h cannot hide a drift from Reanimated.

#include "../../main/cpp/AnimatedBridge.h"

#include <cmath>
#include <cstdio>
#include <cstdlib>
#include <cstring>
#include <fstream>
#include <functional>
#include <sstream>
#include <string>
#include <vector>

using namespace expo::svelteengine::animated;

namespace {

int failures = 0;

#define CHECK(cond, ...)                                              \
  do {                                                                \
    if (!(cond)) {                                                    \
      ++failures;                                                     \
      std::fprintf(stderr, "FAIL %s:%d: %s: ", __FILE__, __LINE__, #cond); \
      std::fprintf(stderr, __VA_ARGS__);                              \
      std::fprintf(stderr, "\n");                                     \
    }                                                                 \
  } while (0)

struct Stream {
  std::vector<int32_t> ints;
  std::vector<double> doubles;

  Stream &view(int tag) { ints.push_back(1); ints.push_back(tag); return *this; }
  Stream &end() { ints.push_back(4); return *this; }
  Stream &opacity(double v) { ints.push_back(10); doubles.push_back(v); return *this; }
  Stream &elevation(double v) { ints.push_back(11); doubles.push_back(v); return *this; }
  Stream &zIndex(double v) { ints.push_back(12); doubles.push_back(v); return *this; }
  Stream &color(int command, int32_t argb) { ints.push_back(command); ints.push_back(argb); return *this; }
  Stream &radius(int command, int unit, double v) { ints.push_back(command); ints.push_back(unit); doubles.push_back(v); return *this; }
  Stream &outlineWidth(double v) { ints.push_back(52); doubles.push_back(v); return *this; }
  Stream &transformBegin() { ints.push_back(2); return *this; }
  Stream &transformEnd() { ints.push_back(3); return *this; }
  Stream &translate(int command, double v) { ints.push_back(command); ints.push_back(202); doubles.push_back(v); return *this; }
  Stream &translatePercent(int command, double v) { ints.push_back(command); ints.push_back(203); doubles.push_back(v); return *this; }
  Stream &scale(int command, double v) { ints.push_back(command); doubles.push_back(v); return *this; }
  Stream &angle(int command, int unit, double v) { ints.push_back(command); ints.push_back(unit); doubles.push_back(v); return *this; }
  Stream &matrix(const std::vector<double> &m) {
    ints.push_back(111);
    ints.push_back(static_cast<int32_t>(m.size()));
    for (double v : m) doubles.push_back(v);
    return *this;
  }
  Stream &append(const Stream &other) {
    ints.insert(ints.end(), other.ints.begin(), other.ints.end());
    doubles.insert(doubles.end(), other.doubles.begin(), other.doubles.end());
    return *this;
  }
};

struct Result {
  std::vector<int32_t> restInts;
  std::vector<double> restDoubles;
  std::vector<std::vector<int32_t>> flushed;  // one typed buffer per flush
};

Staging staging;

// `reject` returns the ordinals (within one flush) the fake Kotlin side does not take.
Result run(const Stream &in, std::function<std::vector<int32_t>(const int32_t *, size_t)> reject = nullptr) {
  Result r;
  r.restInts.assign(in.ints.size(), -1);
  r.restDoubles.assign(in.doubles.size(), -1);
  size_t restDoubles = 0;
  const size_t restInts = split(
      in.ints.data(), in.ints.size(), in.doubles.data(), in.doubles.size(), r.restInts.data(), r.restDoubles.data(),
      &restDoubles, staging, [&](const int32_t *buffer, size_t count, std::vector<int32_t> &rejected) {
        r.flushed.emplace_back(buffer, buffer + count);
        CHECK(count <= kBufferInts, "flush of %zu ints exceeds the buffer", count);
        CHECK(buffer[0] > 0, "empty flush");
        if (reject) for (int32_t o : reject(buffer, count)) rejected.push_back(o);
      });
  r.restInts.resize(restInts);
  r.restDoubles.resize(restDoubles);
  return r;
}

float f(int32_t bits) {
  float v;
  std::memcpy(&v, &bits, sizeof(v));
  return v;
}

std::string num(float v) {
  if (std::isnan(v)) return "nan";
  char text[32];
  std::snprintf(text, sizeof(text), "%.6f", static_cast<double>(v == 0.f ? 0.f : v));  // -0 prints as 0
  return text;
}

// Reads a typed buffer with a decoder written for this test (not the production one) into the canonical text the
// Kotlin check renders too: "tag=7;bg=-16777216;opacity=0.5;radius=7,7,7,7;transform=tx,ty,sx,sy,rot;stacking=z,e" per view,
// views joined by " | ".
std::string describe(const std::vector<int32_t> &buffer) {
  std::ostringstream out;
  size_t at = 1;
  for (int32_t v = 0; v < buffer[0]; ++v) {
    if (v) out << " | ";
    out << "tag=" << buffer[at];
    const int32_t records = buffer[at + 1];
    at += 2;
    for (int32_t k = 0; k < records; ++k) {
      switch (buffer[at++]) {
        case 1: out << ";bg=" << buffer[at++]; break;
        case 2: out << ";opacity=" << num(f(buffer[at++])); break;
        case 3:
          out << ";radius=" << num(f(buffer[at])) << "," << num(f(buffer[at + 1])) << "," << num(f(buffer[at + 2])) << ","
              << num(f(buffer[at + 3]));
          at += 4;
          break;
        case 6:
          out << ";transform=" << num(f(buffer[at])) << "," << num(f(buffer[at + 1])) << "," << num(f(buffer[at + 2])) << ","
              << num(f(buffer[at + 3])) << "," << num(f(buffer[at + 4]));
          at += 5;
          break;
        case 9: out << ";stacking=" << num(f(buffer[at])) << "," << num(f(buffer[at + 1])); at += 2; break;
        default: out << ";?" << buffer[at - 1]; return out.str();
      }
    }
  }
  CHECK(at == buffer.size(), "buffer has %zu ints, records end at %zu", buffer.size(), at);
  return out.str();
}

std::ofstream fixture;

void expectTyped(const char *name, const Result &r, const std::string &expected) {
  CHECK(r.flushed.size() == 1, "%s: %zu flushes", name, r.flushed.size());
  if (r.flushed.size() != 1) return;
  const std::string actual = describe(r.flushed[0]);
  CHECK(actual == expected, "%s:\n   got      %s\n   expected %s", name, actual.c_str(), expected.c_str());
  fixture << name << '\t';
  for (size_t i = 0; i < r.flushed[0].size(); ++i) fixture << (i ? "," : "") << r.flushed[0][i];
  fixture << '\t' << expected << '\n';
}

void expectRestEquals(const char *name, const Result &r, const Stream &expected) {
  CHECK(r.restInts == expected.ints, "%s: rest ints differ (%zu vs %zu)", name, r.restInts.size(), expected.ints.size());
  CHECK(r.restDoubles == expected.doubles, "%s: rest doubles differ (%zu vs %zu)", name, r.restDoubles.size(), expected.doubles.size());
}

}  // namespace

int main(int argc, char **argv) {
  if (argc < 2) {
    std::fprintf(stderr, "usage: AnimatedWireTest <fixture path>\n");
    return 2;
  }
  fixture.open(argv[1]);

  // The churn tile: opacity and [translateY, scale].
  {
    Stream s;
    s.view(7).opacity(0.5).transformBegin().translate(101, 10).scale(102, 0.7).transformEnd().end();
    Result r = run(s);
    expectTyped("tile", r, "tag=7;opacity=0.500000;transform=0.000000,10.000000,0.700000,0.700000,0.000000");
    CHECK(r.restInts.empty() && r.restDoubles.empty(), "tile: nothing should be left");
  }

  // The first list entry is the outermost: scaling first shrinks the translation, translating first does not.
  {
    Stream s;
    s.view(1).transformBegin().scale(102, 0.5).translate(101, 10).transformEnd().end();
    expectTyped("scale-then-translate", run(s), "tag=1;transform=0.000000,5.000000,0.500000,0.500000,0.000000");
    Stream t;
    t.view(1).transformBegin().translate(101, 10).scale(102, 0.5).transformEnd().end();
    expectTyped("translate-then-scale", run(t), "tag=1;transform=0.000000,10.000000,0.500000,0.500000,0.000000");
  }

  // Rotation: radians and degrees, accumulated; scale and translate with it.
  {
    Stream s;
    s.view(2).transformBegin().angle(105, 200, 90).transformEnd().end();
    expectTyped("rotate-90deg", run(s), "tag=2;transform=0.000000,0.000000,1.000000,1.000000,90.000000");
    Stream t;
    t.view(3).transformBegin().angle(108, 201, M_PI / 2).angle(105, 200, 45).transformEnd().end();
    expectTyped("rotate-rad-plus-deg", run(t), "tag=3;transform=0.000000,0.000000,1.000000,1.000000,135.000000");
    Stream u;
    u.view(4).transformBegin().translate(100, 4).scale(103, 2).angle(105, 200, 90).transformEnd().end();
    expectTyped("translate-scale-rotate", run(u), "tag=4;transform=4.000000,0.000000,1.000000,2.000000,90.000000");
  }

  // A mirrored view keeps its sign; no rotation is invented for it.
  {
    Stream s;
    s.view(5).transformBegin().scale(103, -1).transformEnd().end();
    expectTyped("mirror-x", run(s), "tag=5;transform=0.000000,0.000000,-1.000000,1.000000,0.000000");
    Stream t;
    t.view(5).transformBegin().scale(103, -1).angle(105, 200, 90).transformEnd().end();
    // scaleX(-1) then rotate 90: the matrix is a mirror plus a quarter turn; the determinant keeps the mirror in sy.
    expectTyped("mirror-and-rotate", run(t), "tag=5;transform=0.000000,0.000000,1.000000,-1.000000,90.000000");
  }

  // Empty transform list: identity (the view is reset).
  {
    Stream s;
    s.view(6).transformBegin().transformEnd().end();
    expectTyped("empty-transform", run(s), "tag=6;transform=0.000000,0.000000,1.000000,1.000000,0.000000");
  }

  // A flat 16-number matrix folds in; a matrix with z or perspective goes back.
  {
    Stream s;
    s.view(8).transformBegin()
        .matrix({1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 12, 34, 0, 1})
        .transformEnd().end();
    expectTyped("matrix-translate", run(s), "tag=8;transform=12.000000,34.000000,1.000000,1.000000,0.000000");
    Stream t;
    t.view(9).transformBegin()
        .matrix({1, 0, 0, 0.001, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1})
        .transformEnd().end();
    Result r = run(t);
    CHECK(r.flushed.empty(), "perspective matrix must not be taken");
    expectRestEquals("perspective-matrix", r, t);
  }

  // Colour, radius, stacking.
  {
    Stream s;
    s.view(10).color(15, static_cast<int32_t>(0xFF3685FF)).radius(20, 202, 7).zIndex(3).end();
    expectTyped("background-radius-z", run(s), "tag=10;bg=-13203969;radius=7.000000,7.000000,7.000000,7.000000;stacking=3.000000,nan");
    Stream t;
    t.view(11).elevation(5).end();
    expectTyped("elevation-only", run(t), "tag=11;stacking=nan,5.000000");
    Stream u;
    u.view(12).zIndex(2).elevation(6).end();
    expectTyped("z-and-elevation", run(u), "tag=12;stacking=2.000000,6.000000");
  }

  // One unsupported prop sends the whole view back, with all of its props, and its neighbours are not disturbed.
  {
    Stream a, b, c;
    a.view(20).opacity(1).end();
    b.view(21).opacity(0.25).color(40, 0x11223344).end();
    c.view(22).transformBegin().translate(100, 3).transformEnd().end();
    Stream all;
    all.append(a).append(b).append(c);
    Result r = run(all);
    expectTyped("neighbours", r, "tag=20;opacity=1.000000 | tag=22;transform=3.000000,0.000000,1.000000,1.000000,0.000000");
    expectRestEquals("border-colour-view", r, b);
  }
  {
    const struct { const char *name; Stream stream; } declined[] = {
        {"percent-translate", Stream().view(30).transformBegin().translatePercent(100, 50).transformEnd().end()},
        {"percent-radius", Stream().view(31).radius(20, 203, 50).end()},
        {"corner-radius", Stream().view(32).radius(21, 202, 4).end()},
        {"shadow-colour", Stream().view(33).color(19, 1).end()},
        {"tint-colour", Stream().view(34).color(17, 1).end()},
        {"outline-width", Stream().view(35).outlineWidth(2).end()},
        {"rotate-x", Stream().view(36).transformBegin().angle(106, 200, 30).transformEnd().end()},
        {"skew", Stream().view(37).transformBegin().angle(109, 200, 10).transformEnd().end()},
        {"perspective", Stream().view(38).transformBegin().scale(112, 500).transformEnd().end()},
        {"opacity-and-outline", Stream().view(39).opacity(0.5).outlineWidth(2).end()},
    };
    for (const auto &d : declined) {
      Result r = run(d.stream);
      CHECK(r.flushed.empty(), "%s: must not be taken", d.name);
      expectRestEquals(d.name, r, d.stream);
    }
  }

  // A view the Kotlin side rejects goes back, in full, and only that one.
  {
    Stream a, b, c;
    a.view(40).opacity(0.1).end();
    b.view(41).opacity(0.2).transformBegin().translate(100, 9).transformEnd().end();
    c.view(42).opacity(0.3).end();
    Stream all;
    all.append(a).append(b).append(c);
    Result r = run(all, [](const int32_t *, size_t) { return std::vector<int32_t>{1}; });
    CHECK(r.flushed.size() == 1 && r.flushed[0][0] == 3, "reject: three typed views expected");
    expectRestEquals("rejected-view", r, b);
  }

  // Unreadable streams pass through from the broken view on; earlier views are still taken.
  {
    Stream a, b;
    a.view(50).opacity(1).end();
    b.view(51).opacity(0.5);  // truncated: no end
    Stream all;
    all.append(a).append(b);
    Result r = run(all);
    expectTyped("before-truncation", r, "tag=50;opacity=1.000000");
    expectRestEquals("truncated-view", r, b);

    Stream unknown;
    unknown.view(52).opacity(1).end();
    unknown.ints.push_back(1);
    unknown.ints.push_back(53);
    unknown.ints.push_back(99);  // a command this build does not know
    unknown.ints.push_back(4);
    Result u = run(unknown);
    CHECK(u.flushed.size() == 1, "unknown command: the view before it is still taken");
    Stream rest;
    rest.ints.assign(unknown.ints.begin() + 4, unknown.ints.end());
    expectRestEquals("unknown-command", u, rest);

    Stream empty;
    Result e = run(empty);
    CHECK(e.flushed.empty() && e.restInts.empty(), "empty stream");
  }

  // Many views: several flushes, none above the buffer, every view delivered once.
  {
    Stream all;
    for (int tag = 1000; tag < 1400; ++tag) all.view(tag).opacity(0.5).transformBegin().translate(100, tag).scale(102, 0.9).transformEnd().color(15, 7).radius(20, 202, 3).zIndex(1).elevation(1).end();
    Result r = run(all);
    int views = 0;
    for (const auto &buffer : r.flushed) views += buffer[0];
    CHECK(views == 400, "many: %d views delivered", views);
    CHECK(r.flushed.size() > 1, "many: expected several flushes, got %zu", r.flushed.size());
    CHECK(r.restInts.empty(), "many: nothing left");
    std::fprintf(stderr, "many: %zu views in %zu flushes, largest %zu ints\n", static_cast<size_t>(views), r.flushed.size(), r.flushed[0].size());
  }

  fixture.close();
  if (failures) {
    std::fprintf(stderr, "%d check(s) failed\n", failures);
    return 1;
  }
  std::fprintf(stderr, "AnimatedWireTest: all checks passed\n");
  return 0;
}
