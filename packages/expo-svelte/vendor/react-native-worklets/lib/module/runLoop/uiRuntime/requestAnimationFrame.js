'use strict';

export function setupRequestAnimationFrame() {
  'worklet';

  let queuedCallbacks = [];
  let queuedCallbacksBegin = 0;
  let queuedCallbacksEnd = 0;
  let flushedCallbacks = queuedCallbacks;
  let flushedCallbacksBegin = 0;
  let flushedCallbacksEnd = 0;
  let queuedFinalizers = [];
  function executeQueue(timestamp) {
    flushedCallbacks = queuedCallbacks;
    queuedCallbacks = [];
    flushedCallbacksBegin = queuedCallbacksBegin;
    flushedCallbacksEnd = queuedCallbacksEnd;
    queuedCallbacksBegin = queuedCallbacksEnd;
    if (flushedCallbacks.length > 0) {
      for (const callback of flushedCallbacks) {
        callback(timestamp);
        globalThis.__drainMicrotasks();
      }
    } else {
      globalThis.__drainMicrotasks();
    }
    flushedCallbacksBegin = flushedCallbacksEnd;
    const finalizers = queuedFinalizers;
    queuedFinalizers = [];
    for (const finalizer of finalizers) {
      finalizer();
    }
  }
  // expo-svelte patch: a native frame is requested only while something waits for one (see src/runLoop/uiRuntime/requestAnimationFrame.ts).
  let frameRequested = false;
  function requestFrame() {
    if (!frameRequested) {
      frameRequested = true;
      globalThis.__nativeRequestAnimationFrame(nativeFlushQueue);
    }
  }
  function requestAnimationFrame(callback) {
    const handle = queuedCallbacksEnd++;
    queuedCallbacks.push(callback);
    requestFrame();
    return handle;
  }
  function cancelAnimationFrame(handle) {
    if (handle < flushedCallbacksBegin || handle >= queuedCallbacksEnd) {
      return;
    }
    if (handle < flushedCallbacksEnd) {
      flushedCallbacks[handle - flushedCallbacksBegin] = () => {};
    } else {
      queuedCallbacks[handle - queuedCallbacksBegin] = () => {};
    }
  }
  function nativeFlushQueue(timestamp) {
    frameRequested = false;
    flushQueue(timestamp);

    /* Schedule next frame only if a callback or finalizer was queued during this one */
    if (queuedCallbacks.length > 0 || queuedFinalizers.length > 0) {
      requestFrame();
    }
  }
  function flushQueue(timestamp) {
    globalThis.__frameTimestamp = timestamp;
    executeQueue(timestamp);
    globalThis.__frameTimestamp = undefined;
  }
  globalThis.requestAnimationFrame = requestAnimationFrame;
  globalThis.cancelAnimationFrame = cancelAnimationFrame;
  globalThis.requestAnimationFrameFinalizer = callback => {
    queuedFinalizers.push(callback);
    requestFrame();
  };

  // TODO: Remove it after support for Reanimated 4.3 is dropped.
  globalThis.__flushAnimationFrame = eventTimestamp => {
    flushQueue(eventTimestamp);
  };
}
//# sourceMappingURL=requestAnimationFrame.js.map