/**
 * Touch events as native sends them to the host's event handler: to the node the gesture's finger went down on, with the position in the page and in the node, the finger's
 * identifier and a clock that runs forward. A lifting event (`topTouchEnd`, `topTouchCancel`) has no touches left, as the platform's has.
 */
export type Emit = (target: unknown, type: string, event: object) => void;

/** The function a test sends touches with: `send(target, "topTouchStart", 50, 20)`. Every call of `touchSender` has a clock of its own. */
export function touchSender(emit: Emit): (target: unknown, type: string, x?: number, y?: number, identifier?: number) => void {
  let clock = 1000;
  return (target, type, x = 10, y = 10, identifier = 0) => {
    const touch = { pageX: x, pageY: y, locationX: x, locationY: y, identifier, target: 1, timestamp: clock++ };
    const lifting = type === "topTouchEnd" || type === "topTouchCancel";
    emit(target, type, { ...touch, touches: lifting ? [] : [touch], changedTouches: [touch] });
  };
}
