#import <Foundation/Foundation.h>

#import <React/RCTBridgeModule.h>

#import "RNGestureHandler.h"

@class RCTUIManager;
@class RCTEventDispatcher;

@interface RNGestureHandlerManager : NSObject

#ifdef RCT_NEW_ARCH_ENABLED
- (nonnull instancetype)initWithModuleRegistry:(nonnull RCTModuleRegistry *)moduleRegistry
                                  viewRegistry:(nonnull RCTViewRegistry *)viewRegistry;

- (void)reattachHandlersIfNeeded;
#else
- (nonnull instancetype)initWithUIManager:(nonnull RCTUIManager *)uiManager
                          eventDispatcher:(nonnull id<RCTEventDispatcherProtocol>)eventDispatcher;
#endif // RCT_NEW_ARCH_ENABLED

- (void)createGestureHandler:(nonnull NSString *)handlerName
                         tag:(nonnull NSNumber *)handlerTag
                      config:(nonnull NSDictionary *)config;

- (void)attachGestureHandler:(nonnull NSNumber *)handlerTag
               toViewWithTag:(nonnull NSNumber *)viewTag
              withActionType:(RNGestureHandlerActionType)actionType;

- (void)updateGestureHandler:(nonnull NSNumber *)handlerTag config:(nonnull NSDictionary *)config;

- (void)dropGestureHandler:(nonnull NSNumber *)handlerTag;

- (void)dropAllGestureHandlers;

/// The manager of the running module, or nil before the module exists (an app that never attached a handler).
+ (nullable RNGestureHandlerManager *)currentManager;

/// Gives `view`, which holds React Native's touch handler (or sits under a view that does), the root recognizer when a handler is
/// attached below it and the walk of `attachGestureHandler` could not reach one at that time: a screen that joins its window after
/// its handlers attached. The recognizer is registered here as any other, so `handleSetJSResponder:` and the activation callback reach it.
- (void)registerRootViewGestureRecognizerIfAttachedBelow:(nonnull RNGHUIView *)view;

- (void)handleSetJSResponder:(nonnull NSNumber *)viewTag blockNativeResponder:(BOOL)blockNativeResponder;

- (void)handleClearJSResponder;

- (nullable RNGestureHandler *)handlerWithTag:(nonnull NSNumber *)handlerTag;

@end
