#import <Foundation/Foundation.h>

#import <React/RCTBridgeModule.h>

#import "RNGestureHandler.h"
#import "RNGestureHandlerDetector.h"
#import "RNGestureHandlerRegistry.h"

@class RCTUIManager;
@class RCTEventDispatcher;

@interface RNGestureHandlerManager : NSObject

@property (nonatomic, strong, readonly, nonnull) RNGestureHandlerRegistry *registry;

- (nonnull instancetype)initWithModuleRegistry:(nonnull RCTModuleRegistry *)moduleRegistry
                                  viewRegistry:(nonnull RCTViewRegistry *)viewRegistry;

- (void)createGestureHandler:(nonnull NSString *)handlerName
                         tag:(nonnull NSNumber *)handlerTag
                      config:(nonnull NSDictionary *)config;

- (void)attachGestureHandler:(nonnull NSNumber *)handlerTag
               toViewWithTag:(nonnull NSNumber *)viewTag
              withActionType:(RNGestureHandlerActionType)actionType;

- (void)attachGestureHandler:(nonnull NSNumber *)handlerTag
               toViewWithTag:(nonnull NSNumber *)viewTag
              withActionType:(RNGestureHandlerActionType)actionType
            withHostDetector:(nullable RNGHUIView *)hostDetector;

- (void)attachHandlerForDetectorWithTag:(nonnull NSNumber *)handlerTag
                                 toView:(nonnull RNGHUIView *)view
                         withActionType:(RNGestureHandlerActionType)actionType
                       withHostDetector:(nullable RNGHUIView *)hostDetector;

- (void)setGestureHandlerConfig:(nonnull NSNumber *)handlerTag config:(nonnull NSDictionary *)config;

- (void)updateGestureHandlerConfig:(nonnull NSNumber *)handlerTag config:(nonnull NSDictionary *)config;

- (void)updateGestureHandlerRelations:(nonnull NSNumber *)handlerTag relations:(nonnull NSDictionary *)relations;

- (void)dropGestureHandler:(nonnull NSNumber *)handlerTag;

- (void)dropAllGestureHandlers;

/// The manager of the running module, or nil before the module exists (an app that never attached a handler).
+ (nullable RNGestureHandlerManager *)currentManager;

/// Gives `view`, which holds React Native's touch handler (or sits under a view that does), the root recognizer when a handler is
/// attached below it and the walk of `attachGestureHandler` could not reach one at that time: a screen that joins its window after
/// its handlers attached. The recognizer is registered here as any other, so the activation callback reaches it.
- (void)registerRootViewGestureRecognizerIfAttachedBelow:(nonnull RNGHUIView *)view;

- (nullable RNGestureHandler *)handlerWithTag:(nonnull NSNumber *)handlerTag;

- (nullable RNGHUIView *)viewForReactTag:(nonnull NSNumber *)reactTag;

- (void)reattachHandlersIfNeeded;
@end
