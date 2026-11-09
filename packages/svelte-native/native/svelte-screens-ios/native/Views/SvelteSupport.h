#pragma once

#import <UIKit/UIKit.h>

#import <React/RCTViewComponentView.h>
#import <folly/dynamic.h>
#import <react/renderer/components/view/ViewEventEmitter.h>

#include <optional>
#include <string>

#include "SvelteNativeID.h"

NS_ASSUME_NONNULL_BEGIN

// Shared by the views of the module: conversions, the events, the lifecycle order, images for the tab bar, and the few
// UIKit subclasses the bridges need.

/// True when the SDK has the iOS 26 APIs (`UINavigationItem.subtitle`, `interactiveContentPopGestureRecognizer`).
#if defined(__IPHONE_26_0) && __IPHONE_OS_VERSION_MAX_ALLOWED >= __IPHONE_26_0
#define SVELTE_IOS26_SDK 1
#else
#define SVELTE_IOS26_SDK 0
#endif

UIColor *_Nullable SvelteColor(const svelte::Color &color);
NSString *_Nullable SvelteString(const std::optional<std::string> &value);

/// The closest view controller above `view` in the responder chain (the controller whose view contains it).
UIViewController *_Nullable SvelteNearestViewController(UIView *view);

/// True when the view hangs below the surface's root component view, where React Native's touch handler already listens.
BOOL SvelteIsUnderSurfaceRoot(UIView *view);

/// `emitter->dispatchEvent("appear", payload)`: JavaScript receives `topAppear` with the payload as its native event.
void SvelteEmit(const facebook::react::SharedViewEventEmitter &emitter, const char *type, folly::dynamic payload);

/// Order of the lifecycle events inside one transition (SPEC.md): the new top's `appear`, the leaving screen's `disappear`,
/// then its `dismissed` (a user's) or `exited` (JavaScript's).
typedef NS_ENUM(NSInteger, SvelteLifecycle) {
  SvelteLifecycleAppear = 0,
  SvelteLifecycleDisappear = 1,
  SvelteLifecycleDismissed = 2,
  SvelteLifecycleExited = 3,
};

/// UIKit reports the two ends of a transition in the same run-loop turn but in an order of its own: the sends are collected
/// and run in the next turn sorted by `kind` (stable otherwise).
void SvelteScheduleLifecycle(SvelteLifecycle kind, dispatch_block_t send);

/// Runs `block` in the display link callback of the next frame (the start of a frame, before its Core Animation commit), so that
/// work queued from a transaction lands in a frame of its own instead of the one the transaction mounted in.
void SvelteAfterNextFrame(dispatch_block_t block);

/// A `UINavigationController` whose status bar follows its top screen and that tells its owner when it has laid out.
@interface SvelteNavigationController : UINavigationController
@property (nonatomic, copy, nullable) void (^didLayout)(void);
@end

/// Holds React Native's touch handler for a view that is presented outside the surface's root view (a modal or a sheet).
@interface SvelteTouchHost : NSObject
/// `offset` is the position, in surface coordinates, of the top left corner of `view`: JavaScript measures in those.
/// A presented view that carries react-native-gesture-handler handlers gets the handler library's root recognizer (`SvelteEnsureGestureRoot`).
- (void)attachToView:(UIView *)view offset:(CGPoint)offset;
- (void)detach;
@end

/// react-native-gesture-handler (RNGH) adds its root recognizer, the one that cancels React Native's touches when a handler activates, to the view that
/// holds the touch handler, when a handler attaches to a view below it. A screen's views are not below it then: UIKit places a screen's view
/// (staged for a push, presented for a sheet) after the commit that mounted it, and RNGH finds no touch handler above a view that has no superview yet.
/// Called when `view` joins its window or starts to hold the touch handler: when RNGH's manager has a handler attached below `view`, asks it to register
/// the root recognizer of the nearest view above that holds the touch handler (the surface, or a presented screen's view), as it would have at attach time.
/// The manager registers it as its own, so a JavaScript responder that blocks the native ones (`handleSetJSResponder`) reaches it. Costs a nil check in
/// an app that has no handler, and nothing when the handler library (or its patch) is not in the app.
void SvelteEnsureGestureRoot(UIView *view);

/// A custom view for a bar item, sized by what Yoga computed for the slot it carries.
@interface SvelteBarContainer : UIView
@property (nonatomic, assign) CGSize contentSize;
@end

/// The image behind a `uri` (`file://`, `data:`, `http(s)://`; the others give nil), delivered on the main queue, at once when it is cached.
void SvelteLoadImage(NSString *uri, void (^completion)(UIImage *_Nullable image));

/// `source` fitted into a 24 pt square and marked as a template, so the bar tints it.
UIImage *SvelteTemplateImage(UIImage *source);

/// What `view` draws, as a 24 pt template image; nil while it has no size.
UIImage *_Nullable SvelteSnapshotImage(UIView *view);

NS_ASSUME_NONNULL_END
