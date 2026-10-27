#pragma once

#import <UIKit/UIKit.h>

#import <React/RCTViewComponentView.h>

#include "SvelteNativeID.h"

NS_ASSUME_NONNULL_BEGIN

@class SvelteHeaderView;
@class SvelteScreenView;
@class SvelteStackView;
@class SvelteToolbarView;
@class SvelteToolbarView;

/// The view controller of one screen: its view is the screen's component view, as react-native-screens' `RNSScreen`.
@interface SvelteScreenController : UIViewController
@property (nonatomic, weak, nullable) SvelteScreenView *screenView;
/// The screen's `stackAnimation` (`svelte::Animation`), kept here because the screen view is gone when a popped screen animates out.
@property (nonatomic) int animation;
- (instancetype)initWithScreenView:(SvelteScreenView *)screenView;
@end

/// `SvelteScreen`: one screen of a stack. Props arrive in `nativeID` (record 110, 122 and 125 of the SPEC).
@interface SvelteScreenView : RCTViewComponentView <
    UIAdaptivePresentationControllerDelegate,
    UISheetPresentationControllerDelegate,
    UINavigationControllerDelegate>

/// Nil once the component view has left the tree and its controller is released.
@property (nonatomic, readonly, nullable) SvelteScreenController *controller;
/// What the stack presents for a modal: the controller, or a navigation controller around it when the screen has a header.
@property (nonatomic, readonly, nullable) UIViewController *presentedController;
@property (nonatomic, weak, nullable) SvelteStackView *stack;
/// JavaScript removed the screen from the tree: whatever UIKit still animates is not a user action.
@property (nonatomic, readonly) BOOL unmounted;
/// The user popped or dismissed the screen; JavaScript has not removed it yet.
@property (nonatomic, readonly) BOOL userDismissed;
/// `topExited` was sent (once per screen).
@property (nonatomic, readonly) BOOL exitReported;

- (const svelte::ScreenSpec &)spec;
/// Something that the screen's navigation item, bar or scroll view depends on changed; the stack applies it at the end of the transaction.
- (void)setNeedsUpdate;
- (BOOL)needsUpdate;
/// Only the toolbar's items, appearance or visibility changed (a badge, a title): the header is left alone.
- (void)setNeedsToolbarUpdate;
- (void)update;
/// Configures the presented controller (style, detents, dismissal) before the stack presents it.
- (void)preparePresentation;
/// Once the screen is presented: VoiceOver must not reach the screen under it, so the presentation's container (a sibling of the
/// presenter's view in the window) and the view in it that holds the presented content hide their siblings from the accessibility
/// tree (unless a sheet has no backdrop).
- (void)markPresentationModal;
/// The navigation bar's visibility and tint, and the toolbar's, for this screen being shown in `navigation`.
- (void)applyBarConfigurationTo:(UINavigationController *)navigation animated:(BOOL)animated;
- (void)markUnmounted;
- (void)markUserDismissed;
/// A screen removed while it is still live (not through `activityState` 0, which the stack takes away first) keeps drawing as a picture, so UIKit's transition has something to move.
- (void)replaceViewWithSnapshot;
/// The user swiped or tapped the presented screen away.
- (void)presentationDidEndByUser;
/// `topDismissed { dismissCount }`.
- (void)emitDismissedWithCount:(NSInteger)count;
/// `topExited`: JavaScript set `activityState` to 0 and the stack has taken the screen away, so JavaScript may unmount it.
- (void)emitExited;
/// What the sheet's detent resolvers were last asked and answered, per detent index (the QA module reads it through the stack's `qaState`).
- (NSDictionary *)qaDetents;
/// The header and the toolbar measure their bars again and tell JavaScript when a height or an inset changed.
- (void)reportBarMetrics;
/// The toolbar reported another height: the first scroll view's bottom inset under a translucent toolbar follows it.
- (void)toolbarMetricsDidChange;
@end

NS_ASSUME_NONNULL_END
