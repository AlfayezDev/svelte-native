package com.rnmaps.fabric.event;

import androidx.annotation.NonNull;

import com.facebook.react.bridge.WritableMap;
import com.facebook.react.uimanager.events.Event;

public class OnDragStartEvent extends Event<OnDragStartEvent> {
    public static final String EVENT_NAME = "topDragStart";

    private final WritableMap payload;

    public OnDragStartEvent(int surfaceId, int viewId, WritableMap payload) {
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

    // It starts a drag, with the coordinate the marker was picked up at, and is not one of a stream. The event queue replaces
    // the unread coalescable event of the same name for the same view, so a busy JavaScript thread would see only the last of
    // them.
    @Override
    public boolean canCoalesce() {
        return false;
    }
}
