#import "SvelteStackView.h"

#import <React/RCTComponentViewFactory.h>
#import <React/RCTLog.h>
#import <react/renderer/componentregistry/ComponentDescriptorProvider.h>

#import "SvelteComponents.h"
#import "SvelteScreenView.h"
#import "SvelteScreensCore.h"
#import "SvelteSupport.h"

using namespace facebook::react;

@implementation SvelteStackView {
  SvelteNavigationController *_controller;
  __weak SvelteScreenView *_staged;
  __weak SvelteScreenView *_stagedPresented;
  NSMutableArray<SvelteScreenView *> *_screens;
  /// The pushed screens JavaScript holds, bottom first, as of the last update.
  NSArray<SvelteScreenView *> *_desired;
  /// The screens this stack presented and their controllers, bottom first.
  NSMutableArray<SvelteScreenView *> *_presentedScreens;
  NSMutableArray<UIViewController *> *_presented;
  BOOL _needsFlush;
  BOOL _flushQueued;
  BOOL _updateScheduled;
  BOOL _updatingModals;
  BOOL _modalsDirty;
  BOOL _exitsQueued;
}

+ (ComponentDescriptorProvider)componentDescriptorProvider {
  return concreteComponentDescriptorProvider<svelte::SvelteStackComponentDescriptor>();
}

+ (BOOL)shouldBeRecycled {
  return NO;
}

+ (void)load {
  [[RCTComponentViewFactory currentComponentViewFactory] registerComponentViewClass:self];
}

- (instancetype)initWithFrame:(CGRect)frame {
  if (self = [super initWithFrame:frame]) {
    _screens = [NSMutableArray new];
    _desired = @[];
    _presented = [NSMutableArray new];
    _presentedScreens = [NSMutableArray new];
    _controller = [SvelteNavigationController new];
    _controller.delegate = self;
    _controller.navigationBar.prefersLargeTitles = YES;
    __weak SvelteStackView *weakSelf = self;
    _controller.didLayout = ^{
      SvelteStackView *stack = weakSelf;
      if (stack != nil) [[stack screenForController:stack->_controller.topViewController] reportHeaderMetrics];
    };
    // A large title renders expanded only when the controller starts with a non-empty stack, as react-native-screens found.
    [_controller setViewControllers:@[ [UIViewController new] ]];
  }
  return self;
}

- (SvelteScreenView *_Nullable)screenForController:(UIViewController *)controller {
  return [controller isKindOfClass:[SvelteScreenController class]] ? ((SvelteScreenController *)controller).screenView : nil;
}

- (void)setNeedsFlush {
  _needsFlush = YES;
}

#pragma mark - Component view protocol

- (void)mountChildComponentView:(UIView<RCTComponentViewProtocol> *)childComponentView index:(NSInteger)index {
  if (![childComponentView isKindOfClass:[SvelteScreenView class]]) {
    RCTLogError(@"SvelteStack only accepts SvelteScreen children, got %@", childComponentView);
    return;
  }
  // The screens are not subviews of the stack: UIKit puts their views where it needs them.
  SvelteScreenView *screen = (SvelteScreenView *)childComponentView;
  [_screens insertObject:screen atIndex:(NSUInteger)index];
  screen.stack = self;
  _needsFlush = YES;
}

- (void)unmountChildComponentView:(UIView<RCTComponentViewProtocol> *)childComponentView index:(NSInteger)index {
  if (![childComponentView isKindOfClass:[SvelteScreenView class]]) return;
  SvelteScreenView *screen = (SvelteScreenView *)childComponentView;
  [screen markUnmounted];
  // A screen JavaScript took out through `activityState` 0 was animated away first and reported `exited`: nothing to draw.
  // A live screen removed outright (its stack goes with a parent) is replaced by a picture, so UIKit has something to move.
  if (!screen.exitReported) [screen replaceViewWithSnapshot];
  screen.stack = nil;
  [_screens removeObject:screen];
  _needsFlush = YES;
}

- (void)updateLayoutMetrics:(const LayoutMetrics &)layoutMetrics oldLayoutMetrics:(const LayoutMetrics &)oldLayoutMetrics {
  [super updateLayoutMetrics:layoutMetrics oldLayoutMetrics:oldLayoutMetrics];
  _controller.view.semanticContentAttribute = self.semanticContentAttribute;
  _controller.navigationBar.semanticContentAttribute = self.semanticContentAttribute;
}

- (void)layoutSubviews {
  [super layoutSubviews];
  _controller.view.frame = self.bounds;
}

- (void)didMoveToWindow {
  [super didMoveToWindow];
  if (self.window != nil) {
    _needsFlush = YES;
    [self flush];
  }
}

// What a transaction mounted reaches UIKit in steps, each on a frame of its own (a Time Profiler run of navigation-8 on an iPhone
// SE 3: a 60-row screen of 180 views costs 15 ms to mount, 20 ms to attach to the window and start the transition, 14 ms to end
// it, and the same again on the way back, each of them one dropped interval at 60 Hz when they share a frame): the transaction's
// own frame mounts the views; the next frame's start applies what changed (`flush`), which for a screen that is going to be
// shown only attaches its view to the navigation controller's view out of sight (`stage:`); the frame after that pushes,
// pops or presents it, UIKit finding its view in the window already.
- (void)mountingTransactionDidMount:(const MountingTransaction &)transaction withSurfaceTelemetry:(const SurfaceTelemetry &)surfaceTelemetry {
  if (!_needsFlush || _flushQueued) return;
  _flushQueued = YES;
  __weak SvelteStackView *weakSelf = self;
  dispatch_block_t run = ^{
    SvelteStackView *stack = weakSelf;
    if (stack == nil) return;
    stack->_flushQueued = NO;
    if (stack->_needsFlush) [stack flush];
  };
  SvelteAfterNextFrame(run);
}

- (void)invalidate {
  [self unstage];
  for (UIViewController *modal in _presented) [modal dismissViewControllerAnimated:NO completion:nil];
  [_presented removeAllObjects];
  [_presentedScreens removeAllObjects];
  _controller.delegate = nil;
  _controller.didLayout = nil;
  [_controller willMoveToParentViewController:nil];
  [_controller.view removeFromSuperview];
  [_controller removeFromParentViewController];
}

#pragma mark - Updating UIKit from the children

// What the children say becomes UIKit's state in one go, after all of a transaction's mutations: the screens' navigation
// items first, so that the first frame of a screen has its title, then the pushed controllers, then the presented ones.
- (void)flush {
  // A full screen modal takes the stack's view out of the window while it covers it: what JavaScript asks of the modals (a back,
  // a reset) still has to reach UIKit then, and the pushed screens catch up when the view comes back (`didMoveToWindow`).
  const BOOL covered = self.window == nil && _presented.count > 0;
  if (self.window == nil && !covered) {
    [self reportExits];
    return;
  }
  _needsFlush = NO;
  for (SvelteScreenView *screen in [_screens copy]) {
    if ([screen needsUpdate]) [screen update];
  }
  if (!covered) {
    [self updatePushedControllers];
    [self attachControllerIfNeeded];
  }
  [self updatePresentedControllers];
  [self reportExits];
}

// A screen whose `activityState` JavaScript set to 0 is taken away by `updatePushedControllers` and
// `updatePresentedControllers` (animated unless its `animation` is none) and stays mounted all along, so that the unmount of its
// subtree is not part of the transition's frames. Once nothing moves any more, `topExited` tells JavaScript it may remove it.
// Every flush and every end of a transition asks again; the turn between keeps the end of UIKit's own completion work out of the
// frame in which JavaScript's removal arrives.
- (void)reportExits {
  if (_exitsQueued) return;
  _exitsQueued = YES;
  __weak SvelteStackView *weakSelf = self;
  dispatch_async(dispatch_get_main_queue(), ^{
    SvelteStackView *stack = weakSelf;
    if (stack == nil) return;
    stack->_exitsQueued = NO;
    [stack sendExits];
  });
}

- (void)sendExits {
  if (_updatingModals) return;  // `finish` of the presentation asks again
  id<UIViewControllerTransitionCoordinator> coordinator = _controller.transitionCoordinator;
  if (coordinator != nil) {
    __weak SvelteStackView *weakSelf = self;
    const BOOL queued = [coordinator animateAlongsideTransition:nil
                                                     completion:^(id<UIViewControllerTransitionCoordinatorContext> context) {
                                                       [weakSelf reportExits];
                                                     }];
    if (!queued) {
      dispatch_after(dispatch_time(DISPATCH_TIME_NOW, (int64_t)(0.05 * NSEC_PER_SEC)), dispatch_get_main_queue(), ^{
        [weakSelf reportExits];
      });
    }
    return;
  }
  for (SvelteScreenView *screen in [_screens copy]) {
    if ([screen spec].activityState == 0 && [self hasLeft:screen]) [screen emitExited];
  }
}

// A screen has left when UIKit no longer holds its controller: not a child of the navigation controller, not presented. A pop
// that waits for its frame (the staging above) has not happened yet, and its screen is still the top of the stack.
- (BOOL)hasLeft:(SvelteScreenView *)screen {
  SvelteScreenController *controller = screen.controller;
  if (controller == nil) return YES;
  if ([_presentedScreens containsObject:screen]) return NO;
  UIViewController *presented = screen.presentedController;
  if (presented.presentingViewController != nil) return NO;
  return controller.parentViewController == nil || ([screen spec].presentation != svelte::kPush && presented.parentViewController == nil);
}

// The controller joins the controller above it, so that appearance callbacks and the status bar follow; its view joins ours.
- (void)attachControllerIfNeeded {
  if (_controller.parentViewController != nil) return;
  UIViewController *parent = SvelteNearestViewController(self);
  if (parent == nil) return;
  [parent addChildViewController:_controller];
  _controller.view.frame = self.bounds;
  [self addSubview:_controller.view];
  [_controller didMoveToParentViewController:parent];
  // Our delegate decides when the edge swipe begins: it must work without a visible bar and follow `gestureEnabled`.
  _controller.interactivePopGestureRecognizer.delegate = self;
#if SVELTE_IOS26_SDK
  if (@available(iOS 26.0, *)) {
    // The full screen back swipe of iOS 26 is not part of the contract (an edge swipe, as on Android).
    _controller.interactiveContentPopGestureRecognizer.enabled = NO;
  }
#endif
  [self navigationController:_controller willShowViewController:_controller.topViewController animated:NO];
}

- (void)updatePushedControllers {
  NSMutableArray<SvelteScreenView *> *desired = [NSMutableArray new];
  for (SvelteScreenView *screen in _screens) {
    if ([screen spec].activityState == 0 || screen.userDismissed || screen.controller == nil) continue;
    // The first live screen is the root of the navigation controller whatever its presentation.
    if (desired.count == 0 || [screen spec].presentation == svelte::kPush) [desired addObject:screen];
  }
  _desired = desired;
  if (desired.count == 0) return;

  NSMutableArray<UIViewController *> *known = [NSMutableArray new];
  const auto identify = [known](UIViewController *controller) {
    NSUInteger index = [known indexOfObject:controller];
    if (index == NSNotFound) {
      [known addObject:controller];
      index = known.count - 1;
    }
    return (int)index;
  };
  std::vector<int> current;
  std::vector<int> wanted;
  for (UIViewController *controller in _controller.viewControllers) {
    if ([controller isKindOfClass:[SvelteScreenController class]]) current.push_back(identify(controller));
  }
  for (SvelteScreenView *screen in desired) wanted.push_back(identify(screen.controller));
  const svelte::StackPlan plan = svelte::planStack(current, wanted);
  if (plan.step == svelte::StackStep::None) {
    [self unstage];
    return;
  }

  // UIKit ignores changes while a transition runs: the update waits for its end.
  id<UIViewControllerTransitionCoordinator> coordinator = _controller.transitionCoordinator;
  if (coordinator != nil) {
    if (!_updateScheduled) {
      _updateScheduled = YES;
      __weak SvelteStackView *weakSelf = self;
      [coordinator animateAlongsideTransition:nil
                                   completion:^(id<UIViewControllerTransitionCoordinatorContext> context) {
                                     SvelteStackView *stack = weakSelf;
                                     if (stack == nil) return;
                                     stack->_updateScheduled = NO;
                                     [stack flush];
                                   }];
    }
    return;
  }

  NSMutableArray<UIViewController *> *staged = [NSMutableArray new];
  for (int index : plan.staged) [staged addObject:known[(NSUInteger)index]];
  const BOOL visible = self.window != nil;
  dispatch_block_t install = ^{
    if (![_controller.viewControllers isEqualToArray:staged]) [_controller setViewControllers:staged animated:NO];
  };
  switch (plan.step) {
    case svelte::StackStep::Replace:
      [self unstage];
      [_controller setViewControllers:staged animated:NO];
      break;
    case svelte::StackStep::Push: {
      SvelteScreenView *top = desired.lastObject;
      if (visible && _staged != top) {
        [self stage:top];
        [self flushAfterNextFrame];
        return;
      }
      _staged = nil;
      install();
      [_controller pushViewController:top.controller animated:visible && [top spec].animation != svelte::kAnimationNone];
      break;
    }
    case svelte::StackStep::Pop: {
      // The screen on top of `staged` is the one that leaves: its animation tells how (its view may be gone already).
      UIViewController *leaving = staged.lastObject;
      SvelteScreenController *leavingController = [leaving isKindOfClass:[SvelteScreenController class]] ? (SvelteScreenController *)leaving : nil;
      const int animation = leavingController != nil ? leavingController.animation : svelte::kAnimationDefault;
      SvelteScreenView *revealed = desired.lastObject;
      if (visible && _staged != revealed && revealed.controller.view.superview == nil) {
        [self stage:revealed];
        [leavingController.screenView replaceViewWithSnapshot];
        [self flushAfterNextFrame];
        return;
      }
      _staged = nil;
      if (visible) [leavingController.screenView replaceViewWithSnapshot];
      install();
      [_controller popViewControllerAnimated:visible && animation != svelte::kAnimationNone];
      break;
    }
    case svelte::StackStep::None:
      break;
  }
}

// The screen's view joins the navigation controller's own view, out of sight behind the current screen, a frame before UIKit
// moves it into the transition: attaching its subtree to the window (traits, layout, the first drawing of its text) is then a
// frame of its own, not part of the one that starts the transition.
- (void)stage:(SvelteScreenView *)screen {
  UIView *view = screen.controller.view;
  if (view == nil) return;
  if (_staged != screen) [self unstage];
  _staged = screen;
  const CGRect bounds = _controller.view.bounds;
  view.frame = CGRectMake(bounds.size.width * 2, 0, bounds.size.width, bounds.size.height);
  [_controller.view insertSubview:view atIndex:0];
}

- (void)unstage {
  SvelteScreenView *staged = _staged;
  _staged = nil;
  UIView *view = staged.controller.view;
  if (view != nil && view.superview == _controller.view) [view removeFromSuperview];
}

- (void)flushAfterNextFrame {
  if (_flushQueued) return;
  _flushQueued = YES;
  __weak SvelteStackView *weakSelf = self;
  SvelteAfterNextFrame(^{
    SvelteStackView *stack = weakSelf;
    if (stack == nil) return;
    stack->_flushQueued = NO;
    [stack flush];
  });
}

- (void)updatePresentedControllers {
  NSMutableArray<SvelteScreenView *> *desired = [NSMutableArray new];
  BOOL seenRoot = NO;
  for (SvelteScreenView *screen in _screens) {
    if ([screen spec].activityState == 0 || screen.userDismissed || screen.controller == nil) continue;
    if (!seenRoot) {
      seenRoot = YES;
      continue;
    }
    if ([screen spec].presentation != svelte::kPush) [desired addObject:screen];
  }
  if ([_presentedScreens isEqualToArray:desired]) return;
  if (_updatingModals) {
    _modalsDirty = YES;
    return;
  }

  // The first presented screen that is not wanted anymore goes, with everything above it; the new ones are presented on the last that stays.
  UIViewController *base = _controller;
  NSUInteger kept = 0;
  while (kept < MIN(_presentedScreens.count, desired.count) && _presentedScreens[kept] == desired[kept]) {
    base = _presented[kept];
    kept++;
  }
  _updatingModals = YES;
  __weak SvelteStackView *weakSelf = self;
  dispatch_block_t finish = ^{
    SvelteStackView *stack = weakSelf;
    if (stack == nil) return;
    stack->_updatingModals = NO;
    if (stack->_modalsDirty) {
      stack->_modalsDirty = NO;
      [stack flush];
    }
    [stack reportExits];
  };
  void (^presentNew)(void) = ^{
    SvelteStackView *stack = weakSelf;
    if (stack == nil) return;
    if (kept < stack->_presented.count) {
      const NSRange gone = NSMakeRange(kept, stack->_presented.count - kept);
      [stack->_presented removeObjectsInRange:gone];
      [stack->_presentedScreens removeObjectsInRange:gone];
    }
    if (kept >= desired.count || base.viewIfLoaded.window == nil) {
      finish();
      return;
    }
    [stack presentScreens:desired from:kept above:base completion:finish];
  };
  UIViewController *first = base.presentedViewController;
  if (first != nil) {
    const NSUInteger index = [_presented indexOfObject:first];
    const BOOL animated = index == NSNotFound || [_presentedScreens[index] spec].animation != svelte::kAnimationNone;
    [base dismissViewControllerAnimated:animated completion:presentNew];
  } else {
    presentNew();
  }
}

// One at a time: UIKit refuses to present on a controller that is still being presented.
- (void)presentScreens:(NSArray<SvelteScreenView *> *)screens from:(NSUInteger)index above:(UIViewController *)previous completion:(dispatch_block_t)completion {
  if (index >= screens.count) {
    completion();
    return;
  }
  SvelteScreenView *screen = screens[index];
  [screen preparePresentation];
  UIViewController *next = screen.presentedController;
  if (next == nil || previous.isBeingDismissed) {
    completion();
    return;
  }
  // The presented view joins the navigation controller's own view a frame before UIKit presents it, as a pushed screen's does.
  if (self.window != nil && _stagedPresented != screen) {
    if (_stagedPresented != nil) [_stagedPresented.presentedController.view removeFromSuperview];
    _stagedPresented = screen;
    UIView *view = next.view;
    const CGRect bounds = _controller.view.bounds;
    view.frame = CGRectMake(bounds.size.width * 2, 0, bounds.size.width, bounds.size.height);
    [_controller.view insertSubview:view atIndex:0];
    __weak SvelteStackView *weakSelf = self;
    SvelteAfterNextFrame(^{
      [weakSelf presentScreens:screens from:index above:previous completion:completion];
    });
    return;
  }
  if (_stagedPresented == screen) _stagedPresented = nil;
  const BOOL animated = index == screens.count - 1 && [screen spec].animation != svelte::kAnimationNone;
  __weak SvelteStackView *weakSelf = self;
  [previous presentViewController:next
                         animated:animated
                       completion:^{
                         SvelteStackView *stack = weakSelf;
                         if (stack == nil) return;
                         [stack->_presented addObject:next];
                         [stack->_presentedScreens addObject:screen];
                         [stack presentScreens:screens from:index + 1 above:next completion:completion];
                       }];
}

#pragma mark - What the user did

- (void)screenWasRemovedByUIKit:(SvelteScreenView *)screen {
  // JavaScript asked for the screen to go (a pop, a replace) unless it still wants it.
  if (![_desired containsObject:screen]) return;
  NSMutableArray<SvelteScreenView *> *removed = [NSMutableArray new];
  for (SvelteScreenView *candidate in _desired) {
    if (!candidate.userDismissed && candidate.controller.parentViewController == nil) [removed addObject:candidate];
  }
  if (removed.count == 0) return;
  for (SvelteScreenView *candidate in removed) [candidate markUserDismissed];
  [self scheduleDismissedOf:removed.firstObject count:(NSInteger)removed.count];
}

- (void)modalWasDismissedByUser:(SvelteScreenView *)screen {
  const NSUInteger index = [_presentedScreens indexOfObject:screen];
  if (index == NSNotFound) return;
  // Everything presented above it went too.
  const NSRange gone = NSMakeRange(index, _presentedScreens.count - index);
  for (SvelteScreenView *dismissed in [_presentedScreens subarrayWithRange:gone]) [dismissed markUserDismissed];
  [_presented removeObjectsInRange:gone];
  [_presentedScreens removeObjectsInRange:gone];
  [self scheduleDismissedOf:screen count:(NSInteger)gone.length];
}

// JavaScript removes the screen (and the ones above) when it hears of it, after the transition's `appear` and `disappear`.
- (void)scheduleDismissedOf:(SvelteScreenView *)screen count:(NSInteger)count {
  SvelteScheduleLifecycle(SvelteLifecycleDismissed, ^{
    [screen emitDismissedWithCount:count];
  });
}

#pragma mark - Navigation controller and gestures

- (void)navigationController:(UINavigationController *)navigationController
      willShowViewController:(UIViewController *)viewController
                    animated:(BOOL)animated {
  [[self screenForController:viewController] applyBarConfigurationTo:navigationController animated:animated];
}

- (void)navigationController:(UINavigationController *)navigationController
       didShowViewController:(UIViewController *)viewController
                    animated:(BOOL)animated {
  [[self screenForController:viewController] reportHeaderMetrics];
}

- (BOOL)gestureRecognizerShouldBegin:(UIGestureRecognizer *)gestureRecognizer {
  if (_controller.viewControllers.count < 2 || _controller.transitionCoordinator != nil) return NO;
  SvelteScreenView *top = [self screenForController:_controller.topViewController];
  return top != nil && [top spec].gesture != 0 && [top spec].nativeBack != 0;
}

- (BOOL)gestureRecognizer:(UIGestureRecognizer *)gestureRecognizer shouldReceiveTouch:(UITouch *)touch {
  return _controller.viewControllers.count > 1;
}

@end
