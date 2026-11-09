// Host-side Yoga (React Native's own sources, ReactCommon/yoga) for geometry tests: reads one case per line on standard input and writes,
// per line, the frame Yoga gives an absolutely positioned child of a bordered container.
//
//   <ltr|rtl> <width> <height> <all> <left> <right> <top> <bottom> <start> <end> <childLeft> <childTop> <childRight> <childBottom>
//
// The border widths are the container's (`-` leaves one undefined); the child's insets are its position left/top/right/bottom.
// Output: `<childLeft> <childTop> <childWidth> <childHeight>` in the container's border box (its own origin).
#include <cstdio>
#include <iostream>
#include <sstream>
#include <string>

#include <yoga/Yoga.h>

namespace {

bool number(std::istringstream& in, float& value) {
  std::string token;
  if (!(in >> token)) return false;
  if (token == "-") {
    value = YGUndefined;
    return true;
  }
  value = std::stof(token);
  return true;
}

void border(YGNodeRef node, YGEdge edge, float value) {
  if (!YGFloatIsUndefined(value)) YGNodeStyleSetBorder(node, edge, value);
}

} // namespace

int main() {
  std::string line;
  while (std::getline(std::cin, line)) {
    if (line.empty()) continue;
    std::istringstream in(line);
    std::string direction;
    in >> direction;
    float v[13];
    for (float& value : v) {
      if (!number(in, value)) {
        std::fprintf(stderr, "bad line: %s\n", line.c_str());
        return 2;
      }
    }
    YGNodeRef container = YGNodeNew();
    YGNodeStyleSetWidth(container, v[0]);
    YGNodeStyleSetHeight(container, v[1]);
    border(container, YGEdgeAll, v[2]);
    border(container, YGEdgeLeft, v[3]);
    border(container, YGEdgeRight, v[4]);
    border(container, YGEdgeTop, v[5]);
    border(container, YGEdgeBottom, v[6]);
    border(container, YGEdgeStart, v[7]);
    border(container, YGEdgeEnd, v[8]);
    YGNodeRef child = YGNodeNew();
    YGNodeStyleSetPositionType(child, YGPositionTypeAbsolute);
    YGNodeStyleSetPosition(child, YGEdgeLeft, v[9]);
    YGNodeStyleSetPosition(child, YGEdgeTop, v[10]);
    YGNodeStyleSetPosition(child, YGEdgeRight, v[11]);
    YGNodeStyleSetPosition(child, YGEdgeBottom, v[12]);
    YGNodeInsertChild(container, child, 0);
    YGNodeCalculateLayout(container, YGUndefined, YGUndefined, direction == "rtl" ? YGDirectionRTL : YGDirectionLTR);
    std::printf("%g %g %g %g\n", YGNodeLayoutGetLeft(child), YGNodeLayoutGetTop(child), YGNodeLayoutGetWidth(child), YGNodeLayoutGetHeight(child));
    YGNodeFreeRecursive(container);
  }
  return 0;
}
