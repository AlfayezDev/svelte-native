package com.rnmaps.fabric.event;

import androidx.annotation.NonNull;

import com.facebook.react.bridge.WritableMap;
import com.facebook.react.bridge.WritableNativeMap;
import com.facebook.react.uimanager.events.Event;
import com.google.android.gms.maps.model.LatLng;
import com.google.android.gms.maps.model.LatLngBounds;

public class OnRegionChangeStartEvent extends Event<OnRegionChangeStartEvent> {
  public static final String EVENT_NAME = "topRegionChangeStart";

  private final WritableMap payload;

  public OnRegionChangeStartEvent(int surfaceId, int viewId, WritableMap payload) {
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

  // One per camera move, with the `isGesture` of that move. The event queue replaces the unread coalescable event of the same
  // name for the same view, so a busy JavaScript thread would see only the last of them.
  @Override
  public boolean canCoalesce() {
    return false;
  }
}
