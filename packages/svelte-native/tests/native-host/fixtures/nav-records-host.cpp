// Host-side check of the engine's navigation record encoder (PropsEncoderNavRecords.h): reads one nativeID per line on
// standard input and writes, per line, `ops <ints…>` and `strings <hex of each UTF-8 string>`, the batch the engine would
// hand to Kotlin for that node. tests/native-host/navigation-native.test.ts compares it with `decodeRecords`.
#include <cstdio>
#include <cstring>
#include <iostream>
#include <string>
#include <vector>

#include "PropsEncoderNavRecords.h"

namespace {

struct Sink {
  std::vector<int32_t> ops;
  std::vector<std::string> strings;

  void putInt(int32_t v) { ops.push_back(v); }
  void putFloat(float f) {
    int32_t bits;
    std::memcpy(&bits, &f, sizeof(bits));
    ops.push_back(bits);
  }
  int32_t addString(const std::string &s) {
    strings.push_back(s);
    return static_cast<int32_t>(strings.size() - 1);
  }
};

std::string hex(const std::string &s) {
  std::string out;
  char buffer[3];
  for (unsigned char c : s) {
    std::snprintf(buffer, sizeof(buffer), "%02x", c);
    out += buffer;
  }
  return out.empty() ? "-" : out;
}

} // namespace

int main() {
  std::string line;
  while (std::getline(std::cin, line)) {
    Sink sink;
    const int32_t kind = expo::svelteengine::nav::kindOfNativeId(line);
    const int32_t count = expo::svelteengine::nav::encodeRecords(sink, line);
    std::printf("kind %d\ncount %d\nops", kind, count);
    for (int32_t v : sink.ops) std::printf(" %d", v);
    std::printf("\nstrings");
    for (const auto &s : sink.strings) std::printf(" %s", hex(s).c_str());
    std::printf("\n");
  }
  return 0;
}
