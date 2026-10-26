#include <react/renderer/components/scrollview/ScrollViewState.h>
#include <react/renderer/core/ConcreteState.h>

#include "SvelteEngineNative.h"

using namespace facebook;
using namespace facebook::react;

namespace expo::svelteengine {

// Same job as React Native's ReactScrollViewHelper.forceUpdateState (a StateWrapper.updateState from the UI thread):
// the shadow node's ScrollViewState.contentOffset feeds LayoutableShadowNode::computeRelativeLayoutMetrics, so
// measure/measureInWindow of descendants stay correct while the list is scrolled. The Java StateWrapper is not needed:
// the delegate keeps the C++ State of every ScrollView it mounted and ConcreteState::updateState is thread-safe.
void SvelteEngineNative::updateScrollState(jint tag, jfloat offsetX, jfloat offsetY) {
  auto state = delegate_->scrollStateFor(tag);
  if (!state) {
    return;
  }
  auto scrollState = std::static_pointer_cast<const ConcreteState<ScrollViewState>>(state);
  const Point offset{offsetX, offsetY};
  scrollState->updateState([offset](const ScrollViewState &old) -> StateData::Shared {
    if (old.contentOffset == offset) {
      return nullptr;  // nothing to change: cancels the update
    }
    auto next = std::make_shared<ScrollViewState>(old);
    next->contentOffset = offset;
    return next;
  });
}

} // namespace expo::svelteengine
