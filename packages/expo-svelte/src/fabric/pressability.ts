/**
 * A port of React Native's `Pressability` (Libraries/Pressability/Pressability.js) without React.
 * The state machine, timers and press-rect rules are the original's; hover, focus, the touch sound and the
 * performance emitter are left out, and `UIManager.measure` is replaced by the `measure` the host supplies.
 */
export type PressEvent = {
  nativeEvent: Record<string, unknown> & { pageX?: number; pageY?: number; touches?: { pageX: number; pageY: number }[]; changedTouches?: { pageX: number; pageY: number }[]; timestamp?: number };
  target?: unknown;
  currentTarget?: unknown;
  timeStamp?: number;
  persist(): void;
  stopPropagation(): void;
  preventDefault(): void;
};
type Rect = { top?: number; left?: number; right?: number; bottom?: number };
type RectOrSize = number | Rect;
export type Measure = (callback: (x: number, y: number, width: number, height: number, pageX: number, pageY: number) => void) => void;

export type PressabilityConfig = {
  cancelable?: boolean | null;
  disabled?: boolean | null;
  hitSlop?: RectOrSize | null;
  pressRectOffset?: RectOrSize | null;
  delayLongPress?: number | null;
  delayPressIn?: number | null;
  delayPressOut?: number | null;
  minPressDuration?: number | null;
  android_disableSound?: boolean | null;
  /** React Native's Pressable alias for `delayPressIn`. */
  unstable_pressDelay?: number | null;
  onPress?: ((event: PressEvent) => void) | null;
  onPressIn?: ((event: PressEvent) => void) | null;
  onPressOut?: ((event: PressEvent) => void) | null;
  onPressMove?: ((event: PressEvent) => void) | null;
  onLongPress?: ((event: PressEvent) => void) | null;
  /** Svelte convenience: `true` when the press becomes active, `false` when it ends (after `delayPressOut`). */
  onPressChange?: ((pressed: boolean) => void) | null;
};

export type ResponderHandlers = {
  onStartShouldSetResponder(): boolean;
  onResponderGrant(event: PressEvent): void;
  onResponderMove(event: PressEvent): void;
  onResponderRelease(event: PressEvent): void;
  onResponderTerminate(event: PressEvent): void;
  onResponderTerminationRequest(): boolean;
  onClick(event: PressEvent): void;
};

type TouchState =
  | "NOT_RESPONDER" | "RESPONDER_INACTIVE_PRESS_IN" | "RESPONDER_INACTIVE_PRESS_OUT" | "RESPONDER_ACTIVE_PRESS_IN"
  | "RESPONDER_ACTIVE_PRESS_OUT" | "RESPONDER_ACTIVE_LONG_PRESS_IN" | "RESPONDER_ACTIVE_LONG_PRESS_OUT" | "ERROR";
type Signal = "DELAY" | "RESPONDER_GRANT" | "RESPONDER_RELEASE" | "RESPONDER_TERMINATED" | "ENTER_PRESS_RECT" | "LEAVE_PRESS_RECT" | "LONG_PRESS_DETECTED";

const Transitions: Record<TouchState, Record<Signal, TouchState>> = {
  NOT_RESPONDER: { DELAY: "ERROR", RESPONDER_GRANT: "RESPONDER_INACTIVE_PRESS_IN", RESPONDER_RELEASE: "ERROR", RESPONDER_TERMINATED: "ERROR", ENTER_PRESS_RECT: "ERROR", LEAVE_PRESS_RECT: "ERROR", LONG_PRESS_DETECTED: "ERROR" },
  RESPONDER_INACTIVE_PRESS_IN: { DELAY: "RESPONDER_ACTIVE_PRESS_IN", RESPONDER_GRANT: "ERROR", RESPONDER_RELEASE: "NOT_RESPONDER", RESPONDER_TERMINATED: "NOT_RESPONDER", ENTER_PRESS_RECT: "RESPONDER_INACTIVE_PRESS_IN", LEAVE_PRESS_RECT: "RESPONDER_INACTIVE_PRESS_OUT", LONG_PRESS_DETECTED: "ERROR" },
  RESPONDER_INACTIVE_PRESS_OUT: { DELAY: "RESPONDER_ACTIVE_PRESS_OUT", RESPONDER_GRANT: "ERROR", RESPONDER_RELEASE: "NOT_RESPONDER", RESPONDER_TERMINATED: "NOT_RESPONDER", ENTER_PRESS_RECT: "RESPONDER_INACTIVE_PRESS_IN", LEAVE_PRESS_RECT: "RESPONDER_INACTIVE_PRESS_OUT", LONG_PRESS_DETECTED: "ERROR" },
  RESPONDER_ACTIVE_PRESS_IN: { DELAY: "ERROR", RESPONDER_GRANT: "ERROR", RESPONDER_RELEASE: "NOT_RESPONDER", RESPONDER_TERMINATED: "NOT_RESPONDER", ENTER_PRESS_RECT: "RESPONDER_ACTIVE_PRESS_IN", LEAVE_PRESS_RECT: "RESPONDER_ACTIVE_PRESS_OUT", LONG_PRESS_DETECTED: "RESPONDER_ACTIVE_LONG_PRESS_IN" },
  RESPONDER_ACTIVE_PRESS_OUT: { DELAY: "ERROR", RESPONDER_GRANT: "ERROR", RESPONDER_RELEASE: "NOT_RESPONDER", RESPONDER_TERMINATED: "NOT_RESPONDER", ENTER_PRESS_RECT: "RESPONDER_ACTIVE_PRESS_IN", LEAVE_PRESS_RECT: "RESPONDER_ACTIVE_PRESS_OUT", LONG_PRESS_DETECTED: "ERROR" },
  RESPONDER_ACTIVE_LONG_PRESS_IN: { DELAY: "ERROR", RESPONDER_GRANT: "ERROR", RESPONDER_RELEASE: "NOT_RESPONDER", RESPONDER_TERMINATED: "NOT_RESPONDER", ENTER_PRESS_RECT: "RESPONDER_ACTIVE_LONG_PRESS_IN", LEAVE_PRESS_RECT: "RESPONDER_ACTIVE_LONG_PRESS_OUT", LONG_PRESS_DETECTED: "RESPONDER_ACTIVE_LONG_PRESS_IN" },
  RESPONDER_ACTIVE_LONG_PRESS_OUT: { DELAY: "ERROR", RESPONDER_GRANT: "ERROR", RESPONDER_RELEASE: "NOT_RESPONDER", RESPONDER_TERMINATED: "NOT_RESPONDER", ENTER_PRESS_RECT: "RESPONDER_ACTIVE_LONG_PRESS_IN", LEAVE_PRESS_RECT: "RESPONDER_ACTIVE_LONG_PRESS_OUT", LONG_PRESS_DETECTED: "ERROR" },
  ERROR: { DELAY: "NOT_RESPONDER", RESPONDER_GRANT: "RESPONDER_INACTIVE_PRESS_IN", RESPONDER_RELEASE: "NOT_RESPONDER", RESPONDER_TERMINATED: "NOT_RESPONDER", ENTER_PRESS_RECT: "NOT_RESPONDER", LEAVE_PRESS_RECT: "NOT_RESPONDER", LONG_PRESS_DETECTED: "NOT_RESPONDER" },
};

const isActiveSignal = (s: TouchState) => s === "RESPONDER_ACTIVE_PRESS_IN" || s === "RESPONDER_ACTIVE_LONG_PRESS_IN";
const isActivationSignal = (s: TouchState) => s === "RESPONDER_ACTIVE_PRESS_OUT" || s === "RESPONDER_ACTIVE_PRESS_IN";
const isPressInSignal = (s: TouchState) => s === "RESPONDER_INACTIVE_PRESS_IN" || s === "RESPONDER_ACTIVE_PRESS_IN" || s === "RESPONDER_ACTIVE_LONG_PRESS_IN";
const isTerminalSignal = (s: Signal) => s === "RESPONDER_TERMINATED" || s === "RESPONDER_RELEASE";

const DEFAULT_LONG_PRESS_DELAY_MS = 500;
const DEFAULT_PRESS_RECT_OFFSETS = { bottom: 30, left: 20, right: 20, top: 20 };
const DEFAULT_MIN_PRESS_DURATION = 130;
let longPressDeactivationDistance = 10;

const normalizeDelay = (delay: number | null | undefined, min = 0, fallback = 0) => Math.max(min, delay ?? fallback);
const normalizeRect = (rect: RectOrSize | null | undefined): Rect | null => (typeof rect === "number" ? { bottom: rect, left: rect, right: rect, top: rect } : rect ?? null);

function touchOf(event: PressEvent): { pageX: number; pageY: number } {
  const { changedTouches, touches } = event.nativeEvent;
  if (touches?.length) return touches[0] as { pageX: number; pageY: number };
  if (changedTouches?.length) return changedTouches[0] as { pageX: number; pageY: number };
  return event.nativeEvent as { pageX: number; pageY: number };
}

export class Pressability {
  private config: PressabilityConfig;
  private handlers: ResponderHandlers | null = null;
  private longPressTimeout: ReturnType<typeof setTimeout> | null = null;
  private pressDelayTimeout: ReturnType<typeof setTimeout> | null = null;
  private pressOutTimeout: ReturnType<typeof setTimeout> | null = null;
  private responding = false;
  private region: { bottom: number; left: number; right: number; top: number } | null = null;
  private activatePosition: { pageX: number; pageY: number } | null = null;
  private activateTime: number | null = null;
  private state: TouchState = "NOT_RESPONDER";

  constructor(config: PressabilityConfig, private readonly measure: Measure) { this.config = config; }

  configure(config: PressabilityConfig): void { this.config = config; }

  /** Cancels every timer and drops the configuration, as React Native does when the component unmounts. */
  reset(): void {
    this.cancelLongPress(); this.cancelPressDelay(); this.cancelPressOut();
    this.config = {};
    this.state = "NOT_RESPONDER";
    this.responding = false;
  }

  static setLongPressDeactivationDistance(distance: number): void { longPressDeactivationDistance = distance; }

  getEventHandlers(): ResponderHandlers {
    if (this.handlers) return this.handlers;
    this.handlers = {
      onStartShouldSetResponder: () => !this.config.disabled,
      onResponderGrant: (event) => {
        this.cancelPressOut();
        this.responding = true;
        this.state = "NOT_RESPONDER";
        this.receive("RESPONDER_GRANT", event);
        const delayPressIn = normalizeDelay(this.config.delayPressIn ?? this.config.unstable_pressDelay);
        if (delayPressIn > 0) this.pressDelayTimeout = setTimeout(() => this.receive("DELAY", event), delayPressIn);
        else this.receive("DELAY", event);
        const delayLongPress = normalizeDelay(this.config.delayLongPress, 10, DEFAULT_LONG_PRESS_DELAY_MS - delayPressIn);
        this.longPressTimeout = setTimeout(() => this.handleLongPress(event), delayLongPress + delayPressIn);
      },
      onResponderMove: (event) => {
        this.config.onPressMove?.(event);
        const region = this.region;
        if (!region) return;
        const touch = touchOf(event);
        if (!touch) { this.cancelLongPress(); this.receive("LEAVE_PRESS_RECT", event); return; }
        if (this.activatePosition) {
          const dx = this.activatePosition.pageX - touch.pageX;
          const dy = this.activatePosition.pageY - touch.pageY;
          if (Math.hypot(dx, dy) > longPressDeactivationDistance) this.cancelLongPress();
        }
        if (this.within(touch, region)) this.receive("ENTER_PRESS_RECT", event);
        else { this.cancelLongPress(); this.receive("LEAVE_PRESS_RECT", event); }
      },
      onResponderRelease: (event) => this.receive("RESPONDER_RELEASE", event),
      onResponderTerminate: (event) => this.receive("RESPONDER_TERMINATED", event),
      onResponderTerminationRequest: () => this.config.cancelable ?? true,
      // Accessibility click (TalkBack/VoiceOver activate): a real touch never produces one.
      onClick: (event) => { if (this.config.onPress && this.config.disabled !== true) this.config.onPress(event); },
    };
    return this.handlers;
  }

  private receive(signal: Signal, event: PressEvent): void {
    const prev = this.state;
    const next = Transitions[prev][signal];
    if (!this.responding && signal === "RESPONDER_RELEASE") return;
    if (next === "ERROR") return; // React Native throws an invariant here; a host must not crash the app on a stray event
    if (prev !== next) {
      this.sideEffects(prev, next, signal, event);
      this.state = next;
    }
  }

  private sideEffects(prev: TouchState, next: TouchState, signal: Signal, event: PressEvent): void {
    if (isTerminalSignal(signal)) { this.activatePosition = null; this.cancelLongPress(); }
    const initial = prev === "NOT_RESPONDER" && next === "RESPONDER_INACTIVE_PRESS_IN";
    const activation = !isActivationSignal(prev) && isActivationSignal(next);
    if (initial || activation) this.measureRegion();
    if (isPressInSignal(prev) && signal === "LONG_PRESS_DETECTED") this.config.onLongPress?.(event);
    const prevActive = isActiveSignal(prev);
    const nextActive = isActiveSignal(next);
    if (!prevActive && nextActive) this.activate(event);
    else if (prevActive && !nextActive) this.deactivate(event);
    if (isPressInSignal(prev) && signal === "RESPONDER_RELEASE") {
      if (!nextActive && !prevActive) { this.activate(event); this.deactivate(event); }
      const { onLongPress, onPress } = this.config;
      if (onPress) {
        // The long press consumes the press only when there is an `onLongPress` to receive it.
        const canceledByLongPress = onLongPress != null && prev === "RESPONDER_ACTIVE_LONG_PRESS_IN";
        if (!canceledByLongPress) onPress(event);
      }
    }
    this.cancelPressDelay();
  }

  private activate(event: PressEvent): void {
    const { pageX, pageY } = touchOf(event);
    this.activatePosition = { pageX, pageY };
    this.activateTime = Date.now();
    this.config.onPressChange?.(true);
    this.config.onPressIn?.(event);
  }

  private deactivate(event: PressEvent): void {
    const { onPressOut, onPressChange } = this.config;
    if (onPressOut || onPressChange) {
      const minPressDuration = normalizeDelay(this.config.minPressDuration, 0, DEFAULT_MIN_PRESS_DURATION);
      const pressDuration = Date.now() - (this.activateTime ?? 0);
      const delay = Math.max(minPressDuration - pressDuration, normalizeDelay(this.config.delayPressOut));
      const finish = () => { onPressOut?.(event); onPressChange?.(false); };
      if (delay > 0) this.pressOutTimeout = setTimeout(finish, delay);
      else finish();
    }
    this.activateTime = null;
  }

  private measureRegion(): void {
    if (!this.responding) return;
    this.measure((_left, _top, width, height, pageX, pageY) => {
      if (!_left && !_top && !width && !height && !pageX && !pageY) return;
      this.region = { bottom: pageY + height, left: pageX, right: pageX + width, top: pageY };
    });
  }

  private within(touch: { pageX: number; pageY: number }, region: { bottom: number; left: number; right: number; top: number }): boolean {
    const hitSlop = normalizeRect(this.config.hitSlop);
    const offset = normalizeRect(this.config.pressRectOffset);
    let { bottom, left, right, top } = region;
    if (hitSlop) { bottom += hitSlop.bottom ?? 0; left -= hitSlop.left ?? 0; right += hitSlop.right ?? 0; top -= hitSlop.top ?? 0; }
    bottom += offset?.bottom ?? DEFAULT_PRESS_RECT_OFFSETS.bottom;
    left -= offset?.left ?? DEFAULT_PRESS_RECT_OFFSETS.left;
    right += offset?.right ?? DEFAULT_PRESS_RECT_OFFSETS.right;
    top -= offset?.top ?? DEFAULT_PRESS_RECT_OFFSETS.top;
    return touch.pageX > left && touch.pageX < right && touch.pageY > top && touch.pageY < bottom;
  }

  private handleLongPress(event: PressEvent): void {
    if (this.state === "RESPONDER_ACTIVE_PRESS_IN" || this.state === "RESPONDER_ACTIVE_LONG_PRESS_IN") this.receive("LONG_PRESS_DETECTED", event);
  }

  private cancelLongPress(): void { if (this.longPressTimeout != null) { clearTimeout(this.longPressTimeout); this.longPressTimeout = null; } }
  private cancelPressDelay(): void { if (this.pressDelayTimeout != null) { clearTimeout(this.pressDelayTimeout); this.pressDelayTimeout = null; } }
  private cancelPressOut(): void { if (this.pressOutTimeout != null) { clearTimeout(this.pressOutTimeout); this.pressOutTimeout = null; } }
}
