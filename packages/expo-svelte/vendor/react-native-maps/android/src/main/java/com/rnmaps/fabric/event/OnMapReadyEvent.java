package com.rnmaps.fabric.event;

import androidx.annotation.NonNull;

import com.facebook.react.bridge.WritableMap;
import com.facebook.react.uimanager.events.Event;


public class OnMapReadyEvent extends Event<OnMapReadyEvent> {
    public static final String EVENT_NAME = "topMapReady";

    private final WritableMap payload;

    public OnMapReadyEvent(int surfaceId, int viewId, WritableMap payload) {
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

    // Sent once, when the Google map is ready. The event queue replaces the unread coalescable event of the same name for the
    // same view, so a busy JavaScript thread would see only the last of them.
    @Override
    public boolean canCoalesce() {
        return false;
    }
}
