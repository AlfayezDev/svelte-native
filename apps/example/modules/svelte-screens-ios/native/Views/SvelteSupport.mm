#import "SvelteSupport.h"

#import <React/RCTRootComponentView.h>
#import <React/RCTSurfaceTouchHandler.h>

UIColor *_Nullable SvelteColor(const svelte::Color &color) {
  if (!color.set) return nil;
  return [UIColor colorWithRed:((color.argb >> 16) & 0xff) / 255.0
                         green:((color.argb >> 8) & 0xff) / 255.0
                          blue:(color.argb & 0xff) / 255.0
                         alpha:((color.argb >> 24) & 0xff) / 255.0];
}

NSString *_Nullable SvelteString(const std::optional<std::string> &value) {
  if (!value) return nil;
  return [NSString stringWithUTF8String:value->c_str()] ?: @"";
}

UIViewController *_Nullable SvelteNearestViewController(UIView *view) {
  for (UIResponder *responder = view.nextResponder; responder != nil; responder = responder.nextResponder) {
    if ([responder isKindOfClass:[UIViewController class]]) return (UIViewController *)responder;
  }
  return nil;
}

BOOL SvelteIsUnderSurfaceRoot(UIView *view) {
  for (UIView *ancestor = view; ancestor != nil; ancestor = ancestor.superview) {
    if ([ancestor isKindOfClass:[RCTRootComponentView class]]) return YES;
  }
  return NO;
}

void SvelteEmit(const facebook::react::SharedViewEventEmitter &emitter, const char *type, folly::dynamic payload) {
  if (emitter) emitter->dispatchEvent(type, std::move(payload));
}

void SvelteScheduleLifecycle(SvelteLifecycle kind, dispatch_block_t send) {
  static NSMutableArray<NSDictionary *> *queue;
  if (queue == nil) queue = [NSMutableArray new];
  const BOOL first = queue.count == 0;
  [queue addObject:@{@"kind" : @(kind), @"send" : [send copy]}];
  if (!first) return;
  dispatch_async(dispatch_get_main_queue(), ^{
    NSArray<NSDictionary *> *batch = [queue sortedArrayWithOptions:NSSortStable
                                                   usingComparator:^NSComparisonResult(NSDictionary *a, NSDictionary *b) {
                                                     return [a[@"kind"] compare:b[@"kind"]];
                                                   }];
    [queue removeAllObjects];
    for (NSDictionary *entry in batch) ((dispatch_block_t)entry[@"send"])();
  });
}

@interface SvelteFrameTick : NSObject
@end

@implementation SvelteFrameTick {
  dispatch_block_t _block;
}

- (instancetype)initWithBlock:(dispatch_block_t)block {
  if (self = [super init]) _block = [block copy];
  return self;
}

- (void)tick:(CADisplayLink *)link {
  [link invalidate];
  dispatch_block_t block = _block;
  _block = nil;
  if (block != nil) block();
}

@end

void SvelteAfterNextFrame(dispatch_block_t block) {
  SvelteFrameTick *tick = [[SvelteFrameTick alloc] initWithBlock:block];
  CADisplayLink *link = [CADisplayLink displayLinkWithTarget:tick selector:@selector(tick:)];
  [link addToRunLoop:NSRunLoop.mainRunLoop forMode:NSRunLoopCommonModes];
}

@implementation SvelteNavigationController

- (UIViewController *)childViewControllerForStatusBarStyle {
  return self.topViewController;
}

- (UIViewController *)childViewControllerForStatusBarHidden {
  return self.topViewController;
}

- (void)viewDidLayoutSubviews {
  [super viewDidLayoutSubviews];
  if (self.didLayout != nil) self.didLayout();
}

// UIKit builds the large title's label in the first layout of the bar after the controller began to appear. A stack that is a child of a
// screen the window already holds (the screen is staged for its push, a pane is shown the first time) gets an appearance at once and the
// screen's own, animated, when the push starts; the layout that UIKit makes inside the second `viewWillAppear` leaves the large title's
// band empty, and nothing lays the bar out again (the inbox pane of the route-tree lab drew its title on one launch in four). The next
// layout builds it: one after the frame in which the appearance began, and one when it ended.
- (void)layOutLargeTitle {
  UINavigationBar *bar = self.navigationBar;
  if (!bar.prefersLargeTitles || self.topViewController.navigationItem.largeTitleDisplayMode != UINavigationItemLargeTitleDisplayModeAlways) return;
  [bar setNeedsLayout];
  [bar layoutIfNeeded];
}

- (void)viewWillAppear:(BOOL)animated {
  [super viewWillAppear:animated];
  __weak SvelteNavigationController *weakSelf = self;
  SvelteAfterNextFrame(^{
    [weakSelf layOutLargeTitle];
  });
}

- (void)viewDidAppear:(BOOL)animated {
  [super viewDidAppear:animated];
  __weak SvelteNavigationController *weakSelf = self;
  dispatch_async(dispatch_get_main_queue(), ^{
    [weakSelf layOutLargeTitle];
  });
}

@end

@implementation SvelteTouchHost {
  RCTSurfaceTouchHandler *_handler;
  __weak UIView *_view;
}

- (void)attachToView:(UIView *)view offset:(CGPoint)offset {
  if (_view != view) {
    [self detach];
    if (_handler == nil) _handler = [RCTSurfaceTouchHandler new];
    [_handler attachToView:view];
    _view = view;
  }
  _handler.viewOriginOffset = offset;
}

- (void)detach {
  UIView *view = _view;
  if (view != nil) [_handler detachFromView:view];
  _view = nil;
}

- (void)dealloc {
  [self detach];
}

@end

@implementation SvelteBarContainer

- (void)setContentSize:(CGSize)contentSize {
  if (CGSizeEqualToSize(_contentSize, contentSize)) return;
  _contentSize = contentSize;
  [self invalidateIntrinsicContentSize];
}

- (CGSize)intrinsicContentSize {
  return _contentSize;
}

- (CGSize)sizeThatFits:(CGSize)size {
  return _contentSize;
}

// iOS 26 stretches a custom bar item to a minimum width: the slot stays in the middle of what UIKit gives it.
- (void)layoutSubviews {
  [super layoutSubviews];
  UIView *content = self.subviews.firstObject;
  content.center = CGPointMake(self.bounds.size.width / 2, self.bounds.size.height / 2);
}

@end

void SvelteLoadImage(NSString *uri, void (^completion)(UIImage *_Nullable image)) {
  static NSCache<NSString *, UIImage *> *cache;
  static dispatch_once_t once;
  dispatch_once(&once, ^{
    cache = [NSCache new];
  });
  UIImage *cached = [cache objectForKey:uri];
  if (cached != nil) {
    completion(cached);
    return;
  }
  NSURL *url = [NSURL URLWithString:uri];
  if (url == nil) {
    completion(nil);
    return;
  }
  if (url.isFileURL) {
    UIImage *image = [UIImage imageWithContentsOfFile:url.path];
    if (image != nil) [cache setObject:image forKey:uri];
    completion(image);
    return;
  }
  NSString *scheme = url.scheme.lowercaseString;
  if ([scheme isEqualToString:@"data"]) {
    // The bytes are in the uri.
    NSData *data = [NSData dataWithContentsOfURL:url];
    UIImage *image = data != nil ? [UIImage imageWithData:data] : nil;
    if (image != nil) [cache setObject:image forKey:uri];
    completion(image);
    return;
  }
  if (![scheme isEqualToString:@"http"] && ![scheme isEqualToString:@"https"]) {
    completion(nil);
    return;
  }
  [[[NSURLSession sharedSession] dataTaskWithURL:url
                               completionHandler:^(NSData *data, NSURLResponse *response, NSError *error) {
                                 UIImage *image = data != nil ? [UIImage imageWithData:data] : nil;
                                 dispatch_async(dispatch_get_main_queue(), ^{
                                   if (image != nil) [cache setObject:image forKey:uri];
                                   completion(image);
                                 });
                               }] resume];
}

UIImage *SvelteTemplateImage(UIImage *source) {
  const CGFloat side = 24;
  UIGraphicsImageRenderer *renderer = [[UIGraphicsImageRenderer alloc] initWithSize:CGSizeMake(side, side)];
  UIImage *fitted = [renderer imageWithActions:^(UIGraphicsImageRendererContext *context) {
    const CGSize size = source.size;
    if (size.width <= 0 || size.height <= 0) return;
    const CGFloat factor = MIN(side / size.width, side / size.height);
    const CGSize drawn = CGSizeMake(size.width * factor, size.height * factor);
    [source drawInRect:CGRectMake((side - drawn.width) / 2, (side - drawn.height) / 2, drawn.width, drawn.height)];
  }];
  return [fitted imageWithRenderingMode:UIImageRenderingModeAlwaysTemplate];
}

UIImage *_Nullable SvelteSnapshotImage(UIView *view) {
  const CGSize size = view.bounds.size;
  if (size.width < 1 || size.height < 1) return nil;
  UIGraphicsImageRenderer *renderer = [[UIGraphicsImageRenderer alloc] initWithSize:size];
  UIImage *drawn = [renderer imageWithActions:^(UIGraphicsImageRendererContext *context) {
    [view.layer renderInContext:context.CGContext];
  }];
  return SvelteTemplateImage(drawn);
}
