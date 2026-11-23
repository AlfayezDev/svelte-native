#import "QuickBase64Module.h"
#import <React/RCTBridge+Private.h>
#import <React/RCTUtils.h>
#import "../cpp/react-native-quick-base64.h"

// React Native 0.88 has no RCTCxxBridge. The bridge a module is given is the bridgeless RCTBridgeProxy, which still answers `runtime`.
@protocol QuickBase64RuntimeOwner
- (void *)runtime;
@end

@implementation QuickBase64Module

@synthesize bridge = _bridge;
@synthesize methodQueue = _methodQueue;

RCT_EXPORT_MODULE(QuickBase64)

+ (BOOL)requiresMainQueueSetup {
  return YES;
}

- (void)setBridge:(RCTBridge *)bridge {
  _bridge = bridge;
  _setBridgeOnMainQueue = RCTIsMainQueue();
}

RCT_EXPORT_BLOCKING_SYNCHRONOUS_METHOD(install) {
  void *runtime = _bridge != nil ? [(id<QuickBase64RuntimeOwner>)_bridge runtime] : nullptr;
  if (runtime == nullptr) {
    NSLog(@"[QuickBase64] Could not access JSI runtime");
    return @false;
  }

  @try {
    NSLog(@"[QuickBase64] Installing JSI bindings...");
    installBase64(*(facebook::jsi::Runtime *)runtime);
    NSLog(@"[QuickBase64] JSI bindings installed");
    return @true;
  } @catch (NSException *exception) {
    NSLog(@"[QuickBase64] Failed to install: %@", exception.reason);
    return @false;
  }
}

- (void)invalidate {
  cleanupBase64();
}

@end
