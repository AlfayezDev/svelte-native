#pragma once

#import <UIKit/UIKit.h>

#import <React/RCTViewComponentView.h>
#import <folly/dynamic.h>

#include "ExpoSvelteID.h"

NS_ASSUME_NONNULL_BEGIN

@class SvelteBarContainer;
@class SvelteHeaderSlotView;
@class SvelteScreenView;

/// `SvelteHeader`: the screen's `UINavigationItem`. The view itself draws nothing (the navigation bar does); it is the Yoga
/// band that content is laid out below, and the slot views it hosts are handed to the bar: the left and right slots as custom
/// bar button items, the center slot as the title view, the search slot as the results of a `UISearchController`.
@interface SvelteHeaderView : RCTViewComponentView <UISearchBarDelegate, UISearchResultsUpdating, UISearchControllerDelegate>
@property (nonatomic, weak, nullable) SvelteScreenView *screen;
- (const svelte::HeaderSpec &)spec;
/// Writes the title, the buttons, the appearance and the search field of `controller.navigationItem`.
- (void)applyToController:(UIViewController *)controller;
/// A screen without a header has a bare navigation item.
+ (void)clearController:(UIViewController *)controller;
/// `topMetrics { height, inset }` when the bar's bottom edge or the top inset changed.
- (void)reportMetrics;
/// A slot's size, props or content changed.
- (void)slotDidChange:(SvelteHeaderSlotView *)slot;
@end

/// `SvelteHeaderSlot`: the left, center, right or search content of a header, as React Native mounted it. UIKit places it:
/// Yoga's size is taken, the position is the bar's.
@interface SvelteHeaderSlotView : RCTViewComponentView
@property (nonatomic, weak, nullable) SvelteHeaderView *header;
/// What the bar shows for the left, center and right slots.
@property (nonatomic, readonly) SvelteBarContainer *barView;
@property (nonatomic, readonly) UIBarButtonItem *barItem;
/// How many views React Native mounted into the slot.
@property (nonatomic, readonly) NSUInteger contentCount;
- (const svelte::SlotSpec &)spec;
- (void)emit:(const char *)type payload:(folly::dynamic)payload;
/// Where the slot's own origin is in surface coordinates, as Yoga laid it out (for the touch handler of presented content).
- (CGPoint)yogaOrigin;
@end

NS_ASSUME_NONNULL_END
