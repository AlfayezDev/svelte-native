#pragma once

#include <react/renderer/components/view/ConcreteViewShadowNode.h>
#include <react/renderer/components/view/ViewEventEmitter.h>
#include <react/renderer/components/view/ViewProps.h>
#include <react/renderer/core/ConcreteComponentDescriptor.h>
#include <react/renderer/graphics/Size.h>

// The Fabric side of the components: shadow nodes and descriptors without codegen (Expo autolinks local modules without
// running React Native's codegen). Every component is `ViewProps`-derived: Yoga lays it out like a `View`, and what makes it
// a screen, a header, a tab or a toolbar arrives in `nativeID` (SPEC.md, "Screen API contract"). Events go through the plain
// `ViewEventEmitter` (`dispatchEvent("appear")` reaches JavaScript as `topAppear`). The names are the ones
// packages/expo-svelte/src/fabric/navigation.ios.ts registers view configs for.

namespace svelte {

extern const char SvelteStackComponentName[];
extern const char SvelteScreenComponentName[];
extern const char SvelteHeaderComponentName[];
extern const char SvelteHeaderSlotComponentName[];
extern const char SvelteTabsComponentName[];
extern const char SvelteTabComponentName[];
extern const char SvelteToolbarComponentName[];
extern const char SvelteToolbarItemComponentName[];
extern const char SvelteToolbarCenterComponentName[];

class SvelteStackShadowNode final : public facebook::react::ConcreteViewShadowNode<SvelteStackComponentName> {
 public:
  using ConcreteViewShadowNode::ConcreteViewShadowNode;
};

/// The size UIKit gave the screen's view controller, once it is known and differs from what Yoga computed (a modal or a sheet
/// presents at a size of its own). The shadow node lays the screen out at that size, as react-native-screens does.
struct SvelteScreenState {
  facebook::react::Size frameSize{};
};

class SvelteScreenShadowNode final
    : public facebook::react::ConcreteViewShadowNode<
          SvelteScreenComponentName,
          facebook::react::ViewProps,
          facebook::react::ViewEventEmitter,
          SvelteScreenState> {
 public:
  using ConcreteViewShadowNode::ConcreteViewShadowNode;
};

class SvelteHeaderShadowNode final : public facebook::react::ConcreteViewShadowNode<SvelteHeaderComponentName> {
 public:
  using ConcreteViewShadowNode::ConcreteViewShadowNode;
};

class SvelteHeaderSlotShadowNode final : public facebook::react::ConcreteViewShadowNode<SvelteHeaderSlotComponentName> {
 public:
  using ConcreteViewShadowNode::ConcreteViewShadowNode;
};

class SvelteTabsShadowNode final : public facebook::react::ConcreteViewShadowNode<SvelteTabsComponentName> {
 public:
  using ConcreteViewShadowNode::ConcreteViewShadowNode;
};

class SvelteTabShadowNode final : public facebook::react::ConcreteViewShadowNode<SvelteTabComponentName> {
 public:
  using ConcreteViewShadowNode::ConcreteViewShadowNode;
};

class SvelteToolbarShadowNode final : public facebook::react::ConcreteViewShadowNode<SvelteToolbarComponentName> {
 public:
  using ConcreteViewShadowNode::ConcreteViewShadowNode;
};

class SvelteToolbarItemShadowNode final : public facebook::react::ConcreteViewShadowNode<SvelteToolbarItemComponentName> {
 public:
  using ConcreteViewShadowNode::ConcreteViewShadowNode;
};

class SvelteToolbarCenterShadowNode final : public facebook::react::ConcreteViewShadowNode<SvelteToolbarCenterComponentName> {
 public:
  using ConcreteViewShadowNode::ConcreteViewShadowNode;
};

using SvelteStackComponentDescriptor = facebook::react::ConcreteComponentDescriptor<SvelteStackShadowNode>;
using SvelteHeaderComponentDescriptor = facebook::react::ConcreteComponentDescriptor<SvelteHeaderShadowNode>;
using SvelteHeaderSlotComponentDescriptor = facebook::react::ConcreteComponentDescriptor<SvelteHeaderSlotShadowNode>;
using SvelteTabsComponentDescriptor = facebook::react::ConcreteComponentDescriptor<SvelteTabsShadowNode>;
using SvelteTabComponentDescriptor = facebook::react::ConcreteComponentDescriptor<SvelteTabShadowNode>;
using SvelteToolbarComponentDescriptor = facebook::react::ConcreteComponentDescriptor<SvelteToolbarShadowNode>;
using SvelteToolbarItemComponentDescriptor = facebook::react::ConcreteComponentDescriptor<SvelteToolbarItemShadowNode>;
using SvelteToolbarCenterComponentDescriptor = facebook::react::ConcreteComponentDescriptor<SvelteToolbarCenterShadowNode>;

class SvelteScreenComponentDescriptor final : public facebook::react::ConcreteComponentDescriptor<SvelteScreenShadowNode> {
 public:
  using ConcreteComponentDescriptor::ConcreteComponentDescriptor;

  void adopt(facebook::react::ShadowNode &shadowNode) const override {
    const auto &state = static_cast<const SvelteScreenShadowNode::ConcreteState &>(*shadowNode.getState()).getData();
    if (state.frameSize.width > 0 && state.frameSize.height > 0) {
      static_cast<facebook::react::YogaLayoutableShadowNode &>(shadowNode).setSize(state.frameSize);
    }
    ConcreteComponentDescriptor::adopt(shadowNode);
  }
};

}  // namespace svelte
