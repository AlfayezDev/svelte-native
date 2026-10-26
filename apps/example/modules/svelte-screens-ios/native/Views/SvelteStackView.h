#pragma once

#import <UIKit/UIKit.h>

#import <React/RCTMountingTransactionObserving.h>
#import <React/RCTViewComponentView.h>

NS_ASSUME_NONNULL_BEGIN

@class SvelteScreenView;

/// `SvelteStack`: a `UINavigationController` that follows its children. The JavaScript stack is the truth: a child that is
/// inserted is pushed (or presented, for a modal or a sheet), a child that is removed is popped (or dismissed); what the user
/// does with a swipe or a button is reported with `topDismissed` and JavaScript removes the child.
@interface SvelteStackView : RCTViewComponentView <RCTMountingTransactionObserving, UINavigationControllerDelegate, UIGestureRecognizerDelegate>

/// A screen's navigation item, bar or scroll view needs updating: done once the current mounting transaction is complete.
- (void)setNeedsFlush;
/// UIKit took a pushed screen out of the stack (a back swipe, the back button).
- (void)screenWasRemovedByUIKit:(SvelteScreenView *)screen;
/// The user dismissed a presented screen (a swipe, a tap outside a sheet).
- (void)modalWasDismissedByUser:(SvelteScreenView *)screen;
@end

NS_ASSUME_NONNULL_END
