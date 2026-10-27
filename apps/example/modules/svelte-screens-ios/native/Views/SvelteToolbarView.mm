#import "SvelteToolbarView.h"

#import <cmath>

#import <React/RCTComponentViewFactory.h>
#import <React/RCTConversions.h>
#import <React/RCTLog.h>
#import <react/renderer/componentregistry/ComponentDescriptorProvider.h>
#import <react/renderer/components/view/ViewProps.h>

#import "SvelteComponents.h"
#import "SvelteScreenView.h"
#import "SvelteSupport.h"

using namespace facebook::react;

/// What a toolbar item shows at least: UIKit's own bar buttons are 44 pt wide and tall. This is `TOOLBAR_METRICS.ios.item` of
/// `fabric/navigation.ts`: Yoga gives every item node that width plus 4 pt on each side and the band 16 pt edges, so the center slot's
/// Yoga width is the free span between UIKit's items (SPEC.md, "Native screens, iOS", Toolbar).
static const CGFloat kSvelteToolbarTarget = 44;
/// An image is drawn 24 pt (`SvelteTemplateImage`).
static const CGFloat kSvelteToolbarIcon = 24;

static BOOL SvelteSameString(NSString *_Nullable a, NSString *_Nullable b) {
  return (a == nil && b == nil) || (a != nil && b != nil && [a isEqualToString:b]);
}

static CGFloat SvelteRoundToPixel(CGFloat value) {
  const CGFloat scale = UIScreen.mainScreen.scale;
  return std::round(value * scale) / scale;
}

#pragma mark - The control of an item that UIKit's own button cannot be

/// The custom view of an item UIKit's `UIBarButtonItem` cannot draw: content made by JavaScript (a snippet icon), an image over a
/// title, anything with a badge (UIKit's badge on bar button items is for navigation bars only, iOS 26 documents it so). It is a
/// control, so a tap anywhere on it is the item's press; the badge is drawn as the tab bar's (a red pill, white text, a dot when empty)
/// over the top corner of the image, at the end side of it in the layout direction.
@interface SvelteToolbarButton : UIControl
/// What the control shows: an image, or the container that holds JavaScript's content (never both), and a title under it.
- (void)setIcon:(nullable UIImage *)icon title:(nullable NSString *)title host:(nullable UIView *)host;
- (void)setBadgeKind:(int)kind text:(nullable NSString *)text;
/// The size of the hosted content changed.
- (void)contentSizeDidChange;
@end

@implementation SvelteToolbarButton {
  UIImageView *_iconView;
  UILabel *_titleLabel;
  UIView *_host;
  UILabel *_badge;
  int _badgeKind;
  NSString *_badgeText;
  BOOL _hasIcon;
}

- (instancetype)initWithFrame:(CGRect)frame {
  if (self = [super initWithFrame:frame]) {
    // The bar sizes a custom view with Auto Layout: the intrinsic size below.
    self.translatesAutoresizingMaskIntoConstraints = NO;
    self.isAccessibilityElement = YES;
    self.accessibilityTraits = UIAccessibilityTraitButton;
    _iconView = [UIImageView new];
    _iconView.contentMode = UIViewContentModeCenter;
    _iconView.userInteractionEnabled = NO;
    _iconView.hidden = YES;
    _titleLabel = [UILabel new];
    _titleLabel.adjustsFontForContentSizeCategory = YES;
    _titleLabel.textAlignment = NSTextAlignmentCenter;
    _titleLabel.userInteractionEnabled = NO;
    _titleLabel.hidden = YES;
    _titleLabel.textColor = self.tintColor;
    [self addSubview:_iconView];
    [self addSubview:_titleLabel];
  }
  return self;
}

- (void)setIcon:(UIImage *)icon title:(NSString *)title host:(UIView *)host {
  BOOL changed = NO;
  if (_host != host) {
    [_host removeFromSuperview];
    _host = host;
    if (host != nil) {
      // JavaScript's content is not for touching: the control owns every tap, so that a press is the item's.
      host.userInteractionEnabled = NO;
      host.translatesAutoresizingMaskIntoConstraints = YES;
      [self insertSubview:host atIndex:0];
    }
    changed = YES;
  }
  UIImage *shown = host != nil ? nil : icon;
  if (_iconView.image != shown) {
    _iconView.image = shown;
    _iconView.hidden = shown == nil;
    changed = YES;
  }
  _hasIcon = host != nil || shown != nil;
  if (!SvelteSameString(_titleLabel.text, title)) {
    _titleLabel.text = title;
    _titleLabel.hidden = title.length == 0;
    changed = YES;
  }
  // Under an image the title is small, as on the tab bar; alone it is the size of a bar button's title.
  UIFont *font = [UIFont preferredFontForTextStyle:_hasIcon ? UIFontTextStyleCaption2 : UIFontTextStyleBody];
  if (![_titleLabel.font isEqual:font]) {
    _titleLabel.font = font;
    changed = YES;
  }
  if (changed) {
    [self invalidateIntrinsicContentSize];
    [self setNeedsLayout];
  }
}

- (void)setBadgeKind:(int)kind text:(NSString *)text {
  if (_badgeKind == kind && SvelteSameString(_badgeText, text)) return;
  _badgeKind = kind;
  _badgeText = text;
  if (kind == svelte::kBadgeNone) {
    _badge.hidden = YES;
    return;
  }
  if (_badge == nil) {
    _badge = [UILabel new];
    _badge.font = [UIFont systemFontOfSize:11 weight:UIFontWeightSemibold];
    _badge.textColor = [UIColor whiteColor];
    _badge.backgroundColor = [UIColor systemRedColor];
    _badge.textAlignment = NSTextAlignmentCenter;
    _badge.layer.masksToBounds = YES;
    _badge.userInteractionEnabled = NO;
    [self addSubview:_badge];
  }
  _badge.hidden = NO;
  _badge.text = kind == svelte::kBadgeText ? text : nil;
  [self setNeedsLayout];
}

- (void)contentSizeDidChange {
  [self invalidateIntrinsicContentSize];
  [self setNeedsLayout];
}

- (CGSize)hostedSize {
  if (_host != nil) return ((SvelteBarContainer *)_host).contentSize;
  return _iconView.hidden ? CGSizeZero : CGSizeMake(kSvelteToolbarIcon, kSvelteToolbarIcon);
}

- (CGSize)titleSize {
  if (_titleLabel.hidden) return CGSizeZero;
  const CGSize size = [_titleLabel sizeThatFits:CGSizeMake(CGFLOAT_MAX, CGFLOAT_MAX)];
  return CGSizeMake(std::ceil(size.width), std::ceil(size.height));
}

- (CGSize)intrinsicContentSize {
  const CGSize hosted = [self hostedSize];
  const CGSize title = [self titleSize];
  const CGFloat gap = hosted.height > 0 && title.height > 0 ? 1 : 0;
  return CGSizeMake(std::ceil(MAX(MAX(hosted.width, title.width), kSvelteToolbarTarget)), std::ceil(MAX(hosted.height + gap + title.height, kSvelteToolbarTarget)));
}

- (CGSize)sizeThatFits:(CGSize)size {
  return [self intrinsicContentSize];
}

- (void)layoutSubviews {
  [super layoutSubviews];
  const CGSize bounds = self.bounds.size;
  const CGSize hosted = [self hostedSize];
  const CGSize title = [self titleSize];
  const CGFloat gap = hosted.height > 0 && title.height > 0 ? 1 : 0;
  const CGFloat top = (bounds.height - (hosted.height + gap + title.height)) / 2;
  const CGRect imageFrame = CGRectMake(SvelteRoundToPixel((bounds.width - hosted.width) / 2), SvelteRoundToPixel(top), hosted.width, hosted.height);
  const CGRect titleFrame = CGRectMake(SvelteRoundToPixel((bounds.width - title.width) / 2), SvelteRoundToPixel(top + hosted.height + gap), title.width, title.height);
  if (_host != nil) _host.frame = imageFrame;
  else _iconView.frame = imageFrame;
  _titleLabel.frame = titleFrame;
  if (_badge != nil && !_badge.hidden) {
    const BOOL dot = _badgeKind == svelte::kBadgeDot;
    const CGFloat height = dot ? 8 : 16;
    const CGFloat width = dot ? 8 : MAX(height, std::ceil([_badge sizeThatFits:CGSizeMake(CGFLOAT_MAX, height)].width) + 10);
    // Over the top corner at the end of the image (of the title, when there is none).
    const CGRect anchor = _hasIcon ? imageFrame : titleFrame;
    const BOOL rtl = self.effectiveUserInterfaceLayoutDirection == UIUserInterfaceLayoutDirectionRightToLeft;
    const CGFloat x = rtl ? CGRectGetMinX(anchor) - width * 0.6 : CGRectGetMaxX(anchor) - width * 0.4;
    _badge.frame = CGRectMake(SvelteRoundToPixel(x), SvelteRoundToPixel(CGRectGetMinY(anchor) - height * 0.4), width, height);
    _badge.layer.cornerRadius = height / 2;
  }
}

// What the press looks like: UIKit's own bar buttons dim, and so do disabled ones.
- (void)updateLook {
  self.alpha = !self.enabled ? 0.4 : self.highlighted ? 0.5 : 1;
}

- (void)setHighlighted:(BOOL)highlighted {
  [super setHighlighted:highlighted];
  [self updateLook];
}

- (void)setEnabled:(BOOL)enabled {
  [super setEnabled:enabled];
  self.accessibilityTraits = enabled ? UIAccessibilityTraitButton : (UIAccessibilityTraitButton | UIAccessibilityTraitNotEnabled);
  [self updateLook];
}

// A title is drawn in the bar's tint, as UIKit's own bar buttons draw theirs.
- (void)tintColorDidChange {
  [super tintColorDidChange];
  _titleLabel.textColor = self.tintColor;
}

@end

#pragma mark - Children of the toolbar

@interface SvelteToolbarContentView ()
- (void)contentSizeDidChange;
@end

@implementation SvelteToolbarContentView {
  SvelteBarContainer *_barView;
  NSUInteger _contentCount;
  CGSize _yogaSize;
}

- (SvelteBarContainer *)barView {
  if (_barView == nil) _barView = [SvelteBarContainer new];
  return _barView;
}

- (NSUInteger)contentCount {
  return _contentCount;
}

/// The container is as large as Yoga laid the node out, unchanged: for the center slot that is the free span between the items
/// (the band's width less its edges and what the items take, the numbers UIKit lays the bar out with).
- (void)applySize {
  self.barView.contentSize = _yogaSize;
  [self contentSizeDidChange];
}

- (void)contentSizeDidChange {
  [_barView setNeedsLayout];
}

- (void)mountChildComponentView:(UIView<RCTComponentViewProtocol> *)childComponentView index:(NSInteger)index {
  [super mountChildComponentView:childComponentView index:index];
  _contentCount += 1;
  [_toolbar contentDidChange];
}

- (void)unmountChildComponentView:(UIView<RCTComponentViewProtocol> *)childComponentView index:(NSInteger)index {
  [super unmountChildComponentView:childComponentView index:index];
  if (_contentCount > 0) _contentCount -= 1;
  [_toolbar contentDidChange];
}

// Only the size is Yoga's: the bar puts the node where it belongs.
#pragma clang diagnostic push
#pragma clang diagnostic ignored "-Wobjc-missing-super-calls"
- (void)updateLayoutMetrics:(const LayoutMetrics &)layoutMetrics oldLayoutMetrics:(const LayoutMetrics &)oldLayoutMetrics {
  _layoutMetrics = layoutMetrics;
  const CGSize size = RCTCGSizeFromSize(layoutMetrics.frame.size);
  if (!std::isfinite(size.width) || !std::isfinite(size.height)) return;
  _yogaSize = size;
  self.bounds = CGRectMake(0, 0, size.width, size.height);
  const UISemanticContentAttribute direction = layoutMetrics.layoutDirection == LayoutDirection::RightToLeft
      ? UISemanticContentAttributeForceRightToLeft
      : UISemanticContentAttributeForceLeftToRight;
  self.semanticContentAttribute = direction;
  self.barView.semanticContentAttribute = direction;
  [self applySize];
}
#pragma clang diagnostic pop

- (void)invalidate {
  [self removeFromSuperview];
  [_barView removeFromSuperview];
  _toolbar = nil;
}

@end

@implementation SvelteToolbarItemView {
  svelte::ToolbarItemSpec _spec;
  std::string _signature;
  BOOL _parsed;
  UIBarButtonItem *_barItem;
  SvelteToolbarButton *_button;
  /// 0 none yet, 1 flexible space, 2 UIKit's own button, 3 the control above.
  int _form;
  UIImage *_image;
  NSString *_imageUri;
  /// What this view last assigned to a plain `UIBarButtonItem` (every setter makes the toolbar lay out again, equal value or not).
  BOOL _applied;
  UIImage *_appliedImage;
  NSString *_appliedTitle;
  NSString *_appliedLabel;
  NSString *_appliedIdentifier;
  BOOL _appliedEnabled;
}

+ (ComponentDescriptorProvider)componentDescriptorProvider {
  return concreteComponentDescriptorProvider<svelte::SvelteToolbarItemComponentDescriptor>();
}

+ (BOOL)shouldBeRecycled {
  return NO;
}

+ (void)load {
  [[RCTComponentViewFactory currentComponentViewFactory] registerComponentViewClass:self];
}

- (const svelte::ToolbarItemSpec &)spec {
  return _spec;
}

- (void)updateProps:(const Props::Shared &)props oldProps:(const Props::Shared &)oldProps {
  [super updateProps:props oldProps:oldProps];
  const auto &viewProps = static_cast<const ViewProps &>(*props);
  // The item's label and test id are the control's own accessibility props.
  const std::string signature = viewProps.nativeId + '\x1f' + viewProps.accessibilityLabel + '\x1f' + viewProps.testId;
  if (_parsed && signature == _signature) return;
  _signature = signature;
  _parsed = YES;
  _spec = svelte::parseToolbarItem(viewProps.nativeId);
  [self.toolbar contentDidChange];
}

- (void)contentSizeDidChange {
  [super contentSizeDidChange];
  [_button contentSizeDidChange];
}

- (void)pressed {
  [self.toolbar itemPressed:self];
}

- (BOOL)hasIcon {
  return _spec.icon.has_value() && !_spec.icon->empty();
}

- (int)wantedForm {
  if (_spec.spacer != 0) return 1;
  const BOOL hasTitle = _spec.title.has_value() && !_spec.title->empty();
  // UIKit draws an image or a title; a snippet, an image with a title and a badge are the control's.
  if (_spec.iconIsView != 0 || _spec.badgeKind != svelte::kBadgeNone || ([self hasIcon] && hasTitle)) return 3;
  return 2;
}

- (void)build:(int)form {
  _form = form;
  _applied = NO;
  [_button removeTarget:self action:nil forControlEvents:UIControlEventAllEvents];
  _button = nil;
  if (form == 1) {
    _barItem = [[UIBarButtonItem alloc] initWithBarButtonSystemItem:UIBarButtonSystemItemFlexibleSpace target:nil action:nil];
  } else if (form == 2) {
    _barItem = [[UIBarButtonItem alloc] initWithImage:nil style:UIBarButtonItemStylePlain target:self action:@selector(pressed)];
  } else {
    _button = [SvelteToolbarButton new];
    [_button addTarget:self action:@selector(pressed) forControlEvents:UIControlEventTouchUpInside];
    _barItem = [[UIBarButtonItem alloc] initWithCustomView:_button];
  }
}

// An image comes from its uri once, cached by `SvelteLoadImage`; a file or a data uri is there at once, a remote one later (the
// item then applies itself, the bar's items stay the same).
- (void)loadImage {
  NSString *uri = [self hasIcon] ? SvelteString(_spec.icon) : nil;
  if (SvelteSameString(uri, _imageUri)) return;
  _imageUri = uri;
  _image = nil;
  if (uri == nil) return;
  __block BOOL synchronous = YES;
  __weak SvelteToolbarItemView *weakSelf = self;
  SvelteLoadImage(uri, ^(UIImage *image) {
    SvelteToolbarItemView *item = weakSelf;
    if (item == nil || image == nil || ![uri isEqualToString:item->_imageUri]) return;
    item->_image = SvelteTemplateImage(image);
    if (!synchronous) [item barItem];
  });
  synchronous = NO;
}

- (UIBarButtonItem *)barItem {
  const int form = [self wantedForm];
  if (_barItem == nil || form != _form) [self build:form];
  if (form == 1) return _barItem;
  [self loadImage];

  const auto &props = static_cast<const ViewProps &>(*_props);
  NSString *title = SvelteString(_spec.title);
  const BOOL hasTitle = title.length > 0;
  NSString *badge = nil;
  if (_spec.badgeKind == svelte::kBadgeText) badge = SvelteString(_spec.badgeText);
  // The label is the node's own, else the title; a badge is announced as the tab bar's is.
  NSString *label = props.accessibilityLabel.empty() ? nil : [NSString stringWithUTF8String:props.accessibilityLabel.c_str()];
  if (label == nil) {
    NSString *announced = _spec.badgeKind == svelte::kBadgeDot ? @"new items" : badge;
    label = announced != nil && hasTitle ? [NSString stringWithFormat:@"%@, %@", title, announced] : title;
  }
  NSString *identifier = props.testId.empty() ? nil : [NSString stringWithUTF8String:props.testId.c_str()];
  const BOOL enabled = _spec.disabled == 0;

  if (form == 3) {
    [_button setIcon:_image title:hasTitle ? title : nil host:_spec.iconIsView != 0 ? self.barView : nil];
    if (_spec.iconIsView != 0 && self.superview != self.barView) [self.barView addSubview:self];
    [_button setBadgeKind:_spec.badgeKind text:badge];
    if (_button.enabled != enabled) _button.enabled = enabled;
    _button.accessibilityLabel = label;
    _button.accessibilityIdentifier = identifier;
    return _barItem;
  }

  const BOOL first = !_applied;
  _applied = YES;
  UIImage *image = [self hasIcon] ? _image : nil;
  NSString *shownTitle = [self hasIcon] ? nil : title;
  if (first || _appliedImage != image) {
    _barItem.image = image;
    _appliedImage = image;
  }
  if (first || !SvelteSameString(_appliedTitle, shownTitle)) {
    _barItem.title = shownTitle;
    _appliedTitle = shownTitle;
  }
  if (first || _appliedEnabled != enabled) {
    _barItem.enabled = enabled;
    _appliedEnabled = enabled;
  }
  if (first || !SvelteSameString(_appliedLabel, label)) {
    _barItem.accessibilityLabel = label;
    _appliedLabel = label;
  }
  if (first || !SvelteSameString(_appliedIdentifier, identifier)) {
    _barItem.accessibilityIdentifier = identifier;
    _appliedIdentifier = identifier;
  }
  return _barItem;
}

@end

@implementation SvelteToolbarCenterView {
  UIBarButtonItem *_barItem;
}

+ (ComponentDescriptorProvider)componentDescriptorProvider {
  return concreteComponentDescriptorProvider<svelte::SvelteToolbarCenterComponentDescriptor>();
}

+ (BOOL)shouldBeRecycled {
  return NO;
}

+ (void)load {
  [[RCTComponentViewFactory currentComponentViewFactory] registerComponentViewClass:self];
}

- (UIBarButtonItem *)barItem {
  if (_barItem == nil) {
    // The bar sizes a custom view with Auto Layout: the intrinsic size is what Yoga computed.
    self.barView.translatesAutoresizingMaskIntoConstraints = NO;
    self.barView.clipsToBounds = YES;
    _barItem = [[UIBarButtonItem alloc] initWithCustomView:self.barView];
  }
  if (self.superview != self.barView) [self.barView addSubview:self];
  return _barItem;
}

@end

#pragma mark - The toolbar

@implementation SvelteToolbarView {
  svelte::ToolbarSpec _spec;
  std::string _nativeId;
  BOOL _parsed;
  NSMutableArray<SvelteToolbarContentView *> *_children;
  /// The flexible spaces on both sides of the center slot (one pair, so the item list compares equal from one update to the next).
  UIBarButtonItem *_spaceBefore;
  UIBarButtonItem *_spaceAfter;
  BOOL _reported;
  CGFloat _lastHeight;
  CGFloat _lastInset;
}

+ (ComponentDescriptorProvider)componentDescriptorProvider {
  return concreteComponentDescriptorProvider<svelte::SvelteToolbarComponentDescriptor>();
}

+ (BOOL)shouldBeRecycled {
  return NO;
}

+ (void)load {
  [[RCTComponentViewFactory currentComponentViewFactory] registerComponentViewClass:self];
}

- (instancetype)initWithFrame:(CGRect)frame {
  if (self = [super initWithFrame:frame]) {
    _children = [NSMutableArray new];
    _spaceBefore = [[UIBarButtonItem alloc] initWithBarButtonSystemItem:UIBarButtonSystemItemFlexibleSpace target:nil action:nil];
    _spaceAfter = [[UIBarButtonItem alloc] initWithBarButtonSystemItem:UIBarButtonSystemItemFlexibleSpace target:nil action:nil];
  }
  return self;
}

- (const svelte::ToolbarSpec &)spec {
  return _spec;
}

- (void)updateProps:(const Props::Shared &)props oldProps:(const Props::Shared &)oldProps {
  [super updateProps:props oldProps:oldProps];
  const auto &viewProps = static_cast<const ViewProps &>(*props);
  if (_parsed && viewProps.nativeId == _nativeId) return;
  _nativeId = viewProps.nativeId;
  _parsed = YES;
  _spec = svelte::parseToolbar(_nativeId);
  [_screen setNeedsToolbarUpdate];
}

// The items are the bar's: they are never subviews of the toolbar.
- (void)mountChildComponentView:(UIView<RCTComponentViewProtocol> *)childComponentView index:(NSInteger)index {
  if (![childComponentView isKindOfClass:[SvelteToolbarContentView class]]) {
    RCTLogError(@"SvelteToolbar only accepts SvelteToolbarItem and SvelteToolbarCenter children, got %@", childComponentView);
    return;
  }
  SvelteToolbarContentView *child = (SvelteToolbarContentView *)childComponentView;
  child.toolbar = self;
  [_children insertObject:child atIndex:MIN((NSUInteger)index, _children.count)];
  [_screen setNeedsToolbarUpdate];
}

- (void)unmountChildComponentView:(UIView<RCTComponentViewProtocol> *)childComponentView index:(NSInteger)index {
  if (![childComponentView isKindOfClass:[SvelteToolbarContentView class]]) return;
  SvelteToolbarContentView *child = (SvelteToolbarContentView *)childComponentView;
  child.toolbar = nil;
  [child removeFromSuperview];
  [_children removeObject:child];
  [_screen setNeedsToolbarUpdate];
}

- (void)contentDidChange {
  [_screen setNeedsToolbarUpdate];
}

- (void)itemPressed:(SvelteToolbarItemView *)item {
  NSUInteger index = 0;
  for (SvelteToolbarContentView *child in _children) {
    if (child == item) break;
    if ([child isKindOfClass:[SvelteToolbarItemView class]]) index += 1;
  }
  NSString *key = SvelteString([item spec].key) ?: @"";
  SvelteEmit(_eventEmitter, "press", folly::dynamic::object("key", std::string(key.UTF8String ?: ""))("index", (int)index));
}

#pragma mark - Items

+ (void)clearController:(UIViewController *)controller {
  if (controller.toolbarItems.count > 0) [controller setToolbarItems:nil animated:NO];
}

- (void)applyToController:(UIViewController *)controller {
  SvelteToolbarCenterView *center = nil;
  for (SvelteToolbarContentView *child in _children) {
    if ([child isKindOfClass:[SvelteToolbarCenterView class]]) center = (SvelteToolbarCenterView *)child;
  }
  // The center slot takes the place of the first flexible space, flanked by two of its own so that it stays in the middle of what is
  // left; without a flexible space it follows the last item.
  NSMutableArray<UIBarButtonItem *> *items = [NSMutableArray new];
  BOOL placed = NO;
  for (SvelteToolbarContentView *child in _children) {
    if (child == center) continue;
    SvelteToolbarItemView *item = (SvelteToolbarItemView *)child;
    UIBarButtonItem *barItem = [item barItem];
    if (center != nil && !placed && [item spec].spacer != 0) {
      [items addObjectsFromArray:@[ _spaceBefore, [center barItem], _spaceAfter ]];
      placed = YES;
      continue;
    }
    [items addObject:barItem];
  }
  if (center != nil && !placed) [items addObject:[center barItem]];
  if (![controller.toolbarItems isEqualToArray:items]) [controller setToolbarItems:items animated:NO];
}

#pragma mark - Appearance

- (UIToolbarAppearance *)appearanceWithTransparentBackground:(BOOL)transparent {
  UIToolbarAppearance *appearance = [UIToolbarAppearance new];
  UIColor *background = SvelteColor(_spec.background);
  if (transparent) [appearance configureWithTransparentBackground];
  else if (background != nil) [appearance configureWithOpaqueBackground];
  else [appearance configureWithDefaultBackground];
  if (background != nil && !transparent) appearance.backgroundColor = background;
  return appearance;
}

// As the header's: the bar keeps its configured look, a translucent one is transparent while the content is at its end (under it
// when the content is scrolled to its end, nothing is under the bar), so that the content may run under the blurred bar.
- (void)applyAppearanceTo:(UIToolbar *)toolbar {
  toolbar.tintColor = SvelteColor(_spec.tint);
  UIToolbarAppearance *standard = [self appearanceWithTransparentBackground:NO];
  UIToolbarAppearance *edge = _spec.translucent ? [self appearanceWithTransparentBackground:YES] : standard;
  toolbar.standardAppearance = standard;
  toolbar.compactAppearance = standard;
  toolbar.scrollEdgeAppearance = edge;
  toolbar.compactScrollEdgeAppearance = edge;
}

#pragma mark - Metrics

// The bar's frame is UIKit's: at the bottom of the navigation controller's view, as high as the bar plus the home indicator's inset
// (inside a tab pane the inset is 0: the pane ends at the tab bar). That is the band Yoga laid out when the estimates are right.
- (void)reportMetrics {
  UIViewController *controller = _screen.controller;
  UINavigationController *navigation = controller.navigationController;
  if (navigation == nil || navigation.toolbarHidden || navigation.topViewController != controller) return;
  UIToolbar *bar = navigation.toolbar;
  const CGFloat height = bar.frame.size.height;
  if (bar.superview == nil || height <= 0) return;
  const CGFloat inset = navigation.view.safeAreaInsets.bottom;
  if (_reported && fabs(height - _lastHeight) < 0.5 && fabs(inset - _lastInset) < 0.5) return;
  _reported = YES;
  _lastHeight = height;
  _lastInset = inset;
  SvelteEmit(_eventEmitter, "metrics", folly::dynamic::object("height", (double)height)("inset", (double)inset));
  [_screen toolbarMetricsDidChange];
}

- (CGFloat)reportedHeight {
  return _reported ? _lastHeight : 0;
}

- (void)invalidate {
  [_children removeAllObjects];
  _screen = nil;
}

@end
