package expo.modules.sveltepush

/** The notification channel the module creates and shows into, from the manifest meta-data the config plugin wrote (`capabilities.ts`: `pushMetaData`). */
data class ChannelSpec(val id: String, val name: String, val description: String?)

/**
 * What the module decides without Android: the permission's state, which way a message goes, and the channel. Plain Kotlin so that the host check
 * (`src/test/push.sh`) runs it.
 */
object PushRules {
  /** The meta-data names the config plugin writes (`pushMetaData` in `src/capabilities.ts`; the host check reads that file and compares). */
  const val META_CHANNEL_ID = "expo.modules.sveltepush.channel_id"
  const val META_CHANNEL_NAME = "expo.modules.sveltepush.channel_name"
  const val META_CHANNEL_DESCRIPTION = "expo.modules.sveltepush.channel_description"

  /** Firebase's own meta-data, read when this module shows a notification itself, as Firebase does when it shows one. */
  const val META_ICON = "com.google.firebase.messaging.default_notification_icon"
  const val META_COLOR = "com.google.firebase.messaging.default_notification_color"

  /** What `capabilities.ts` writes when the app names no channel (`defaultPushChannel`), and when meta-data is missing altogether. */
  const val DEFAULT_CHANNEL_ID = "default"
  const val DEFAULT_CHANNEL_NAME = "Notifications"

  /**
   * The state JavaScript reads from Expo's answer for `POST_NOTIFICATIONS` (Android 13 and later): `granted` for a granted permission, `denied` when the system will
   * not ask again, and `prompt` for every other state (never asked, or denied once and still askable). A permission that is granted while the app's notifications are
   * switched off is `denied`: nothing can be shown, and only the user's settings can change it.
   */
  fun permission(status: String, canAskAgain: Boolean, notificationsEnabled: Boolean): String = when (status) {
    "granted" -> if (notificationsEnabled) "granted" else "denied"
    "denied" -> if (canAskAgain) "prompt" else "denied"
    else -> "prompt"
  }

  /** Before Android 13 there is no permission to ask for: notifications are on or switched off in the settings, and the app cannot change that. */
  fun permissionWithoutRuntimeAsk(notificationsEnabled: Boolean): String = if (notificationsEnabled) "granted" else "denied"

  /** The channel from the manifest's meta-data (`read` is `Bundle.get(name)`): a number-looking id or name reads back as an Integer, so everything goes through `toString`. */
  fun channel(read: (String) -> Any?): ChannelSpec {
    fun text(name: String): String? = read(name)?.toString()?.takeIf { it.isNotBlank() }
    return ChannelSpec(text(META_CHANNEL_ID) ?: DEFAULT_CHANNEL_ID, text(META_CHANNEL_NAME) ?: DEFAULT_CHANNEL_NAME, text(META_CHANNEL_DESCRIPTION))
  }

  /** Which way a message that Firebase delivered goes, from where the app is and whether Firebase would have shown it itself. */
  enum class Route {
    /** The app is in the foreground: JavaScript hears it (`message`) and decides how it shows. */
    FOREGROUND,

    /** A notification message that reached `onMessageReceived` with the app away (Firebase thought the app was in the foreground at that moment, this did not): it shows now. */
    SHOW_NOW,

    /** A data message with the app away: the background hook runs, and this process is held for it. */
    BACKGROUND,
  }

  fun route(foreground: Boolean, hasNotification: Boolean): Route = when {
    foreground -> Route.FOREGROUND
    hasNotification -> Route.SHOW_NOW
    else -> Route.BACKGROUND
  }

  /**
   * The channel a notification this module shows goes to: the one the sender named when the device has it (`exists`), else the default. Firebase does the same for a
   * notification it shows itself ("if the channel does not exist, the manifest's default"), so the two look alike; a name the app never made must not be posted to, as
   * Android drops a notification for a channel that does not exist (from API 26).
   */
  fun channelFor(requested: String?, exists: (String) -> Boolean, default: String): String = requested?.takeIf { exists(it) } ?: default

  /** Whether `show` posts anything: not when the hook said `banner: false`, and not for a message that is data only. */
  fun shouldPost(message: PushMessage, presentation: Presentation): Boolean = presentation.banner && message.hasContent
}
