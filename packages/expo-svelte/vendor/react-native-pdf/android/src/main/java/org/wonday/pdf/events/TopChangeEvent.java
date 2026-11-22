package org.wonday.pdf.events;

import androidx.annotation.Nullable;

import com.facebook.react.bridge.WritableMap;
import com.facebook.react.uimanager.events.Event;

public class TopChangeEvent extends Event<TopChangeEvent> {
    private WritableMap eventData;

    public TopChangeEvent(int surfaceId, int viewTag, WritableMap data) {
        super(surfaceId, viewTag);
        eventData = data;
    }

    @Override
    public String getEventName() {
        return "topChange";
    }

    @Nullable
    @Override
    protected WritableMap getEventData() {
        return eventData;
    }

    // Every message of the view (loadComplete, pageChanged, scaleChanged, error, ...) is a "topChange" event. Fabric hands a coalescable event to
    // C++ as a unique one, and the event queue replaces the last unique event of the same type for the same view that JavaScript has not read yet:
    // with the JS thread busy, loadComplete and the pageChanged that follows it (PdfView delays it by 10 ms) reach JavaScript as pageChanged alone.
    @Override
    public boolean canCoalesce() {
        return false;
    }
}
