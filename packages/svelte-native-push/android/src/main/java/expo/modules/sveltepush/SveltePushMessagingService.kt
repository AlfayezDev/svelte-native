package expo.modules.sveltepush

import android.util.Log
import com.google.firebase.messaging.FirebaseMessagingService
import com.google.firebase.messaging.RemoteMessage
import java.util.UUID

/**
 * Firebase's receiver of the app's messages and token changes, declared in this library's manifest. It holds no state: the events, the waits and the foreground count
 * are `PushRuntime`'s, because a message can start the process before there is a module, and what is decided is `PushDelivery`'s and `PushRules`'s.
 *
 * Which messages come here: every data message, and a notification message only while Firebase thinks the app is in the foreground (in the background the system shows
 * it and never calls this). Foreground is decided here by the count of started Activities (`ForegroundTracker`), not by Firebase's own check.
 */
class SveltePushMessagingService : FirebaseMessagingService() {
  override fun onCreate() {
    super.onCreate()
    PushRuntime.install(application)
    // A notification the system shows in the background goes to the manifest's default channel, which must exist by then or Firebase uses its own "Miscellaneous".
    PushNotifier.ensureChannel(applicationContext)
  }

  // Firebase 25.1 deprecated `onNewToken` for `onRegistered`, which it calls only when the app opts into the new registration with the meta-data
  // `firebase_messaging_installation_id_enabled`; without it (the default, which nothing in this library sets) `onNewToken` is the callback.
  @Suppress("OVERRIDE_DEPRECATION")
  override fun onNewToken(token: String) {
    PushRuntime.events.emit("token", PushToken(token, packageName).toMap())
  }

  /** On Firebase's worker thread; it returns only when the message has been dealt with (see `PushDelivery`), which keeps the process alive meanwhile. */
  override fun onMessageReceived(message: RemoteMessage) {
    val notification = message.notification
    val pushMessage = PushMapping.fromRemote(message.messageId, notification?.title, notification?.body, message.data) { UUID.randomUUID().toString() }
    val delivery = PushDelivery(
      PushRuntime.events,
      PushRuntime.shows,
      PushRuntime.waits,
      post = { shown, presentation -> PushNotifier.post(applicationContext, shown, presentation) },
      log = { Log.w(LOG_TAG, it) },
    )
    delivery.deliver(pushMessage, PushRuntime.foreground.isForeground(), notification != null)
  }
}
