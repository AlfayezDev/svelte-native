package com.rnmaps.fabric.event;

import androidx.annotation.NonNull;

import com.facebook.react.bridge.WritableMap;
import com.facebook.react.uimanager.events.Event;

public class OnPressEvent extends Event<OnPressEvent> {
    public static final String EVENT_NAME = "topPress";
    private final WritableMap payload;

    public OnPressEvent(int surfaceId, int viewId, WritableMap payload) {
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

    // The map's tag gets press, marker-press, polygon-press, polyline-press, overlay-press and callout-press as this one event,
    // told apart by `action` and the coordinate, and each press is a user act. The event queue replaces the unread coalescable
    // event of the same name for the same view, so a busy JavaScript thread would see only the last of them.
    @Override
    public boolean canCoalesce() {
        return false;
    }
}
