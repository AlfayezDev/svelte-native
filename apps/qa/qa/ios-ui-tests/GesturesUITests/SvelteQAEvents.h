#import <Foundation/Foundation.h>
#import <CoreGraphics/CoreGraphics.h>

NS_ASSUME_NONNULL_BEGIN

/// A drag whose finger moves at one speed to its end point and lifts there while still moving, made with the event record XCTest builds
/// its own gestures from (`XCPointerEventPath`, `XCSynthesizedEventRecord`, private to XCTest and looked up at run time). This is the Swift
/// test's bridging header.
///
/// `XCUICoordinate.press(forDuration:thenDragTo:withVelocity:thenHoldForDuration:)` slows the finger down over the last frames of a drag (the
/// moves of 16.7 ms on the iPhone SE 3: 19, 18, 16.5, 15.5, 13 and 10 pt, then the lift), and when the last move falls short (4.5 pt) UIKit
/// treats the release of an edge swipe as a finger that stopped and cancels the pop at 68 to 71 % (SPEC.md, iOS contract item 3). A person's
/// swipe leaves the glass moving. The pushed-edge swipe of the gesture lab uses this one.
@interface SvelteQAEvents : NSObject

/// Touches down at `from`, holds still for `press` seconds, moves in a straight line to `to` over `duration` seconds at one speed (a point
/// every 60th of a second) and lifts at `to` at the moment it arrives. Points are the screen's, in portrait. Returns NO with an error when
/// this XCTest does not have the event record or could not perform it.
+ (BOOL)dragFrom:(CGPoint)from to:(CGPoint)to press:(NSTimeInterval)press duration:(NSTimeInterval)duration error:(NSError **)error;

@end

NS_ASSUME_NONNULL_END
