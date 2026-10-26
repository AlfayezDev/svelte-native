#import "SvelteHeaderView.h"

#import <cmath>

#import <React/RCTComponentViewFactory.h>
#import <React/RCTConversions.h>
#import <react/renderer/componentregistry/ComponentDescriptorProvider.h>
#import <react/renderer/components/view/ViewProps.h>

#import "SvelteComponents.h"
#import "SvelteScreenView.h"
#import "SvelteSupport.h"

using namespace facebook::react;

/// iOS 26 has a subtitle in the navigation item; before it the header builds a two line title view.
static BOOL SvelteHasNativeSubtitle(void) {
#if SVELTE_IOS26_SDK
  if (@available(iOS 26.0, *)) return YES;
#endif
  return NO;
}

/// The controller UIKit shows while the search is active: it hosts the search slot's view and gives it the whole area.
@interface SvelteResultsController : UIViewController
@property (nonatomic, weak, nullable) SvelteHeaderSlotView *slot;
@end

@implementation SvelteResultsController {
  SvelteTouchHost *_touch;
}

- (void)viewDidLayoutSubviews {
  [super viewDidLayoutSubviews];
  self.slot.frame = self.view.bounds;
}

// UIKit may show the results outside the surface's root view, where React Native's touch handler does not listen.
- (void)viewDidAppear:(BOOL)animated {
  [super viewDidAppear:animated];
  if (SvelteIsUnderSurfaceRoot(self.view)) return;
  if (_touch == nil) _touch = [SvelteTouchHost new];
  [_touch attachToView:self.view offset:[self.slot yogaOrigin]];
}

- (void)viewDidDisappear:(BOOL)animated {
  [super viewDidDisappear:animated];
  [_touch detach];
}

@end

@implementation SvelteHeaderView {
  svelte::HeaderSpec _spec;
  std::string _nativeId;
  BOOL _parsed;
  __weak SvelteHeaderSlotView *_left;
  __weak SvelteHeaderSlotView *_center;
  __weak SvelteHeaderSlotView *_right;
  __weak SvelteHeaderSlotView *_search;
  UISearchController *_searchController;
  SvelteResultsController *_resultsController;
  UIStackView *_titleView;
  UILabel *_titleLabel;
  UILabel *_subtitleLabel;
  NSInteger _nativeEventCount;
  BOOL _reported;
  BOOL _wasLarge;
  CGFloat _lastHeight;
  CGFloat _lastInset;
  CGFloat _tallest;
  CGSize _lastContainer;
}

+ (ComponentDescriptorProvider)componentDescriptorProvider {
  return concreteComponentDescriptorProvider<svelte::SvelteHeaderComponentDescriptor>();
}

+ (BOOL)shouldBeRecycled {
  return NO;
}

+ (void)load {
  [[RCTComponentViewFactory currentComponentViewFactory] registerComponentViewClass:self];
}

- (const svelte::HeaderSpec &)spec {
  return _spec;
}

- (void)updateProps:(const Props::Shared &)props oldProps:(const Props::Shared &)oldProps {
  [super updateProps:props oldProps:oldProps];
  const auto &viewProps = static_cast<const ViewProps &>(*props);
  if (_parsed && viewProps.nativeId == _nativeId) return;
  _nativeId = viewProps.nativeId;
  _parsed = YES;
  _spec = svelte::parseHeader(_nativeId);
  [_screen setNeedsUpdate];
}

// The slots are the bar's: they are never subviews of the header.
- (void)mountChildComponentView:(UIView<RCTComponentViewProtocol> *)childComponentView index:(NSInteger)index {
  if (![childComponentView isKindOfClass:[SvelteHeaderSlotView class]]) {
    [super mountChildComponentView:childComponentView index:index];
    return;
  }
  SvelteHeaderSlotView *slot = (SvelteHeaderSlotView *)childComponentView;
  slot.header = self;
  switch ([slot spec].slot) {
    case svelte::kSlotLeft: _left = slot; break;
    case svelte::kSlotCenter: _center = slot; break;
    case svelte::kSlotRight: _right = slot; break;
    case svelte::kSlotSearch: _search = slot; break;
  }
  [_screen setNeedsUpdate];
}

- (void)unmountChildComponentView:(UIView<RCTComponentViewProtocol> *)childComponentView index:(NSInteger)index {
  if (![childComponentView isKindOfClass:[SvelteHeaderSlotView class]]) {
    [super unmountChildComponentView:childComponentView index:index];
    return;
  }
  SvelteHeaderSlotView *slot = (SvelteHeaderSlotView *)childComponentView;
  slot.header = nil;
  [slot removeFromSuperview];
  if (_left == slot) _left = nil;
  if (_center == slot) _center = nil;
  if (_right == slot) _right = nil;
  if (_search == slot) _search = nil;
  [_screen setNeedsUpdate];
}

// A slot's size needs nothing here (the bar asks its container); its search props and its content do.
- (void)slotDidChange:(SvelteHeaderSlotView *)slot {
  if (slot != _search || _searchController == nil) return;
  _searchController.showsSearchResultsController = slot.contentCount > 0;
  [self applySearchState];
}

#pragma mark - Navigation item

+ (void)clearController:(UIViewController *)controller {
  UINavigationItem *item = controller.navigationItem;
  item.title = nil;
  item.titleView = nil;
  item.leftBarButtonItems = nil;
  item.rightBarButtonItems = nil;
  item.searchController = nil;
  item.standardAppearance = nil;
  item.scrollEdgeAppearance = nil;
  item.compactAppearance = nil;
  item.hidesBackButton = NO;
  item.largeTitleDisplayMode = UINavigationItemLargeTitleDisplayModeNever;
}

- (UINavigationBarAppearance *)appearanceWithTransparentBackground:(BOOL)transparent {
  UINavigationBarAppearance *appearance = [UINavigationBarAppearance new];
  UIColor *background = SvelteColor(_spec.background);
  if (transparent) [appearance configureWithTransparentBackground];
  else if (background != nil) [appearance configureWithOpaqueBackground];
  else [appearance configureWithDefaultBackground];
  if (background != nil && !transparent) appearance.backgroundColor = background;
  if (_spec.hideShadow || transparent) {
    appearance.shadowColor = nil;
    appearance.shadowImage = nil;
  }
  UIColor *tint = SvelteColor(_spec.tint);
  if (tint != nil) {
    appearance.titleTextAttributes = @{NSForegroundColorAttributeName : tint};
    appearance.largeTitleTextAttributes = @{NSForegroundColorAttributeName : tint};
  }
  return appearance;
}

// Before iOS 26 a subtitle is a second line in the title view.
- (UIView *)titleViewWithTitle:(NSString *)title subtitle:(NSString *)subtitle {
  if (_titleView == nil) {
    _titleLabel = [UILabel new];
    _titleLabel.font = [UIFont preferredFontForTextStyle:UIFontTextStyleHeadline];
    _titleLabel.adjustsFontForContentSizeCategory = YES;
    _titleLabel.textAlignment = NSTextAlignmentCenter;
    _subtitleLabel = [UILabel new];
    _subtitleLabel.font = [UIFont preferredFontForTextStyle:UIFontTextStyleCaption1];
    _subtitleLabel.adjustsFontForContentSizeCategory = YES;
    _subtitleLabel.textColor = [UIColor secondaryLabelColor];
    _subtitleLabel.textAlignment = NSTextAlignmentCenter;
    _titleView = [[UIStackView alloc] initWithArrangedSubviews:@[ _titleLabel, _subtitleLabel ]];
    _titleView.axis = UILayoutConstraintAxisVertical;
    _titleView.alignment = UIStackViewAlignmentCenter;
    _titleView.translatesAutoresizingMaskIntoConstraints = NO;
  }
  _titleLabel.text = title;
  _titleLabel.textColor = SvelteColor(_spec.tint) ?: [UIColor labelColor];
  _subtitleLabel.text = subtitle;
  return _titleView;
}

- (void)applyToController:(UIViewController *)controller {
  UINavigationItem *item = controller.navigationItem;
  if (_wasLarge != _spec.large) {
    // JavaScript uses a measurement only for the state it was taken in.
    _wasLarge = _spec.large;
    _reported = NO;
    _tallest = 0;
  }
  NSString *title = SvelteString(_spec.title);
  NSString *subtitle = SvelteString(_spec.subtitle);
  item.title = title;
  SvelteHeaderSlotView *center = _center;
  if (center != nil) {
    [center.barView addSubview:center];
    item.titleView = center.barView;
  } else if (subtitle.length > 0 && !SvelteHasNativeSubtitle()) {
    item.titleView = [self titleViewWithTitle:title ?: @"" subtitle:subtitle];
  } else {
    item.titleView = nil;
  }
#if SVELTE_IOS26_SDK
  if (@available(iOS 26.0, *)) item.subtitle = center != nil ? nil : subtitle;
#endif
  item.hidesBackButton = !_spec.back;
  item.largeTitleDisplayMode = _spec.large ? UINavigationItemLargeTitleDisplayModeAlways : UINavigationItemLargeTitleDisplayModeNever;
  item.leftItemsSupplementBackButton = NO;
  item.leftBarButtonItems = [self barItemsOf:_left];
  item.rightBarButtonItems = [self barItemsOf:_right];

  UINavigationBarAppearance *standard = [self appearanceWithTransparentBackground:NO];
  item.standardAppearance = standard;
  item.compactAppearance = standard;
  // A translucent header lets the content run under it: transparent while the content is at its top edge.
  item.scrollEdgeAppearance = _spec.translucent ? [self appearanceWithTransparentBackground:YES] : standard;

  [self applySearchTo:item controller:controller];
}

- (NSArray<UIBarButtonItem *> *)barItemsOf:(SvelteHeaderSlotView *)slot {
  if (slot == nil) return nil;
  [slot.barView addSubview:slot];
  return @[ slot.barItem ];
}

#pragma mark - Search

- (void)applySearchTo:(UINavigationItem *)item controller:(UIViewController *)controller {
  SvelteHeaderSlotView *search = _search;
  if (search == nil) {
    item.searchController = nil;
    return;
  }
  if (_searchController == nil) {
    _resultsController = [SvelteResultsController new];
    _searchController = [[UISearchController alloc] initWithSearchResultsController:_resultsController];
    _searchController.searchResultsUpdater = self;
    _searchController.delegate = self;
    _searchController.searchBar.delegate = self;
    _searchController.obscuresBackgroundDuringPresentation = NO;
  }
  // The results are presented over the screen that owns the search field, not over the whole window.
  controller.definesPresentationContext = YES;
  _resultsController.slot = search;
  if (search.superview != _resultsController.view) [_resultsController.view addSubview:search];
  // Without content the results controller would only hide the screen.
  _searchController.showsSearchResultsController = search.contentCount > 0;
  item.searchController = _searchController;
  item.hidesSearchBarWhenScrolling = NO;
  [self applySearchState];
}

// The field is the user's: a value from JavaScript applies only when it has seen the user's latest edit.
- (void)applySearchState {
  SvelteHeaderSlotView *search = _search;
  if (search == nil || _searchController == nil) return;
  const svelte::SlotSpec &spec = [search spec];
  UISearchBar *bar = _searchController.searchBar;
  bar.placeholder = SvelteString(spec.placeholder);
  if (spec.value && spec.eventCount >= _nativeEventCount) {
    NSString *value = SvelteString(spec.value);
    if (![bar.text ?: @"" isEqualToString:value]) bar.text = value;
  }
}

- (void)searchBar:(UISearchBar *)searchBar textDidChange:(NSString *)searchText {
  _nativeEventCount += 1;
  [_search emit:"change" payload:folly::dynamic::object("text", std::string(searchText.UTF8String ?: ""))("eventCount", (int)_nativeEventCount)];
}

- (void)searchBarSearchButtonClicked:(UISearchBar *)searchBar {
  [_search emit:"submitEditing" payload:folly::dynamic::object("text", std::string(searchBar.text.UTF8String ?: ""))];
}

- (void)didDismissSearchController:(UISearchController *)searchController {
  [_search emit:"cancel" payload:folly::dynamic::object()];
}

// The text arrives through the search bar's delegate, with the count JavaScript needs.
- (void)updateSearchResultsForSearchController:(UISearchController *)searchController {
}

#pragma mark - Metrics

- (void)reportMetrics {
  UIViewController *controller = _screen.controller;
  UINavigationController *navigation = controller.navigationController;
  if (navigation == nil || navigation.navigationBarHidden || navigation.topViewController != controller) return;
  const CGFloat bottom = CGRectGetMaxY(navigation.navigationBar.frame);
  if (bottom <= 0) return;
  const CGSize container = navigation.view.bounds.size;
  if (!CGSizeEqualToSize(container, _lastContainer)) {
    // Rotation or a new window size: the large title's expanded height is measured again.
    _lastContainer = container;
    _tallest = 0;
  }
  // A large title shrinks while the content scrolls: JavaScript always gets the expanded height.
  _tallest = MAX(_tallest, bottom);
  const CGFloat height = _spec.large ? _tallest : bottom;
  const CGFloat inset = navigation.view.safeAreaInsets.top;
  if (_reported && fabs(height - _lastHeight) < 0.5 && fabs(inset - _lastInset) < 0.5) return;
  _reported = YES;
  _lastHeight = height;
  _lastInset = inset;
  SvelteEmit(_eventEmitter, "metrics", folly::dynamic::object("height", (double)height)("inset", (double)inset));
}

- (void)invalidate {
  _searchController.searchBar.delegate = nil;
  _searchController.delegate = nil;
  _searchController.searchResultsUpdater = nil;
}

@end

@implementation SvelteHeaderSlotView {
  svelte::SlotSpec _spec;
  std::string _nativeId;
  BOOL _parsed;
  SvelteBarContainer *_barView;
  UIBarButtonItem *_barItem;
  NSUInteger _contentCount;
}

+ (ComponentDescriptorProvider)componentDescriptorProvider {
  return concreteComponentDescriptorProvider<svelte::SvelteHeaderSlotComponentDescriptor>();
}

+ (BOOL)shouldBeRecycled {
  return NO;
}

+ (void)load {
  [[RCTComponentViewFactory currentComponentViewFactory] registerComponentViewClass:self];
}

- (const svelte::SlotSpec &)spec {
  return _spec;
}

- (NSUInteger)contentCount {
  return _contentCount;
}

- (SvelteBarContainer *)barView {
  if (_barView == nil) {
    _barView = [SvelteBarContainer new];
    // The bar sizes a custom view with Auto Layout: the intrinsic size is what Yoga computed.
    _barView.translatesAutoresizingMaskIntoConstraints = NO;
  }
  return _barView;
}

- (UIBarButtonItem *)barItem {
  if (_barItem == nil) _barItem = [[UIBarButtonItem alloc] initWithCustomView:self.barView];
  return _barItem;
}

- (void)emit:(const char *)type payload:(folly::dynamic)payload {
  SvelteEmit(_eventEmitter, type, std::move(payload));
}

- (CGPoint)yogaOrigin {
  return CGPointMake(_layoutMetrics.frame.origin.x, _layoutMetrics.frame.origin.y);
}

- (void)updateProps:(const Props::Shared &)props oldProps:(const Props::Shared &)oldProps {
  [super updateProps:props oldProps:oldProps];
  const auto &viewProps = static_cast<const ViewProps &>(*props);
  if (_parsed && viewProps.nativeId == _nativeId) return;
  _nativeId = viewProps.nativeId;
  _parsed = YES;
  _spec = svelte::parseSlot(_nativeId);
  [_header slotDidChange:self];
}

- (void)mountChildComponentView:(UIView<RCTComponentViewProtocol> *)childComponentView index:(NSInteger)index {
  [super mountChildComponentView:childComponentView index:index];
  _contentCount += 1;
  [_header slotDidChange:self];
}

- (void)unmountChildComponentView:(UIView<RCTComponentViewProtocol> *)childComponentView index:(NSInteger)index {
  [super unmountChildComponentView:childComponentView index:index];
  if (_contentCount > 0) _contentCount -= 1;
  [_header slotDidChange:self];
}

// Only the size is Yoga's: the bar puts the slot where it belongs (the search results fill their controller).
#pragma clang diagnostic push
#pragma clang diagnostic ignored "-Wobjc-missing-super-calls"
- (void)updateLayoutMetrics:(const LayoutMetrics &)layoutMetrics oldLayoutMetrics:(const LayoutMetrics &)oldLayoutMetrics {
  _layoutMetrics = layoutMetrics;
  if (_spec.slot == svelte::kSlotSearch) return;
  const CGSize size = RCTCGSizeFromSize(layoutMetrics.frame.size);
  if (!std::isfinite(size.width) || !std::isfinite(size.height)) return;
  self.bounds = CGRectMake(0, 0, size.width, size.height);
  self.center = CGPointMake(size.width / 2, size.height / 2);
  const UISemanticContentAttribute direction = layoutMetrics.layoutDirection == LayoutDirection::RightToLeft
      ? UISemanticContentAttributeForceRightToLeft
      : UISemanticContentAttributeForceLeftToRight;
  self.semanticContentAttribute = direction;
  self.barView.semanticContentAttribute = direction;
  self.barView.contentSize = size;
  [_header slotDidChange:self];
}
#pragma clang diagnostic pop

- (void)invalidate {
  [_barView removeFromSuperview];
  _header = nil;
}

@end
