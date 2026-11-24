package com.swmansion.reanimated.keyboard

import com.facebook.react.bridge.ReactApplicationContext
import com.swmansion.reanimated.SvelteEngineHook
import java.lang.ref.WeakReference
import java.util.concurrent.ConcurrentHashMap

fun interface NotifyAboutKeyboardChangeFunction {
    fun call()
}

class KeyboardAnimationManager(
    reactContext: WeakReference<ReactApplicationContext>,
) {
    private var mNextListenerId = 0
    private val mListeners = ConcurrentHashMap<Int, KeyboardWorkletWrapper>()
    private val mKeyboard = Keyboard()
    private val mWindowsInsetsManager =
        WindowsInsetsManager(reactContext, mKeyboard, ::notifyAboutKeyboardChange)

    fun subscribeForKeyboardUpdates(
        callback: KeyboardWorkletWrapper,
        isStatusBarTranslucent: Boolean,
        isNavigationBarTranslucent: Boolean,
    ): Int {
        // Example patch: the svelte-engine module is the keyboard's source, frame by frame, and Reanimated's own window insets handling stays off.
        SvelteEngineHook.keyboardSubscribe?.let { subscribe -> return subscribe { state, height -> callback.invoke(state, height) } }
        val listenerId = mNextListenerId++
        if (mListeners.isEmpty()) {
            val keyboardAnimationCallback =
                KeyboardAnimationCallback(mKeyboard, ::notifyAboutKeyboardChange, isNavigationBarTranslucent)
            mWindowsInsetsManager.startObservingChanges(keyboardAnimationCallback, isStatusBarTranslucent, isNavigationBarTranslucent)
        }
        mListeners[listenerId] = callback
        return listenerId
    }

    fun unsubscribeFromKeyboardUpdates(listenerId: Int) {
        if (listenerId < 0) {
            SvelteEngineHook.keyboardUnsubscribe?.invoke(listenerId)
            return
        }
        mListeners.remove(listenerId)
        if (mListeners.isEmpty()) {
            mWindowsInsetsManager.stopObservingChanges()
        }
    }

    fun notifyAboutKeyboardChange() {
        for (listener in mListeners.values) {
            listener.invoke(mKeyboard.getState().asInt(), mKeyboard.getHeight())
        }
    }
}
