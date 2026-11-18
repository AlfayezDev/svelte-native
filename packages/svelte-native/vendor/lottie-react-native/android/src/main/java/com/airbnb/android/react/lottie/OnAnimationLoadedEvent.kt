package com.airbnb.android.react.lottie

import com.facebook.react.bridge.Arguments
import com.facebook.react.bridge.WritableMap
import com.facebook.react.uimanager.events.Event

class OnAnimationLoadedEvent constructor(surfaceId: Int, viewId: Int) :
    Event<OnAnimationLoadedEvent>(surfaceId, viewId) {

    override fun getEventName(): String {
        return EVENT_NAME
    }

    override fun getEventData(): WritableMap? {
        return Arguments.createMap()
    }

    // One per source that loaded: a handler that starts the animation when it hears of the load must hear of each one. The
    // event queue replaces the unread coalescable event of the same name for the same view, so a busy JavaScript thread
    // would see only the last of them.
    override fun canCoalesce(): Boolean = false

    companion object {
        const val EVENT_NAME = "topAnimationLoaded"
    }
}
