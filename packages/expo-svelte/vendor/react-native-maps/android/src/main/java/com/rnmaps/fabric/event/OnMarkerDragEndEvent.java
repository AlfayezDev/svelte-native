package com.rnmaps.fabric.event;

import androidx.annotation.NonNull;

import com.facebook.react.bridge.WritableMap;
import com.facebook.react.uimanager.events.Event;

public class OnMarkerDragEndEvent extends Event<OnMarkerDragEndEvent> {
    public static final String EVENT_NAME = "topMarkerDragEnd";

    private final WritableMap payload;

    public OnMarkerDragEndEvent(int surfaceId, int viewId, WritableMap payload) {
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

    // It ends a drag (the map's copy, with the marker's `id`): where the marker was dropped must reach JavaScript. The event
    // queue replaces the unread coalescable event of the same name for the same view, so a busy JavaScript thread would see
    // only the last of them.
    @Override
    public boolean canCoalesce() {
        return false;
    }
}
