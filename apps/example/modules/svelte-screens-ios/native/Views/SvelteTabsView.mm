#import "SvelteTabsView.h"

#import <React/RCTComponentViewFactory.h>
#import <React/RCTLog.h>
#import <react/renderer/componentregistry/ComponentDescriptorProvider.h>
#import <react/renderer/components/view/ViewProps.h>

#import "SvelteComponents.h"
#import "SvelteSupport.h"

using namespace facebook::react;

/// Hosts one tab's pane in the tabs view: the whole tabs area, so that Yoga's frames (relative to the tabs view) hold, and
/// transparent to touches that hit none of its subviews, so that the bar under it still gets them.
@implementation SvelteTabPane

- (UIView *_Nullable)hitTest:(CGPoint)point withEvent:(UIEvent *_Nullable)event {
  UIView *hit = [super hitTest:point withEvent:event];
  return hit == self ? nil : hit;
}

@end

@implementation SvelteTabView {
  svelte::TabSpec _spec;
  std::string _nativeId;
  BOOL _parsed;
  UIViewController *_controller;
  SvelteTabPane *_pane;
  /// Holds the `native-tab-icon` view while it waits to be drawn: laid out, never visible.
  UIView *_iconHolder;
  __weak RCTViewComponentView *_iconView;
  /// The icon's index among the tab's children in the shadow tree (`NSNotFound` without one): the icon lives in its holder,
  /// not among the subviews, so the content's index is one less than the tree's once the icon precedes it.
  NSInteger _iconIndex;
  /// The icon assets, once loaded, and the uris they were loaded from.
  UIImage *_image;
  UIImage *_selectedImage;
  NSString *_imageUri;
  NSString *_selectedImageUri;
  /// What the snippet icon drew when the tab was not selected and when it was.
  UIImage *_snapshot;
  UIImage *_selectedSnapshot;
  /// The snippet icon's views changed since it was last drawn (or it was never drawn).
  BOOL _iconDirty;
  /// The selection the icon was last applied with: a commit that only flips it does not redraw a state already drawn.
  BOOL _drawnSelected;
  /// What this view last assigned to the item. The item's getters do not return what was set (`image` comes back as
  /// UIKit's internal template image), so comparing against them re-assigned every property on every flush.
  BOOL _applied;
  NSString *_appliedTitle;
  NSString *_appliedBadge;
  NSString *_appliedLabel;
  UIImage *_appliedImage;
  UIImage *_appliedSelectedImage;
  BOOL _appliedEnabled;
}

+ (ComponentDescriptorProvider)componentDescriptorProvider {
  return concreteComponentDescriptorProvider<svelte::SvelteTabComponentDescriptor>();
}

+ (BOOL)shouldBeRecycled {
  return NO;
}

+ (void)load {
  [[RCTComponentViewFactory currentComponentViewFactory] registerComponentViewClass:self];
}

- (instancetype)initWithFrame:(CGRect)frame {
  if (self = [super initWithFrame:frame]) {
    _controller = [UIViewController new];
    // Nothing of the tab is in the placeholder's view: the pane lives in the tabs view (see `pane`).
    _controller.view.userInteractionEnabled = NO;
    _iconHolder = [UIView new];
    _iconHolder.hidden = YES;
    [_controller.view addSubview:_iconHolder];
    _pane = [SvelteTabPane new];
    _pane.hidden = YES;
  }
  return self;
}

- (const svelte::TabSpec &)spec {
  return _spec;
}

- (UIViewController *)controller {
  return _controller;
}

- (UIView *)pane {
  return _pane;
}

- (void)showPane:(BOOL)shown {
  if (_pane.hidden == !shown) return;
  _pane.hidden = !shown;
  SvelteQALog([NSString stringWithFormat:@"pane %@ shown=%d window=%d", SvelteString(_spec.key) ?: @"?", shown, _pane.window != nil]);
}

- (void)updateProps:(const Props::Shared &)props oldProps:(const Props::Shared &)oldProps {
  [super updateProps:props oldProps:oldProps];
  const auto &viewProps = static_cast<const ViewProps &>(*props);
  // The item's label and test id are the tab's own accessibility props.
  _controller.tabBarItem.accessibilityIdentifier = viewProps.testId.empty() ? nil : [NSString stringWithUTF8String:viewProps.testId.c_str()];
  if (_parsed && viewProps.nativeId == _nativeId) return;
  _nativeId = viewProps.nativeId;
  _parsed = YES;
  _spec = svelte::parseTab(_nativeId);
  [_tabs setNeedsFlush];
}

static BOOL IsIcon(UIView *view) {
  return [view isKindOfClass:[RCTViewComponentView class]] && [((RCTViewComponentView *)view).nativeId isEqualToString:@"svelte:tab-icon"];
}

// The tree's index of a content child, as a subview index: the icon is not a subview (it sits in its holder), so what
// follows it is one place earlier. React Native checks the index against the subviews when it unmounts, and the check's
// own message indexed past the end when they disagreed (an NSRangeException at the end of every tabs scenario).
- (NSInteger)subviewIndexFor:(NSInteger)index {
  return _iconView != nil && _iconIndex != NSNotFound && _iconIndex < index ? index - 1 : index;
}

- (void)mountChildComponentView:(UIView<RCTComponentViewProtocol> *)childComponentView index:(NSInteger)index {
  if (IsIcon(childComponentView)) {
    _iconView = (RCTViewComponentView *)childComponentView;
    _iconIndex = index;
    [_iconHolder addSubview:childComponentView];
    _iconDirty = YES;
    [_tabs setNeedsFlush];
    return;
  }
  [super mountChildComponentView:childComponentView index:[self subviewIndexFor:index]];
}

- (void)unmountChildComponentView:(UIView<RCTComponentViewProtocol> *)childComponentView index:(NSInteger)index {
  if (IsIcon(childComponentView)) {
    [childComponentView removeFromSuperview];
    _iconView = nil;
    _iconIndex = NSNotFound;
    [_tabs setNeedsFlush];
    return;
  }
  [super unmountChildComponentView:childComponentView index:[self subviewIndexFor:index]];
}

static void CollectTags(UIView *view, std::unordered_set<Tag> &tags) {
  tags.insert((Tag)view.tag);
  for (UIView *child in view.subviews) CollectTags(child, tags);
}

- (BOOL)transactionTouchesIcon:(const MountingTransaction &)transaction {
  RCTViewComponentView *icon = _iconView;
  if (!_spec.iconIsView || icon == nil) return NO;
  std::unordered_set<Tag> tags;
  CollectTags(icon, tags);
  for (const auto &mutation : transaction.getMutations()) {
    if (tags.count(mutation.parentTag) != 0 || tags.count(mutation.newChildShadowView.tag) != 0 || tags.count(mutation.oldChildShadowView.tag) != 0) {
      _iconDirty = YES;
      return YES;
    }
  }
  return NO;
}

// The item keeps one image per state (`image`, `selectedImage`), each drawn the first time the tab is seen in that state
// and redrawn only when the icon's views changed for another reason than the selection (the snippet gets `selected` from
// JavaScript, so every switch arrives as a commit that touches the two icons that flipped: those are not redrawn once
// their state's image exists). Every `UITabBarItem` image setter makes UIKit rebuild and lay out the bar: a flush used
// to draw every icon, PNG-encode the old and new images to compare them and assign a new image to the two tabs that
// flipped, 48 % of tabs-8's main thread on an iPhone SE 3 and one dropped interval per switch.
- (UIImage *_Nullable)drawnIconIsSelected:(BOOL)selected {
  RCTViewComponentView *icon = _iconView;
  if (!_spec.iconIsView || icon == nil) return nil;
  UIImage *known = selected ? _selectedSnapshot : _snapshot;
  const BOOL flipped = _drawnSelected != selected;
  _drawnSelected = selected;
  if (known != nil && (!_iconDirty || flipped)) {
    _iconDirty = NO;
    return known;
  }
  UIImage *drawn = SvelteSnapshotImage(icon);
  if (drawn == nil) return known;
  _iconDirty = NO;
  if (selected) _selectedSnapshot = drawn;
  else _snapshot = drawn;
  return drawn;
}

- (void)loadIconAt:(NSString *_Nullable)uri selected:(BOOL)selected {
  NSString *current = selected ? _selectedImageUri : _imageUri;
  if ((uri == nil && current == nil) || [uri isEqualToString:current]) return;
  if (selected) {
    _selectedImageUri = uri;
    _selectedImage = nil;
  } else {
    _imageUri = uri;
    _image = nil;
  }
  if (uri == nil) return;
  __weak SvelteTabView *weakSelf = self;
  SvelteLoadImage(uri, ^(UIImage *image) {
    SvelteTabView *tab = weakSelf;
    if (tab == nil || image == nil) return;
    // Only the answer for the uri that is still wanted.
    if (selected && [uri isEqualToString:tab->_selectedImageUri]) tab->_selectedImage = SvelteTemplateImage(image);
    else if (!selected && [uri isEqualToString:tab->_imageUri]) tab->_image = SvelteTemplateImage(image);
    else return;
    [tab->_tabs setNeedsFlush];
  });
}

static BOOL SvelteSameString(NSString *_Nullable a, NSString *_Nullable b) {
  return (a == nil && b == nil) || (a != nil && b != nil && [a isEqualToString:b]);
}

// Every UITabBarItem setter makes UIKit rebuild and lay out the bar's buttons, equal value or not: this ran for every tab on
// every flush and was 15 % of the main thread of tabs-8 on an iPhone SE 3. Only what changed since this view's last
// assignment is assigned (the item's own getters are not the reference: `image` reads back as UIKit's internal copy).
- (void)applyToItemWithLabels:(BOOL)labels selected:(BOOL)selected {
  UITabBarItem *item = _controller.tabBarItem;
  const BOOL first = !_applied;
  _applied = YES;
  NSString *title = SvelteString(_spec.title);
  NSString *wantedTitle = labels ? title : nil;
  if (first || !SvelteSameString(_appliedTitle, wantedTitle)) {
    item.title = wantedTitle;
    _appliedTitle = wantedTitle;
  }
  const BOOL enabled = _spec.disabled == 0;
  if (first || _appliedEnabled != enabled) {
    item.enabled = enabled;
    _appliedEnabled = enabled;
  }
  // A dot is an empty badge.
  NSString *badge = nil;
  if (_spec.badgeKind == svelte::kBadgeDot) badge = @"";
  else if (_spec.badgeKind == svelte::kBadgeText) badge = SvelteString(_spec.badgeText);
  if (first || !SvelteSameString(_appliedBadge, badge)) {
    item.badgeValue = badge;
    _appliedBadge = badge;
  }
  const auto &props = static_cast<const ViewProps &>(*_props);
  NSString *label = props.accessibilityLabel.empty() ? nil : [NSString stringWithUTF8String:props.accessibilityLabel.c_str()];
  if (label == nil) {
    NSString *announced = _spec.badgeKind == svelte::kBadgeDot ? @"new items" : _spec.badgeKind == svelte::kBadgeText ? badge : nil;
    label = announced != nil && title != nil ? [NSString stringWithFormat:@"%@, %@", title, announced] : title;
  }
  if (first || !SvelteSameString(_appliedLabel, label)) {
    item.accessibilityLabel = label;
    _appliedLabel = label;
  }

  UIImage *image;
  UIImage *selectedImage;
  if (_spec.iconIsView) {
    UIImage *drawn = [self drawnIconIsSelected:selected];
    image = _snapshot ?: _selectedSnapshot ?: drawn;
    selectedImage = _selectedSnapshot ?: _snapshot ?: drawn;
  } else {
    [self loadIconAt:SvelteString(_spec.icon) selected:NO];
    [self loadIconAt:SvelteString(_spec.selectedIcon) selected:YES];
    image = _image;
    selectedImage = _selectedImage ?: _image;
  }
  if (first || _appliedImage != image) {
    item.image = image;
    _appliedImage = image;
  }
  if (first || _appliedSelectedImage != selectedImage) {
    item.selectedImage = selectedImage;
    _appliedSelectedImage = selectedImage;
  }
}

- (void)invalidate {
  _tabs = nil;
}

@end

@implementation SvelteTabsView {
  UITabBarController *_controller;
  NSMutableArray<SvelteTabView *> *_tabs;
  svelte::TabsSpec _spec;
  std::string _nativeId;
  BOOL _parsed;
  BOOL _needsFlush;
  /// The selection last applied: JavaScript's index and select count, so that a press that JavaScript did not follow is undone.
  NSInteger _appliedSelected;
  NSInteger _appliedCount;
  BOOL _reported;
  CGFloat _lastHeight;
  CGFloat _lastInset;
  /// The bar appearance of the current spec was applied (every assignment makes UIKit rebuild the bar).
  BOOL _appearanceApplied;
}

+ (ComponentDescriptorProvider)componentDescriptorProvider {
  return concreteComponentDescriptorProvider<svelte::SvelteTabsComponentDescriptor>();
}

+ (BOOL)shouldBeRecycled {
  return NO;
}

+ (void)load {
  [[RCTComponentViewFactory currentComponentViewFactory] registerComponentViewClass:self];
}

- (instancetype)initWithFrame:(CGRect)frame {
  if (self = [super initWithFrame:frame]) {
    _tabs = [NSMutableArray new];
    _appliedSelected = -1;
    _appliedCount = -1;
    _controller = [UITabBarController new];
    _controller.delegate = self;
  }
  return self;
}

- (void)setNeedsFlush {
  _needsFlush = YES;
}

#pragma mark - Component view protocol

- (void)updateProps:(const Props::Shared &)props oldProps:(const Props::Shared &)oldProps {
  [super updateProps:props oldProps:oldProps];
  const auto &viewProps = static_cast<const ViewProps &>(*props);
  if (_parsed && viewProps.nativeId == _nativeId) return;
  _nativeId = viewProps.nativeId;
  _parsed = YES;
  _spec = svelte::parseTabs(_nativeId);
  _appearanceApplied = NO;
  _needsFlush = YES;
}

- (void)mountChildComponentView:(UIView<RCTComponentViewProtocol> *)childComponentView index:(NSInteger)index {
  if (![childComponentView isKindOfClass:[SvelteTabView class]]) {
    RCTLogError(@"SvelteTabs only accepts SvelteTab children, got %@", childComponentView);
    return;
  }
  // Every pane stays in the window, in a host of its own above the tab bar controller's view; `flush` shows the selected one.
  // The tab controllers are empty placeholders: when the pane was the selected controller's view, each switch cost UIKit's
  // controller transition (the keyboard scene's scan of the incoming hierarchy, the re-display of the pane's layers after
  // the previous one left the window), one dropped interval per switch on an iPhone SE 3.
  SvelteTabView *tab = (SvelteTabView *)childComponentView;
  [_tabs insertObject:tab atIndex:(NSUInteger)index];
  tab.tabs = self;
  UIView *pane = tab.pane;
  pane.frame = self.bounds;
  [pane addSubview:tab];
  [self addSubview:pane];
  _needsFlush = YES;
}

- (void)unmountChildComponentView:(UIView<RCTComponentViewProtocol> *)childComponentView index:(NSInteger)index {
  if (![childComponentView isKindOfClass:[SvelteTabView class]]) return;
  SvelteTabView *tab = (SvelteTabView *)childComponentView;
  [tab removeFromSuperview];
  [tab.pane removeFromSuperview];
  tab.tabs = nil;
  [_tabs removeObject:tab];
  _needsFlush = YES;
}

- (void)layoutSubviews {
  [super layoutSubviews];
  _controller.view.frame = self.bounds;
  for (SvelteTabView *tab in _tabs) tab.pane.frame = self.bounds;
  [_controller.view layoutIfNeeded];
  [self reportMetrics];
}

- (void)updateLayoutMetrics:(const LayoutMetrics &)layoutMetrics oldLayoutMetrics:(const LayoutMetrics &)oldLayoutMetrics {
  [super updateLayoutMetrics:layoutMetrics oldLayoutMetrics:oldLayoutMetrics];
  _controller.view.semanticContentAttribute = self.semanticContentAttribute;
  _controller.tabBar.semanticContentAttribute = self.semanticContentAttribute;
}

- (void)didMoveToWindow {
  [super didMoveToWindow];
  if (self.window != nil) [self flush];
}

- (void)mountingTransactionDidMount:(const MountingTransaction &)transaction withSurfaceTelemetry:(const SurfaceTelemetry &)surfaceTelemetry {
  if (_needsFlush || [self transactionChangedDrawnIcons:transaction]) [self flush];
}

// A snippet icon is redrawn once per commit that changed the views that draw it, not for every commit.
- (BOOL)transactionChangedDrawnIcons:(const MountingTransaction &)transaction {
  BOOL changed = NO;
  for (SvelteTabView *tab in _tabs) {
    if ([tab transactionTouchesIcon:transaction]) changed = YES;
  }
  return changed;
}

- (void)invalidate {
  _controller.delegate = nil;
  [_controller willMoveToParentViewController:nil];
  [_controller.view removeFromSuperview];
  [_controller removeFromParentViewController];
}

#pragma mark - UIKit state

- (void)attachControllerIfNeeded {
  if (_controller.parentViewController != nil) return;
  UIViewController *parent = SvelteNearestViewController(self);
  if (parent == nil) return;
  [parent addChildViewController:_controller];
  _controller.view.frame = self.bounds;
  // Under the panes: the bar is at the bottom of this view, below the panes' frames, and the panes let its touches through.
  [self insertSubview:_controller.view atIndex:0];
  [_controller didMoveToParentViewController:parent];
}

static void ApplyItemColors(UITabBarItemAppearance *item, UIColor *normal, UIColor *selected) {
  if (normal != nil) {
    item.normal.iconColor = normal;
    item.normal.titleTextAttributes = @{NSForegroundColorAttributeName : normal};
  }
  if (selected != nil) {
    item.selected.iconColor = selected;
    item.selected.titleTextAttributes = @{NSForegroundColorAttributeName : selected};
  }
}

- (void)applyBarAppearance {
  UITabBar *bar = _controller.tabBar;
  UIColor *tint = SvelteColor(_spec.tint);
  UIColor *inactive = SvelteColor(_spec.inactiveTint);
  UIColor *background = SvelteColor(_spec.background);
  bar.tintColor = tint;
  bar.unselectedItemTintColor = inactive;
  UITabBarAppearance *appearance = [UITabBarAppearance new];
  if (background != nil) {
    [appearance configureWithOpaqueBackground];
    appearance.backgroundColor = background;
  } else {
    [appearance configureWithDefaultBackground];
  }
  ApplyItemColors(appearance.stackedLayoutAppearance, inactive, tint);
  ApplyItemColors(appearance.inlineLayoutAppearance, inactive, tint);
  ApplyItemColors(appearance.compactInlineLayoutAppearance, inactive, tint);
  bar.standardAppearance = appearance;
  bar.scrollEdgeAppearance = appearance;
}

- (void)flush {
  _needsFlush = NO;
  if (self.window != nil) [self attachControllerIfNeeded];
  NSMutableArray<UIViewController *> *controllers = [NSMutableArray new];
  for (SvelteTabView *tab in _tabs) [controllers addObject:tab.controller];
  NSArray<UIViewController *> *shown = _controller.viewControllers ?: @[];
  if (![shown isEqualToArray:controllers]) {
    [_controller setViewControllers:controllers animated:NO];
    _appliedSelected = -1;
  }
  if (!_appearanceApplied) {
    [self applyBarAppearance];
    _appearanceApplied = YES;
  }
  const NSInteger selected = _tabs.count == 0 ? 0 : MIN(MAX((NSInteger)_spec.selected, 0), (NSInteger)_tabs.count - 1);
  for (NSUInteger index = 0; index < _tabs.count; index++) {
    const BOOL isSelected = (NSInteger)index == selected;
    [_tabs[index] applyToItemWithLabels:_spec.noLabels == 0 selected:isSelected];
    [_tabs[index] showPane:isSelected];
  }
  // JavaScript decides the selection when it or the press count changed: a press it did not follow puts the bar back.
  if (_tabs.count > 0 && (selected != _appliedSelected || _spec.selectCount != _appliedCount)) {
    _controller.selectedIndex = (NSUInteger)selected;
    _appliedSelected = selected;
    _appliedCount = _spec.selectCount;
  }
  [self reportMetrics];
}

- (void)reportMetrics {
  const CGFloat height = _controller.tabBar.frame.size.height;
  if (height <= 0 || _controller.tabBar.hidden) return;
  const CGFloat inset = _controller.view.safeAreaInsets.bottom;
  if (_reported && fabs(height - _lastHeight) < 0.5 && fabs(inset - _lastInset) < 0.5) return;
  _reported = YES;
  _lastHeight = height;
  _lastInset = inset;
  SvelteEmit(_eventEmitter, "metrics", folly::dynamic::object("height", (double)height)("inset", (double)inset));
}

#pragma mark - UITabBarControllerDelegate

- (void)tabBarController:(UITabBarController *)tabBarController didSelectViewController:(UIViewController *)viewController {
  const NSUInteger index = [tabBarController.viewControllers indexOfObject:viewController];
  if (index == NSNotFound || index >= _tabs.count) return;
  // The pane follows the bar at once; the next flush puts both back if JavaScript does not follow.
  for (NSUInteger i = 0; i < _tabs.count; i++) [_tabs[i] showPane:i == index];
  NSString *key = SvelteString([_tabs[index] spec].key) ?: @"";
  SvelteEmit(_eventEmitter, "select", folly::dynamic::object("key", std::string(key.UTF8String ?: ""))("index", (int)index));
}

@end
