#import "SvelteScreenView.h"

#import <React/RCTComponentViewFactory.h>
#import <React/RCTConversions.h>
#import <React/RCTScrollViewComponentView.h>
#import <react/renderer/componentregistry/ComponentDescriptorProvider.h>
#import <react/renderer/components/view/ViewProps.h>
#import <react/renderer/core/EventQueue.h>

#import <cmath>

#import "SvelteComponents.h"
#import "SvelteHeaderView.h"
#import "SvelteScreensCore.h"
#import "SvelteStackView.h"
#import "SvelteSupport.h"
#import "SvelteToolbarView.h"

using namespace facebook::react;

@interface SvelteScreenView ()
- (void)controllerDidAppear;
- (void)controllerDidDisappear;
- (void)controllerDidLayout;
- (UIStatusBarStyle)statusBarStyle;
- (BOOL)statusBarHidden;
@end

@implementation SvelteScreenController

- (instancetype)initWithScreenView:(SvelteScreenView *)screenView {
  if (self = [super initWithNibName:nil bundle:nil]) {
    _screenView = screenView;
    self.view = screenView;
    // The view extends under the bar, so that Yoga's header band is drawn over and the screen's frame stays the whole container.
    self.edgesForExtendedLayout = UIRectEdgeAll;
    self.extendedLayoutIncludesOpaqueBars = YES;
  }
  return self;
}

- (void)viewWillAppear:(BOOL)animated {
  [super viewWillAppear:animated];
  [self.screenView uncover];
}

- (void)viewDidAppear:(BOOL)animated {
  [super viewDidAppear:animated];
  [self.screenView controllerDidAppear];
}

- (void)viewDidDisappear:(BOOL)animated {
  [super viewDidDisappear:animated];
  [self.screenView controllerDidDisappear];
}

- (void)viewDidLayoutSubviews {
  [super viewDidLayoutSubviews];
  [self.screenView controllerDidLayout];
}

- (BOOL)accessibilityPerformEscape {
  return [self.screenView accessibilityPerformEscape];
}

- (UIStatusBarStyle)preferredStatusBarStyle {
  SvelteScreenView *screen = self.screenView;
  return screen != nil ? [screen statusBarStyle] : UIStatusBarStyleDefault;
}

- (BOOL)prefersStatusBarHidden {
  SvelteScreenView *screen = self.screenView;
  return screen != nil ? [screen statusBarHidden] : NO;
}

@end

/// The `nativeID` of a screen without its `a=<activityState>` pair (always the first one, record 110).
static std::string WithoutActivityState(const std::string &nativeId) {
  const size_t at = nativeId.find(";a=");
  if (at == std::string::npos) return nativeId;
  const size_t end = nativeId.find(';', at + 1);
  return end == std::string::npos ? nativeId.substr(0, at) : nativeId.substr(0, at) + nativeId.substr(end);
}

@implementation SvelteScreenView {
  SvelteScreenController *_controller;
  SvelteNavigationController *_wrapper;
  __weak SvelteHeaderView *_header;
  __weak SvelteToolbarView *_toolbar;
  svelte::ScreenSpec _spec;
  std::string _nativeId;
  BOOL _specParsed;
  svelte::SvelteScreenShadowNode::ConcreteState::Shared _state;
  CGSize _reportedSize;
  BOOL _unmounted;
  NSMutableDictionary<NSString *, NSDictionary *> *_qaDetents;
  BOOL _userDismissed;
  BOOL _exitReported;
  BOOL _needsUpdate;
  BOOL _needsToolbarUpdate;
  BOOL _initialDetentApplied;
  BOOL _visible;
  /// While a push has covered the screen: its content (what JavaScript mounted into it), kept in a view that is in no window, and the picture of it drawn in its place.
  UIView *_parkedContent;
  UIView *_coverPicture;
  std::vector<double> _appliedDetents;
  SvelteTouchHost *_touch;
  __weak RCTScrollViewComponentView *_adjustedScroll;
  /// The toolbar height taken off `_adjustedScroll`'s bottom content inset (and added to its indicator inset); 0 when none is.
  CGFloat _toolbarInset;
}

+ (ComponentDescriptorProvider)componentDescriptorProvider {
  return concreteComponentDescriptorProvider<svelte::SvelteScreenComponentDescriptor>();
}

+ (BOOL)shouldBeRecycled {
  return NO;
}

+ (void)load {
  [[RCTComponentViewFactory currentComponentViewFactory] registerComponentViewClass:self];
}

- (instancetype)initWithFrame:(CGRect)frame {
  if (self = [super initWithFrame:frame]) {
    _controller = [[SvelteScreenController alloc] initWithScreenView:self];
  }
  return self;
}

- (const svelte::ScreenSpec &)spec {
  return _spec;
}

- (BOOL)needsUpdate {
  return _needsUpdate || _needsToolbarUpdate;
}

- (void)setNeedsUpdate {
  _needsUpdate = YES;
  [_stack setNeedsFlush];
}

- (void)setNeedsToolbarUpdate {
  _needsToolbarUpdate = YES;
  [_stack setNeedsFlush];
}

- (void)markUnmounted {
  _unmounted = YES;
}

- (void)markUserDismissed {
  _userDismissed = YES;
}

- (BOOL)exitReported {
  return _exitReported;
}

#pragma mark - Component view protocol

- (void)updateProps:(const Props::Shared &)props oldProps:(const Props::Shared &)oldProps {
  [super updateProps:props oldProps:oldProps];
  const auto &viewProps = static_cast<const ViewProps &>(*props);
  if (_specParsed && viewProps.nativeId == _nativeId) return;
  const BOOL onlyActivity = _specParsed && WithoutActivityState(viewProps.nativeId) == WithoutActivityState(_nativeId);
  _nativeId = viewProps.nativeId;
  _specParsed = YES;
  _spec = svelte::parseScreen(_nativeId);
  if (_spec.activityState != 0) _exitReported = NO;
  _controller.animation = _spec.animation;
  if (onlyActivity) {
    // A screen JavaScript sent away (`activityState` 0) is taken off the stack; its bar, scroll view and sheet stay as they were.
    [_stack setNeedsFlush];
    return;
  }
  [_controller setNeedsStatusBarAppearanceUpdate];
  [self setNeedsUpdate];
}

- (void)updateState:(const State::Shared &)state oldState:(const State::Shared &)oldState {
  _state = std::static_pointer_cast<const svelte::SvelteScreenShadowNode::ConcreteState>(state);
}

// UIKit sizes the controller's view while the screen is in a navigation controller or presented, and Yoga learns the size
// through the shadow state (`controllerDidLayout`); before that the frame Yoga computed applies.
- (void)updateLayoutMetrics:(const LayoutMetrics &)layoutMetrics oldLayoutMetrics:(const LayoutMetrics &)oldLayoutMetrics {
  if (_controller.parentViewController != nil || _controller.presentingViewController != nil) {
    _layoutMetrics = layoutMetrics;
    return;
  }
  [super updateLayoutMetrics:layoutMetrics oldLayoutMetrics:oldLayoutMetrics];
}

- (void)mountChildComponentView:(UIView<RCTComponentViewProtocol> *)childComponentView index:(NSInteger)index {
  if ([childComponentView isKindOfClass:[SvelteHeaderView class]]) {
    SvelteHeaderView *header = (SvelteHeaderView *)childComponentView;
    header.screen = self;
    _header = header;
  }
  if ([childComponentView isKindOfClass:[SvelteToolbarView class]]) {
    SvelteToolbarView *toolbar = (SvelteToolbarView *)childComponentView;
    toolbar.screen = self;
    _toolbar = toolbar;
    _needsToolbarUpdate = YES;
  }
  if (_parkedContent != nil) {
    // What JavaScript mounts into a covered screen goes where the rest of its content is, at the index it counts in.
    [_parkedContent insertSubview:childComponentView atIndex:MIN(index, (NSInteger)_parkedContent.subviews.count)];
  } else {
    [super mountChildComponentView:childComponentView index:index];
  }
  [self setNeedsUpdate];
}

- (void)unmountChildComponentView:(UIView<RCTComponentViewProtocol> *)childComponentView index:(NSInteger)index {
  SvelteHeaderView *header = _header;
  if (childComponentView == header) {
    header.screen = nil;
    _header = nil;
  }
  SvelteToolbarView *toolbar = _toolbar;
  if (childComponentView == toolbar) {
    toolbar.screen = nil;
    _toolbar = nil;
    _needsToolbarUpdate = YES;
  }
  if (_parkedContent != nil) {
    [childComponentView removeFromSuperview];
  } else {
    [super unmountChildComponentView:childComponentView index:index];
  }
  [self setNeedsUpdate];
}

- (void)invalidate {
  _unmounted = YES;
  [_touch detach];
  // The controller and its view hold each other: let go once UIKit is done with whatever it still animates.
  dispatch_async(dispatch_get_main_queue(), ^{
    self->_controller = nil;
    self->_wrapper = nil;
  });
}

#pragma mark - Presentation

- (UIViewController *)presentedController {
  return _wrapper != nil ? (UIViewController *)_wrapper : (UIViewController *)_controller;
}

// A modal has no navigation controller above it: a modal with a header or a toolbar gets one of its own, as it is presented (a
// screen that the stack pushes must not have one: its controller belongs to the stack's). One without either has no bar to show.
- (void)ensureWrapper {
  if (_wrapper != nil || _controller == nil || (_header == nil && _toolbar == nil) || _spec.presentation == svelte::kPush) return;
  _wrapper = [[SvelteNavigationController alloc] initWithRootViewController:_controller];
  _wrapper.navigationBar.prefersLargeTitles = YES;
  _wrapper.delegate = self;
  __weak SvelteScreenView *weakSelf = self;
  _wrapper.didLayout = ^{
    SvelteScreenView *screen = weakSelf;
    if (screen != nil) [screen reportBarMetrics];
  };
}

- (void)preparePresentation {
  [self ensureWrapper];
  UIViewController *presented = self.presentedController;
  if (presented == nil) return;
  // A wrapper that has no header must not show UIKit's bar, and its toolbar is shown from the start: `willShowViewController` is
  // not guaranteed for the root of a controller that is presented.
  if (_wrapper != nil) [self applyBarConfigurationTo:_wrapper animated:NO];
  switch (_spec.presentation) {
    case svelte::kModal:
      presented.modalPresentationStyle = UIModalPresentationFullScreen;
      break;
    case svelte::kTransparentModal:
      presented.modalPresentationStyle = UIModalPresentationOverCurrentContext;
      break;
    case svelte::kSheet:
    case svelte::kFormSheet:
      presented.modalPresentationStyle = UIModalPresentationPageSheet;
      break;
    default:
      return;
  }
  if (_spec.animation == svelte::kAnimationFade && !_spec.isSheet()) presented.modalTransitionStyle = UIModalTransitionStyleCrossDissolve;
  presented.modalPresentationCapturesStatusBarAppearance = YES;
  presented.presentationController.delegate = self;
  [self applyDismissalPolicy];
  [self applySheetConfiguration];
}

- (void)markPresentationModal {
  // The detents were resolved before the sheet had a window: resolve them again against it.
  if (_spec.isSheet()) [self.presentedController.sheetPresentationController invalidateDetents];
  if (_spec.isSheet() && _spec.noBackdrop != 0) return;
  UIViewController *presented = self.presentedController;
  presented.view.accessibilityViewIsModal = YES;
  // VoiceOver skips the siblings of a modal view: UIKit holds the presented content in a view of the presentation's container
  // (next to its dimming view), and the container itself sits next to the presenter's view in the window. The container is the
  // view whose siblings are the screen under the sheet.
  presented.presentationController.presentedView.accessibilityViewIsModal = YES;
  presented.presentationController.containerView.accessibilityViewIsModal = YES;
}

// The swipe-down gesture and a tap outside dismiss a sheet unless the screen opted out; a screen without `gestureEnabled` stays too.
- (void)applyDismissalPolicy {
  UIViewController *presented = self.presentedController;
  if (presented == nil || _spec.presentation == svelte::kPush) return;
  presented.modalInPresentation = _spec.gesture == 0 || (_spec.isSheet() && _spec.dismissible == 0);
}

- (NSString *)detentIdentifierAtIndex:(NSInteger)index {
  return [@(index) stringValue];
}

- (void)applySheetConfiguration {
  if (!_spec.isSheet()) return;
  UISheetPresentationController *sheet = self.presentedController.sheetPresentationController;
  if (sheet == nil) return;
  sheet.delegate = self;
  if (_appliedDetents != _spec.detents) {
    NSMutableArray<UISheetPresentationControllerDetent *> *detents = [NSMutableArray new];
    __weak SvelteScreenView *weakSelf = self;
    for (size_t index = 0; index < _spec.detents.size(); index++) {
      const double fraction = _spec.detents[index];
      [detents addObject:[UISheetPresentationControllerDetent
                             customDetentWithIdentifier:[self detentIdentifierAtIndex:(NSInteger)index]
                                               resolver:^CGFloat(id<UISheetPresentationControllerDetentResolutionContext> context) {
                                                 // `auto` is the height Yoga gave the screen's content.
                                                 SvelteScreenView *screen = weakSelf;
                                                 const double content = screen != nil ? screen->_layoutMetrics.frame.size.height : 0;
                                                 // The contract's space is the window below its top safe area (Android's stack below the status
                                                 // bar); UIKit's largest detent (`maximumDetentValue`: on iOS 26 a floating sheet stops lower)
                                                 // only limits it. Before the sheet is in a window the largest detent stands in.
                                                 UIWindow *window = screen.window;
                                                 const double available = window != nil ? window.bounds.size.height - window.safeAreaInsets.top : context.maximumDetentValue;
                                                 const double height = svelte::detentHeight(fraction, available, context.maximumDetentValue, content);
                                                 if (screen != nil) {
                                                   if (screen->_qaDetents == nil) screen->_qaDetents = [NSMutableDictionary new];
                                                   screen->_qaDetents[[@(index) stringValue]] = @{
                                                     @"fraction" : @(fraction),
                                                     @"available" : @(available),
                                                     @"maximum" : @(context.maximumDetentValue),
                                                     @"content" : @(content),
                                                     @"inWindow" : @(window != nil),
                                                     @"height" : @(height),
                                                   };
                                                 }
                                                 return height;
                                               }]];
    }
    _appliedDetents = _spec.detents;
    if (self.presentedController.presentingViewController != nil) {
      [sheet animateChanges:^{
        sheet.detents = detents;
      }];
    } else {
      sheet.detents = detents;
    }
  }
  if (!_initialDetentApplied && !_spec.detents.empty()) {
    sheet.selectedDetentIdentifier = [self detentIdentifierAtIndex:_spec.initialDetent];
    _initialDetentApplied = YES;
  }
  sheet.prefersGrabberVisible = _spec.grabber != 0;
  sheet.prefersScrollingExpandsWhenScrolledToEdge = YES;
  // Without a backdrop every detent is undimmed and the screen behind stays interactive.
  sheet.largestUndimmedDetentIdentifier =
      _spec.noBackdrop != 0 && !_spec.detents.empty() ? [self detentIdentifierAtIndex:(NSInteger)_spec.detents.size() - 1] : nil;
}

- (void)presentationControllerDidDismiss:(UIPresentationController *)presentationController {
  [self presentationDidEndByUser];
}

// VoiceOver's escape (a two finger scrub) dismisses the sheet or modal on top as a swipe down would, and pops a pushed screen
// as the back button does: JavaScript hears `topDismissed`, not a removal it asked for. A presentation that forbids the swipe
// (`gestureEnabled` false, a sheet with `dismissible` false) forbids this too; so does `nativeBackButtonDismissalEnabled` false.
- (BOOL)accessibilityPerformEscape {
  if (_spec.presentation == svelte::kPush) return !_unmounted && !_userDismissed && [_stack popByEscape:self];
  UIViewController *presented = self.presentedController;
  if (_unmounted || _userDismissed || presented.presentingViewController == nil ||
      presented.presentedViewController != nil || presented.isModalInPresentation) {
    return NO;
  }
  __weak SvelteScreenView *weakSelf = self;
  [presented dismissViewControllerAnimated:YES
                                completion:^{
                                  SvelteScreenView *screen = weakSelf;
                                  if (screen != nil && !screen->_unmounted) [screen presentationDidEndByUser];
                                }];
  return YES;
}

- (void)presentationDidEndByUser {
  _userDismissed = YES;
  [_stack modalWasDismissedByUser:self];
}

- (NSDictionary *)qaDetents {
  return [_qaDetents copy] ?: @{};
}

- (void)emitDismissedWithCount:(NSInteger)count {
  SvelteEmit(_eventEmitter, "dismissed", folly::dynamic::object("dismissCount", (int)count));
}

- (void)emitExited {
  if (_exitReported) return;
  _exitReported = YES;
  __weak SvelteScreenView *weakSelf = self;
  SvelteScheduleLifecycle(SvelteLifecycleExited, ^{
    SvelteScreenView *screen = weakSelf;
    if (screen != nil) SvelteEmit(screen->_eventEmitter, "exited", folly::dynamic::object());
  });
}

- (void)reportBarMetrics {
  [_header reportMetrics];
  [_toolbar reportMetrics];
}

- (void)sheetPresentationControllerDidChangeSelectedDetentIdentifier:(UISheetPresentationController *)sheetPresentationController {
  const NSInteger index = sheetPresentationController.selectedDetentIdentifier.integerValue;
  if (index < 0 || index >= (NSInteger)_spec.detents.size()) return;
  double fraction = _spec.detents[(size_t)index];
  if (fraction < 0) {
    // The measured fraction of an `auto` detent: its content over the space below the top inset.
    UIWindow *window = self.window;
    const double available = window != nil ? window.bounds.size.height - window.safeAreaInsets.top : 0;
    fraction = available > 0 ? MIN(1.0, _layoutMetrics.frame.size.height / available) : 1.0;
  }
  SvelteEmit(_eventEmitter, "detentChange", folly::dynamic::object("index", (int)index)("fraction", fraction));
}

#pragma mark - Navigation bar

- (void)navigationController:(UINavigationController *)navigationController
      willShowViewController:(UIViewController *)viewController
                    animated:(BOOL)animated {
  [self applyBarConfigurationTo:navigationController animated:animated];
}

- (BOOL)changesBarVisibilityOf:(UINavigationController *)navigation {
  return navigation.isNavigationBarHidden != (_header == nil);
}

- (void)applyBarConfigurationTo:(UINavigationController *)navigation animated:(BOOL)animated {
  [self applyToolbarTo:navigation animated:animated];
  SvelteHeaderView *header = _header;
  // UIKit does the work of a change (the bar's items laid out again and re-attached) even when asked for the state it is in.
  const BOOL hide = header == nil;
  if (navigation.isNavigationBarHidden != hide) [navigation setNavigationBarHidden:hide animated:animated];
  if (header == nil) return;
  navigation.navigationBar.tintColor = SvelteColor([header spec].tint);
  // The back button shows the title of the screen below, unless this screen names it.
  const NSUInteger index = [navigation.viewControllers indexOfObject:_controller];
  if (index != NSNotFound && index > 0) {
    navigation.viewControllers[index - 1].navigationItem.backButtonTitle = SvelteString([header spec].backTitle);
  }
}

// The navigation controller's toolbar is one for the whole stack: it is shown while the screen on top declares one (and does not hide
// it), with the push or the pop when called from `willShowViewController`, and hidden otherwise. The screen's items are its own
// (`toolbarItems`, which UIKit swaps in with the transition).
- (void)applyToolbarTo:(UINavigationController *)navigation animated:(BOOL)animated {
  SvelteToolbarView *toolbar = _toolbar;
  const BOOL shown = toolbar != nil && ![toolbar spec].hidden;
  if (shown) {
    // `UINavigationController.toolbar` creates the bar when it is first read: only a screen that has a toolbar does.
    UIToolbar *bar = navigation.toolbar;
    [toolbar applyAppearanceTo:bar];
    if (bar.semanticContentAttribute != self.semanticContentAttribute) bar.semanticContentAttribute = self.semanticContentAttribute;
  }
  if (navigation.isToolbarHidden == shown) [navigation setToolbarHidden:!shown animated:animated];
}

- (void)update {
  const BOOL full = _needsUpdate;
  _needsUpdate = NO;
  _needsToolbarUpdate = NO;
  if (_controller == nil) return;
  SvelteToolbarView *toolbar = _toolbar;
  if (toolbar != nil) [toolbar applyToController:_controller];
  else [SvelteToolbarView clearController:_controller];
  UINavigationController *navigation = _controller.navigationController;
  const BOOL top = navigation != nil && navigation.topViewController == _controller;
  if (!full) {
    // The toolbar alone: the header is not touched. A visible screen shows or hides its toolbar with UIKit's animation.
    if (top) [self applyToolbarTo:navigation animated:_visible];
    [toolbar reportMetrics];
    [self applyToolbarInset];
    return;
  }
  SvelteHeaderView *header = _header;
  if (header != nil) [header applyToController:_controller];
  else [SvelteHeaderView clearController:_controller];
  if (top) [self applyBarConfigurationTo:navigation animated:NO];
  [self configureScrollView];
  [self applyDismissalPolicy];
  [self applySheetConfiguration];
  [_controller setNeedsStatusBarAppearanceUpdate];
  [header reportMetrics];
  [toolbar reportMetrics];
}

static RCTScrollViewComponentView *_Nullable FirstScrollView(UIView *view) {
  for (UIView *child in view.subviews) {
    if ([child isKindOfClass:[RCTScrollViewComponentView class]]) return (RCTScrollViewComponentView *)child;
    RCTScrollViewComponentView *nested = FirstScrollView(child);
    if (nested != nil) return nested;
  }
  return nil;
}

static void SvelteSetBottomInset(UIScrollView *scroll, CGFloat content, CGFloat indicator) {
  UIEdgeInsets inset = scroll.contentInset;
  if (std::fabs(inset.bottom - content) >= 0.01) {
    inset.bottom = content;
    scroll.contentInset = inset;
  }
  UIEdgeInsets indicators = scroll.verticalScrollIndicatorInsets;
  if (std::fabs(indicators.bottom - indicator) >= 0.01) {
    indicators.bottom = indicator;
    scroll.verticalScrollIndicatorInsets = indicators;
  }
}

// Under a large or translucent header the first scroll view runs under the bar: UIKit insets it by the bar's current
// height and collapses the large title as it scrolls. JavaScript does not pad it at the top (SPEC.md, "Layout rules").
- (void)configureScrollView {
  SvelteHeaderView *header = _header;
  const BOOL underBar = header != nil && ([header spec].large || [header spec].translucent);
  RCTScrollViewComponentView *scroll = underBar ? FirstScrollView(_parkedContent ?: self) : nil;
  RCTScrollViewComponentView *adjusted = _adjustedScroll;
  if (scroll != adjusted) {
    if (adjusted != nil) {
      adjusted.scrollView.contentInsetAdjustmentBehavior = UIScrollViewContentInsetAdjustmentNever;
      if (_toolbarInset > 0) SvelteSetBottomInset(adjusted.scrollView, 0, 0);
    }
    _toolbarInset = 0;
    [_controller setContentScrollView:scroll.scrollView forEdge:NSDirectionalRectEdgeTop];
    if (scroll != nil) scroll.scrollView.contentInsetAdjustmentBehavior = UIScrollViewContentInsetAdjustmentAutomatic;
    _adjustedScroll = scroll;
  }
  [self applyToolbarInset];
}

// A translucent toolbar overlays the bottom of the content, and `Automatic` also adds its height there (the navigation controller
// puts the bar in the safe area), while JavaScript pads the content by `useToolbar().height` as well. The bottom is JavaScript's:
// the content inset takes the bar's reported height off again, so the adjusted bottom inset is 0, and the scroll indicator stops
// above the bar. An opaque toolbar is in flow below the content in Yoga, so the scroll view never reaches it and needs nothing.
// The inset goes with the toolbar (hidden, removed, no longer translucent) and follows the reported height.
- (void)applyToolbarInset {
  RCTScrollViewComponentView *scroll = _adjustedScroll;
  if (scroll == nil) {
    _toolbarInset = 0;
    return;
  }
  SvelteToolbarView *toolbar = _toolbar;
  const BOOL under = toolbar != nil && [toolbar spec].translucent && ![toolbar spec].hidden;
  const CGFloat height = under ? [toolbar reportedHeight] : 0;
  if (height == 0 && _toolbarInset == 0) return;
  SvelteSetBottomInset(scroll.scrollView, -height, height);
  _toolbarInset = height;
}

- (void)toolbarMetricsDidChange {
  [self applyToolbarInset];
}

#pragma mark - Status bar

- (UIStatusBarStyle)statusBarStyle {
  if (!_spec.hasBars) return UIStatusBarStyleDefault;
  if (_spec.statusStyle == svelte::kBarLight) return UIStatusBarStyleLightContent;
  if (_spec.statusStyle == svelte::kBarDark) return UIStatusBarStyleDarkContent;
  return UIStatusBarStyleDefault;
}

- (BOOL)statusBarHidden {
  return _spec.hasBars && _spec.statusHidden != 0;
}

#pragma mark - Controller callbacks

// UIKit also calls `viewDidAppear` after a cancelled back swipe and `viewDidDisappear` for the screen below it: only a change of
// visibility is an event.
- (void)controllerDidAppear {
  [_header reportMetrics];
  if (_visible) return;
  _visible = YES;
  __weak SvelteScreenView *weakSelf = self;
  SvelteScheduleLifecycle(SvelteLifecycleAppear, ^{
    SvelteScreenView *screen = weakSelf;
    if (screen != nil) SvelteEmit(screen->_eventEmitter, "appear", folly::dynamic::object());
  });
}

- (void)controllerDidDisappear {
  if (_visible) {
    _visible = NO;
    __weak SvelteScreenView *weakSelf = self;
    SvelteScheduleLifecycle(SvelteLifecycleDisappear, ^{
      SvelteScreenView *screen = weakSelf;
      if (screen != nil) SvelteEmit(screen->_eventEmitter, "disappear", folly::dynamic::object());
    });
  }
  // A pushed screen that UIKit took out of the stack on its own (a back swipe or the back button): the user dismissed it.
  if (!_unmounted && _spec.presentation == svelte::kPush && _controller.parentViewController == nil && _controller.presentingViewController == nil) {
    [_stack screenWasRemovedByUIKit:self];
  }
}

// A presented screen (a modal, a sheet) is sized by UIKit, which may differ from what Yoga computed: tell the shadow tree.
- (void)controllerDidLayout {
  if (_unmounted || _state == nullptr || _spec.presentation == svelte::kPush) return;
  if (std::find(_spec.detents.begin(), _spec.detents.end(), -1.0) != _spec.detents.end()) return;  // `auto`: Yoga measures the content
  const CGSize size = self.bounds.size;
  if (size.width < 1 || size.height < 1 || CGSizeEqualToSize(size, _reportedSize)) return;
  _reportedSize = size;
  _state->updateState(svelte::SvelteScreenState{RCTSizeFromCGSize(size)}, EventQueue::UpdateMode::unstable_Immediate);
}

- (void)didMoveToWindow {
  [super didMoveToWindow];
  // A presented screen lives outside the surface's root view: React Native's touch handler is attached to it, and not to a screen
  // that is below the root (a pushed one, or a modal presented over the current context), where the root's handler already listens.
  UIViewController *presented = _wrapper != nil ? (UIViewController *)_wrapper : (UIViewController *)_controller;
  if (self.window != nil && presented.presentingViewController != nil && !SvelteIsUnderSurfaceRoot(presented.view)) {
    if (_touch == nil) _touch = [SvelteTouchHost new];
    [_touch attachToView:presented.view offset:CGPointMake(_layoutMetrics.frame.origin.x, _layoutMetrics.frame.origin.y)];
  } else {
    [_touch detach];
    // The handlers of a gesture library that attached to this screen's views before UIKit gave the screen its place found no touch handler above them.
    if (self.window != nil) SvelteEnsureGestureRoot(self);
  }
}

#pragma mark - Removal

// UIKit ends a push by taking the covered screen's view out of the hierarchy and putting the new screen's view back where it belongs, and
// each of the two walks every view below it (traits, window, layout engine): for a 60-row screen of 180 views that is 17 ms on the
// iPhone SE 3 in one turn of the run loop, which holds the next frame back by 26 to 28 ms (a Time Profiler run of navigation-8: the
// end of every push, never the pop, whose leaving screen is a picture already). The stack covers the screen a few frames into the push,
// when nothing else is due: its content moves to a view in no window (the walk that costs is then ours, in a quiet frame, and UIKit's
// takes out a view with a picture in it) and a picture of what was drawn takes its place. The content comes back, still in no window and
// so for the price of moving its direct children, before UIKit shows the screen again (`uncover`: the stack's staging of a pop, the
// controller's `viewWillAppear` for a back swipe, any update of the stack that makes the screen its top).
- (void)coverWithPicture {
  if (_parkedContent != nil || _unmounted || self.window == nil || _controller == nil || _controller.view != self) return;
  UIView *picture = [self snapshotViewAfterScreenUpdates:NO];
  if (picture == nil) return;
  UIView *parked = [[UIView alloc] initWithFrame:self.bounds];
  for (UIView *child in [self.subviews copy]) [parked addSubview:child];
  _parkedContent = parked;
  picture.frame = self.bounds;
  _coverPicture = picture;
  [self addSubview:picture];
}

- (void)uncover {
  UIView *parked = _parkedContent;
  if (parked == nil) return;
  _parkedContent = nil;
  [_coverPicture removeFromSuperview];
  _coverPicture = nil;
  for (UIView *child in [parked.subviews copy]) [self addSubview:child];
}

- (void)replaceViewWithSnapshot {
  if (self.window == nil || _controller == nil || _controller.view != self) return;
  UIView *snapshot = [self snapshotViewAfterScreenUpdates:NO];
  if (snapshot == nil) return;
  snapshot.frame = self.frame;
  UIView *parent = self.superview;
  [self removeFromSuperview];
  _controller.view = snapshot;
  [parent addSubview:snapshot];
}

@end
