#pragma once

#include <algorithm>
#include <vector>

// Decisions of the UIKit bridges that need no UIKit: they are plain functions so that test/records_dump.cpp can run them.

namespace svelte {

enum class StackStep {
  /// The navigation controller already shows the stack.
  None,
  /// Install `staged` at once, without animation.
  Replace,
  /// Install `staged` without animation, then push the top of the desired stack with animation.
  Push,
  /// Install `staged` (the desired stack and, on top of it, the screen that is leaving) without animation, then pop with animation.
  Pop,
};

struct StackPlan {
  StackStep step = StackStep::None;
  std::vector<int> staged;
};

/// How to move a `UINavigationController` from the screens it shows (`current`, bottom first) to the ones the JavaScript
/// stack holds (`desired`), as react-native-screens' `RNSScreenStackView setPushViewControllers:` does: a changed top
/// that is new is pushed, a top that left (popped, or replaced) is popped, any other change is applied without animation.
/// Screens are identified by any distinct integers.
inline StackPlan planStack(const std::vector<int> &current, const std::vector<int> &desired) {
  StackPlan plan;
  if (current == desired || desired.empty()) return plan;
  const auto contains = [](const std::vector<int> &list, int id) { return std::find(list.begin(), list.end(), id) != list.end(); };
  if (current.empty() || current.back() == desired.back()) {
    plan.step = StackStep::Replace;
    plan.staged = desired;
  } else if (!contains(desired, current.back())) {
    plan.step = StackStep::Pop;
    plan.staged = desired;
    plan.staged.push_back(current.back());
  } else if (!contains(current, desired.back())) {
    plan.step = StackStep::Push;
    plan.staged.assign(desired.begin(), desired.end() - 1);
  } else {
    plan.step = StackStep::Replace;
    plan.staged = desired;
  }
  return plan;
}

/// Height of a sheet detent: `fraction` of the largest detent (`maximum`, the container below the top safe area) or, for a
/// negative fraction ("auto"), the height of the content; never above `maximum`, never below zero.
inline double detentHeight(double fraction, double maximum, double content) {
  const double top = std::max(0.0, maximum);
  const double wanted = fraction < 0 ? content : top * std::clamp(fraction > 0 ? fraction : 0.0, 0.0, 1.0);
  return std::clamp(wanted, 0.0, top);
}

}  // namespace svelte
