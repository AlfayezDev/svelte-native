#pragma once

#import <UIKit/UIKit.h>

#import <React/RCTMountingTransactionObserving.h>
#import <React/RCTViewComponentView.h>

#include <unordered_set>

#import <react/renderer/core/ReactPrimitives.h>

#include "ExpoSvelteID.h"

NS_ASSUME_NONNULL_BEGIN

@class SvelteTabsView;

/// The host of one tab's pane in the tabs view (hidden unless the tab is selected; transparent to touches that hit nothing).
@interface SvelteTabPane : UIView
@end

/// `SvelteTab`: the pane of one tab, and its item in the tab bar. The pane is laid out by Yoga and hosted by the tabs view
/// (every pane stays in the window; the selected one is shown); a `native-tab-icon` child is not a pane view: it is drawn
/// into the bar item's image.
@interface SvelteTabView : RCTViewComponentView
@property (nonatomic, weak, nullable) SvelteTabsView *tabs;
/// The empty placeholder the tab bar controller shows for this tab: it carries the bar item, nothing of the pane.
@property (nonatomic, readonly) UIViewController *controller;
/// The host of the pane in the tabs view, the size of the tabs view.
@property (nonatomic, readonly) UIView *pane;
/// Shows or hides the pane's host.
- (void)showPane:(BOOL)shown;
- (const svelte::TabSpec &)spec;
/// Title, badge, enablement, accessibility and the image of the bar item. `selected` is whether JavaScript has this tab selected.
- (void)applyToItemWithLabels:(BOOL)labels selected:(BOOL)selected;
/// Whether the transaction touched the views that draw this tab's snippet icon (the icon is then redrawn at the next flush).
- (BOOL)transactionTouchesIcon:(const facebook::react::MountingTransaction &)transaction;
@end

/// `SvelteTabs`: a `UITabBarController` (bar and placeholders) under the panes, one host per `SvelteTab`. The selected tab is
/// JavaScript's (`sel` and the select count `sc`): a press switches the bar and the shown pane, reports `topSelect`, and the next
/// props decide.
@interface SvelteTabsView : RCTViewComponentView <RCTMountingTransactionObserving, UITabBarControllerDelegate>
- (void)setNeedsFlush;
@end

NS_ASSUME_NONNULL_END
