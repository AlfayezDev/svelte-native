'use strict';

export function setupRequestAnimationFrame() {
  'worklet';
  const callMicrotasks = globalThis.__callMicrotasks;

  let queuedCallbacks: ((timestamp: number) => void)[] = [];
  let queuedCallbacksBegin = 0;
  let queuedCallbacksEnd = 0;

  let flushedCallbacks = queuedCallbacks;
  let flushedCallbacksBegin = 0;
  let flushedCallbacksEnd = 0;

  let queuedFinalizers: (() => void)[] = [];

  function executeQueue(timestamp: number) {
    flushedCallbacks = queuedCallbacks;
    queuedCallbacks = [];

    flushedCallbacksBegin = queuedCallbacksBegin;
    flushedCallbacksEnd = queuedCallbacksEnd;
    queuedCallbacksBegin = queuedCallbacksEnd;

    for (const callback of flushedCallbacks) {
      callback(timestamp);
    }

    flushedCallbacksBegin = flushedCallbacksEnd;

    callMicrotasks();

    const finalizers = queuedFinalizers;
    queuedFinalizers = [];
    for (const finalizer of finalizers) {
      finalizer();
    }
  }

  // Rasheed patch: a native frame is requested only while something waits for one. The upstream loop re-requests the
  // next frame from every `nativeFlushQueue`, forever, so once the UI runtime exists the main thread runs a Choreographer
  // callback, a JNI call and a Hermes call on every frame (0.3 to 0.45 ms on a Galaxy A16 at 90 Hz) with an empty queue.
  let frameRequested = false;
  function requestFrame() {
    if (!frameRequested) {
      frameRequested = true;
      globalThis.__nativeRequestAnimationFrame(nativeFlushQueue);
    }
  }

  function requestAnimationFrame(
    callback: (timestamp: number) => void
  ): number {
    const handle = queuedCallbacksEnd++;
    queuedCallbacks.push(callback);
    requestFrame();
    return handle;
  }

  function cancelAnimationFrame(handle: number) {
    if (handle < flushedCallbacksBegin || handle >= queuedCallbacksEnd) {
      return;
    }

    if (handle < flushedCallbacksEnd) {
      flushedCallbacks[handle - flushedCallbacksBegin] = () => {};
    } else {
      queuedCallbacks[handle - queuedCallbacksBegin] = () => {};
    }
  }

  function nativeFlushQueue(timestamp: number) {
    frameRequested = false;
    flushQueue(timestamp);

    /* Schedule next frame only if a callback or finalizer was queued during this one */
    if (queuedCallbacks.length > 0 || queuedFinalizers.length > 0) {
      requestFrame();
    }
  }

  function flushQueue(timestamp: number) {
    globalThis.__frameTimestamp = timestamp;
    executeQueue(timestamp);
    globalThis.__frameTimestamp = undefined;
  }

  globalThis.requestAnimationFrame = requestAnimationFrame;
  globalThis.cancelAnimationFrame =
    cancelAnimationFrame as typeof globalThis.cancelAnimationFrame;
  globalThis.requestAnimationFrameFinalizer = (callback: () => void) => {
    queuedFinalizers.push(callback);
    requestFrame();
  };

  // TODO: Remove it after support for Reanimated 4.3 is dropped.
  globalThis.__flushAnimationFrame = (eventTimestamp: number) => {
    flushQueue(eventTimestamp);
  };
}
