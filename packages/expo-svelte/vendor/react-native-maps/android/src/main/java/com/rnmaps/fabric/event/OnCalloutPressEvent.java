package com.rnmaps.fabric.event;

import com.facebook.react.bridge.WritableMap;
import com.facebook.react.uimanager.events.Event;

public class OnCalloutPressEvent extends Event<OnCalloutPressEvent> {
    public static final String EVENT_NAME = "topCalloutPress";

    private final WritableMap payload;

    public OnCalloutPressEvent(int surfaceId, int viewId, WritableMap payload) {
        super(surfaceId, viewId);
        this.payload = payload;
    }

    @Override
    public String getEventName() {
        return EVENT_NAME;
    }

    @Override
    public WritableMap getEventData() {
        return payload;
    }

    // Each callout press is a user act (the map's tag and the marker's both get one). The event queue replaces the unread
    // coalescable event of the same name for the same view, so a busy JavaScript thread would see only the last of them.
    @Override
    public boolean canCoalesce() {
        return false;
    }
}
