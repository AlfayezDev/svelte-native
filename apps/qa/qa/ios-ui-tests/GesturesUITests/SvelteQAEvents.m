#import "SvelteQAEvents.h"
#import <UIKit/UIKit.h>
#include <math.h>

// The selectors of XCTest's event record (XCUIAutomation.framework, Xcode 26.5), declared so the compiler knows their types. The classes are
// looked up by name, so nothing links against a private symbol.
@interface NSObject (SvelteQAEventRecord)
- (instancetype)initForTouchAtPoint:(CGPoint)point offset:(double)offset;
- (void)moveToPoint:(CGPoint)point atOffset:(double)offset;
- (void)liftUpAtOffset:(double)offset;
- (instancetype)initWithName:(NSString *)name interfaceOrientation:(UIInterfaceOrientation)orientation;
- (void)addPointerEventPath:(id)path;
- (BOOL)synthesizeWithError:(NSError **)error;
@end

@implementation SvelteQAEvents

+ (BOOL)dragFrom:(CGPoint)from to:(CGPoint)to press:(NSTimeInterval)press duration:(NSTimeInterval)duration error:(NSError **)error {
  Class pathClass = NSClassFromString(@"XCPointerEventPath");
  Class recordClass = NSClassFromString(@"XCSynthesizedEventRecord");
  // Every selector is checked before the first is sent: an XCTest that lacks one fails the step with these words, not with an exception in the runner.
  BOOL complete = pathClass != Nil && recordClass != Nil && [pathClass instancesRespondToSelector:@selector(initForTouchAtPoint:offset:)] &&
                  [pathClass instancesRespondToSelector:@selector(moveToPoint:atOffset:)] && [pathClass instancesRespondToSelector:@selector(liftUpAtOffset:)] &&
                  [recordClass instancesRespondToSelector:@selector(initWithName:interfaceOrientation:)] &&
                  [recordClass instancesRespondToSelector:@selector(addPointerEventPath:)] && [recordClass instancesRespondToSelector:@selector(synthesizeWithError:)];
  if (!complete) {
    if (error != NULL) {
      NSString *reason = @"this XCTest lacks XCPointerEventPath or XCSynthesizedEventRecord, or one of the selectors used here; `--edge-release eased` runs XCUITest's own drag";
      *error = [NSError errorWithDomain:@"SvelteQAEvents" code:1 userInfo:@{NSLocalizedDescriptionKey : reason}];
    }
    return NO;
  }
  id path = [[pathClass alloc] initForTouchAtPoint:from offset:0];
  [path moveToPoint:from atOffset:press];
  NSInteger steps = MAX((NSInteger)1, (NSInteger)ceil(duration * 60.0));
  for (NSInteger step = 1; step <= steps; step++) {
    double fraction = (double)step / (double)steps;
    CGPoint point = CGPointMake(from.x + (to.x - from.x) * fraction, from.y + (to.y - from.y) * fraction);
    [path moveToPoint:point atOffset:press + duration * fraction];
  }
  // The lift has the last move's time: nothing slows the finger before it leaves the glass.
  [path liftUpAtOffset:press + duration];
  id record = [[recordClass alloc] initWithName:@"svelte-qa drag" interfaceOrientation:UIInterfaceOrientationPortrait];
  [record addPointerEventPath:path];
  return [record synthesizeWithError:error];
}

@end
