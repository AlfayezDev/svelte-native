package com.airbnb.android.react.lottie

import com.facebook.react.bridge.Arguments
import com.facebook.react.bridge.WritableMap
import com.facebook.react.uimanager.events.Event

class OnAnimationFinishEvent
constructor(surfaceId: Int, viewId: Int, private val isCancelled: Boolean) :
    Event<OnAnimationFinishEvent>(surfaceId, viewId) {

    override fun getEventName(): String {
        return EVENT_NAME
    }

    override fun getCoalescingKey(): Short = 0

    override fun getEventData(): WritableMap? {
        val event = Arguments.createMap()
        event.putBoolean("isCancelled", isCancelled)
        return event
    }

    // One per animation that ended or was cancelled, with `isCancelled`: two cancels, or a cancel and the end of the next
    // play, are separate messages. The event queue replaces the unread coalescable event of the same name for the same view,
    // so a busy JavaScript thread would see only the last of them.
    override fun canCoalesce(): Boolean = false

    companion object {
        const val EVENT_NAME = "topAnimationFinish"
    }
}