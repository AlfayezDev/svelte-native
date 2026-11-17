package expo.modules.sveltepush

import com.google.firebase.messaging.FirebaseMessagingService
import com.google.firebase.messaging.RemoteMessage

/**
 * Firebase's receiver of the app's messages and token changes, declared in this library's manifest. This is the skeleton, whose overrides do nothing; phase 2 of
 * the plan (Android native) fills it: `onNewToken` reports the new token to the module, and `onMessageReceived` hands the message to the module, which shows it,
 * or runs the app's background hook and keeps the process for it (PUSH.md, "Android").
 */
class SveltePushMessagingService : FirebaseMessagingService() {
  override fun onNewToken(token: String) {}

  override fun onMessageReceived(message: RemoteMessage) {}
}
