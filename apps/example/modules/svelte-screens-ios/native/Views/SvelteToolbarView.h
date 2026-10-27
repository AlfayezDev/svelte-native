#pragma once

#import <UIKit/UIKit.h>

#import <React/RCTViewComponentView.h>

#include "SvelteNativeID.h"

NS_ASSUME_NONNULL_BEGIN

@class SvelteBarContainer;
@class SvelteScreenView;
@class SvelteToolbarItemView;

/// `SvelteToolbar`: the screen's `toolbarItems`. The view itself draws nothing (the navigation controller's `UIToolbar` does); it is
/// the Yoga band that content is laid out above (or under, when translucent), and its children are not subviews of it: every item
/// and the center slot become `UIBarButtonItem`s of the bar.
@interface SvelteToolbarView : RCTViewComponentView
@property (nonatomic, weak, nullable) SvelteScreenView *screen;
- (const svelte::ToolbarSpec &)spec;
/// Writes `controller.toolbarItems`: the items in order, the center slot in the place of the first flexible space (else after the last item).
- (void)applyToController:(UIViewController *)controller;
/// A screen without a toolbar has no items.
+ (void)clearController:(UIViewController *)controller;
/// The tint and the appearances of the navigation controller's toolbar (shared by every screen of the stack: applied each time a screen is shown).
- (void)applyAppearanceTo:(UIToolbar *)toolbar;
/// `topMetrics { height, inset }` when the bar's height or the bottom inset changed.
- (void)reportMetrics;
/// The height `topMetrics` last carried (the bar's frame height, home indicator included); 0 before the first report.
- (CGFloat)reportedHeight;
/// An item's or the center slot's props, size or content changed.
- (void)contentDidChange;
/// `topPress { key, index }`.
- (void)itemPressed:(SvelteToolbarItemView *)item;
@end

/// What the toolbar's children have in common: a container for the content React Native mounted into them (never a subview of
/// the toolbar), sized by what Yoga computed, and the news to the toolbar when anything about them changes.
@interface SvelteToolbarContentView : RCTViewComponentView
@property (nonatomic, weak, nullable) SvelteToolbarView *toolbar;
@property (nonatomic, readonly) SvelteBarContainer *barView;
/// How many views React Native mounted into the node.
@property (nonatomic, readonly) NSUInteger contentCount;
@end

/// `SvelteToolbarItem`: one action of the bar (an image, a title, a flexible space, or content drawn by JavaScript).
@interface SvelteToolbarItemView : SvelteToolbarContentView
- (const svelte::ToolbarItemSpec &)spec;
/// The bar item for the current props, built (and rebuilt when its form changes) and updated here.
- (UIBarButtonItem *)barItem;
@end

/// `SvelteToolbarCenter`: custom content between the items.
@interface SvelteToolbarCenterView : SvelteToolbarContentView
- (UIBarButtonItem *)barItem;
@end

NS_ASSUME_NONNULL_END
