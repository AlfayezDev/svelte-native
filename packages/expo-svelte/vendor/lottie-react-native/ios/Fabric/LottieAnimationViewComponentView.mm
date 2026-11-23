#import "LottieAnimationViewComponentView.h"

#import <react/renderer/components/lottiereactnative/ComponentDescriptors.h>
#import <react/renderer/components/lottiereactnative/EventEmitters.h>
#import <react/renderer/components/lottiereactnative/Props.h>
#import <react/renderer/components/lottiereactnative/RCTComponentViewHelpers.h>

#import <React/RCTFabricComponentsPlugins.h>
#import <React/RCTView.h>
#import "LottieContainerView.h"
#import "RNLottieFabricConversions.h"

using namespace facebook::react;

@interface LottieAnimationViewComponentView () <RCTLottieAnimationViewViewProtocol>
@end

// Sends one event through the view's emitter: the block gets the emitter, `LottieAnimationViewEventEmitter`.
typedef void (^LottieEventSend)(const LottieAnimationViewEventEmitter &);

@implementation LottieAnimationViewComponentView {
    LottieContainerView *_view;
    // Events the animation raised before this view had its event emitter, in order. React Native updates a new component view's props
    // and only then gives it the emitter (`RCTMountingManager`: `updateProps:`, `updateEventEmitter:`), and a source that loads at once
    // (`sourceJson`, `sourceName`, the first props of the view) raises `onAnimationLoaded` (or `onAnimationFailure`, when the JSON does
    // not parse) while the props are applied, so those events were dropped. They are sent when the emitter arrives.
    NSMutableArray *_eventsBeforeEmitter;
    // Whether the container holds a loaded animation, the message of the last source that failed, and whether `onAnimationLoaded` and
    // `onAnimationFailure` were sent for the node the view shows now. A recycled view keeps its animation and its props: the node
    // that gets it with the same source loads nothing, so nothing would tell it that its animation is loaded (or that it failed).
    // When its emitter arrives the view says so. All of it is read and written on the main thread.
    BOOL _animationLoaded;
    BOOL _loadedEventSent;
    NSString *_lastFailure;
    BOOL _failureEventSent;
}

+(void) load {
    [super load];
}

- (instancetype) initWithFrame:(CGRect)frame
{
    if (self = [super initWithFrame:frame]) {
        static const auto defaultProps = std::make_shared<const LottieAnimationViewProps>();
        _props = defaultProps;

        _view = [LottieContainerView new];
        _view.delegate = self;

        self.contentView = _view;
    }

    return self;
}

#pragma mark - RCTComponentViewProtocol

+ (ComponentDescriptorProvider)componentDescriptorProvider
{
    return concreteComponentDescriptorProvider<LottieAnimationViewComponentDescriptor>();
}

- (void)updateProps:(Props::Shared const &)props oldProps:(Props::Shared const &)oldProps {
    const auto &oldLottieProps = *std::static_pointer_cast<const LottieAnimationViewProps>(_props);
    const auto &newLottieProps = *std::static_pointer_cast<const LottieAnimationViewProps>(props);

    if (!_eventEmitter) {
        // The first props of a node. What was queued before them, a source that finished loading while the view sat in the recycle pool,
        // belongs to no node: a node with the same source hears of it from the replay in `updateEventEmitter:`, any other loads its own.
        _eventsBeforeEmitter = nil;
        _loadedEventSent = NO;
        _failureEventSent = NO;
    }

    if(oldLottieProps.resizeMode != newLottieProps.resizeMode) {
        [_view setResizeMode:RCTNSStringFromString(newLottieProps.resizeMode)];
    }

    if(oldLottieProps.progress != newLottieProps.progress) {
        [_view setProgress:newLottieProps.progress];
    }

    if(oldLottieProps.loop != newLottieProps.loop) {
        [_view setLoop:newLottieProps.loop];
    }

    if(oldLottieProps.speed != newLottieProps.speed) {
        [_view setSpeed:newLottieProps.speed];
    }

    if(oldLottieProps.sourceJson != newLottieProps.sourceJson ||
       oldLottieProps.sourceDotLottieURI != newLottieProps.sourceDotLottieURI ||
       oldLottieProps.sourceName != newLottieProps.sourceName ||
       oldLottieProps.sourceURL != newLottieProps.sourceURL) {
        // The animation that was loaded and the failure that was seen go; the load of the new source says when there is an animation again.
        _animationLoaded = NO;
        _lastFailure = nil;
    }

    if(oldLottieProps.sourceJson != newLottieProps.sourceJson) {
        [_view setSourceJson:RCTNSStringFromString(newLottieProps.sourceJson.c_str())];
    }

    if(oldLottieProps.sourceDotLottieURI != newLottieProps.sourceDotLottieURI) {
        [_view setSourceDotLottieURI:RCTNSStringFromString(newLottieProps.sourceDotLottieURI)];
    }

    if(oldLottieProps.sourceName != newLottieProps.sourceName) {
        [_view setSourceName:RCTNSStringFromString(newLottieProps.sourceName)];
    }

    if(oldLottieProps.sourceURL != newLottieProps.sourceURL) {
        [_view setSourceURL:RCTNSStringFromString(newLottieProps.sourceURL)];
    }
    
    if(oldLottieProps.colorFilters != newLottieProps.colorFilters) {
        [_view setColorFilters:convertColorFilters(newLottieProps.colorFilters)];
    }

    if(oldLottieProps.textFiltersIOS != newLottieProps.textFiltersIOS) {
        [_view setTextFiltersIOS:convertTextFilters(newLottieProps.textFiltersIOS)];
    }

    if(oldLottieProps.renderMode != newLottieProps.renderMode) {
        [_view setRenderMode:RCTNSStringFromString(newLottieProps.renderMode)];
    }

    if(oldLottieProps.autoPlay != newLottieProps.autoPlay) {
        [_view setAutoPlay:newLottieProps.autoPlay];
    }

    [super updateProps:props oldProps:oldProps];
}

#pragma mark - Native Commands

- (void)handleCommand:(const NSString *)commandName args:(const NSArray *)args
{
    RCTLottieAnimationViewHandleCommand(self, commandName, args);
}

- (void) play:(NSInteger)startFrame endFrame:(NSInteger)endFrame
{
    if (startFrame != -1 && endFrame != -1) {
        [_view playFromFrame:@(startFrame) toFrame:endFrame];
    } else {
        [_view play];
    }
}

- (void) reset
{
    [_view reset];
}

- (void) pause
{
    [_view pause];
}

- (void) resume
{
    [_view resume];
}

// The animation's callbacks come from the thread that loaded it (a fetched source ends on the URL session's queue); the view's state is the main thread's.
- (void)lottieOnMain:(dispatch_block_t)block
{
    if ([NSThread isMainThread]) {
        block();
    } else {
        dispatch_async(dispatch_get_main_queue(), block);
    }
}

// Sends an event through the view's emitter. Without one (the view has its props but not yet its emitter) a loaded or failure event is kept for it
// [keepUntilEmitter]; a finish event is dropped, as it was, which also bounds the queue.
- (void)lottieSendEvent:(LottieEventSend)send keepUntilEmitter:(BOOL)keepUntilEmitter
{
    [self lottieOnMain:^{
        const auto emitter = std::dynamic_pointer_cast<const LottieAnimationViewEventEmitter>(self->_eventEmitter);
        if (emitter) {
            send(*emitter);
            return;
        }

        if (!keepUntilEmitter) {
            return;
        }

        if (!self->_eventsBeforeEmitter) {
            self->_eventsBeforeEmitter = [NSMutableArray new];
        }
        [self->_eventsBeforeEmitter addObject:[send copy]];
    }];
}

- (void)updateEventEmitter:(const EventEmitter::Shared &)eventEmitter
{
    [super updateEventEmitter:eventEmitter];

    NSArray *pending = _eventsBeforeEmitter;
    _eventsBeforeEmitter = nil;
    for (id item in pending) {
        LottieEventSend send = item;
        [self lottieSendEvent:send keepUntilEmitter:YES];
    }

    if (_animationLoaded && !_loadedEventSent) {
        [self onAnimationLoaded];
    }

    if (_lastFailure && !_failureEventSent) {
        [self onAnimationFailureWithError:_lastFailure];
    }
}

- (void)prepareForRecycle
{
    _eventsBeforeEmitter = nil;
    _loadedEventSent = NO;
    _failureEventSent = NO;
    [super prepareForRecycle];
}

- (void)onAnimationFinishWithIsCancelled:(bool)isCancelled
{
    [self lottieSendEvent:^(const LottieAnimationViewEventEmitter &emitter) {
        LottieAnimationViewEventEmitter::OnAnimationFinish event = {
            .isCancelled = isCancelled
        };

        emitter.onAnimationFinish(event);
    } keepUntilEmitter:NO];
}

- (void)onAnimationFailureWithError:(NSString*)error
{
    [self lottieOnMain:^{
        self->_lastFailure = error;
        self->_failureEventSent = YES;
        [self lottieSendEvent:^(const LottieAnimationViewEventEmitter &emitter) {
            LottieAnimationViewEventEmitter::OnAnimationFailure event = {
                .error = std::string([error UTF8String])
            };

            emitter.onAnimationFailure(event);
        } keepUntilEmitter:YES];
    }];
}

- (void)onAnimationLoaded
{
    [self lottieOnMain:^{
        self->_animationLoaded = YES;
        self->_loadedEventSent = YES;
        [self lottieSendEvent:^(const LottieAnimationViewEventEmitter &emitter) {
            LottieAnimationViewEventEmitter::OnAnimationLoaded event = {};

            emitter.onAnimationLoaded(event);
        } keepUntilEmitter:YES];
    }];
}

@end

Class<RCTComponentViewProtocol> LottieAnimationViewCls(void)
{
    return LottieAnimationViewComponentView.class;
}
