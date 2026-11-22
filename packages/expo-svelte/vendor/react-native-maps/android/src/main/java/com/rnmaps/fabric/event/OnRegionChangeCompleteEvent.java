package com.rnmaps.fabric.event;

import androidx.annotation.NonNull;

import com.facebook.react.bridge.WritableMap;
import com.facebook.react.uimanager.events.Event;

public class OnRegionChangeCompleteEvent extends Event<OnRegionChangeCompleteEvent> {
  public static final String EVENT_NAME = "topRegionChangeComplete";

  private final WritableMap payload;

  public OnRegionChangeCompleteEvent(int surfaceId, int viewId, WritableMap payload) {
    super(surfaceId, viewId);
    this.payload = payload;
  }

  @NonNull
  @Override
  public String getEventName() {
    return EVENT_NAME;
  }


  @Override
  protected WritableMap getEventData() {
    return payload;
  }

  // One per camera move, with the region it ended on: the message a handler waits for. The event queue replaces the unread
  // coalescable event of the same name for the same view, so a busy JavaScript thread would see only the last of them.
  @Override
  public boolean canCoalesce() {
    return false;
  }
}
