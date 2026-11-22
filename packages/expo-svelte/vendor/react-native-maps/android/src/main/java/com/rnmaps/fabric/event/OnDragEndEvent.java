package com.rnmaps.fabric.event;

import androidx.annotation.NonNull;

import com.facebook.react.bridge.WritableMap;
import com.facebook.react.uimanager.events.Event;

public class OnDragEndEvent extends Event<OnDragEndEvent> {
    public static final String EVENT_NAME = "topDragEnd";

    private final WritableMap payload;

    public OnDragEndEvent(int surfaceId, int viewId, WritableMap payload) {
        super(surfaceId, viewId);
        this.payload = payload;
    }

    @NonNull
    @Override
    public String getEventName() {
        return EVENT_NAME;
    }

    @Override
    public WritableMap getEventData() {
        return payload;
    }

    // It ends a drag, with the coordinate the marker was dropped at, and is not one of a stream. The event queue replaces the
    // unread coalescable event of the same name for the same view, so a busy JavaScript thread would see only the last of them.
    @Override
    public boolean canCoalesce() {
        return false;
    }
}
