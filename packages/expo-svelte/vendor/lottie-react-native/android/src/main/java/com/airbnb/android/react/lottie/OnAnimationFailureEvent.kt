package com.airbnb.android.react.lottie

import com.facebook.react.bridge.Arguments
import com.facebook.react.bridge.WritableMap
import com.facebook.react.uimanager.events.Event

class OnAnimationFailureEvent
constructor(surfaceId: Int, viewId: Int, private val error: Throwable) :
    Event<OnAnimationFailureEvent>(surfaceId, viewId) {

    override fun getEventName(): String {
        return EVENT_NAME
    }

    override fun getCoalescingKey(): Short = 0

    override fun getEventData(): WritableMap? {
        val event = Arguments.createMap()
        event.putString("error", error.message)
        return event
    }

    // One per source that failed to load, with its message. The event queue replaces the unread coalescable event of the
    // same name for the same view, so a busy JavaScript thread would see only the last of them.
    override fun canCoalesce(): Boolean = false

    companion object {
        const val EVENT_NAME = "topAnimationFailure"
    }
}