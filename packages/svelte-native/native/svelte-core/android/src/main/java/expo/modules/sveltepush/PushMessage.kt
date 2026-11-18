package expo.modules.sveltepush

/** The provider Android's messages come from: Firebase Cloud Messaging, whose name is `PushMessage.provider` and `PushToken.provider` in JavaScript (`src/push/types.ts`). */
const val PROVIDER_FCM = "fcm"

/**
 * A message as JavaScript receives it (`PushMessage` of `src/push/types.ts`), without any Android type, so that the host check (`src/test/push.sh`) runs everything
 * that builds, maps and routes one.
 */
data class PushMessage(
  /** FCM's message id, or one made on the device when the provider gave none (`PushMapping.fromRemote`). It is what a tap, `show` and the de-duplication of taps know a message by. */
  val id: String,
  val title: String? = null,
  val body: String? = null,
  /** The link a tap opens, from the sender's `url`; it is not among `data`, as the sender refuses a `url` given twice. */
  val url: String? = null,
  val data: Map<String, String> = emptyMap(),
  val provider: String = PROVIDER_FCM,
  /**
   * The notification channel the sender named (`PushSend.channel`, FCM's `android.notification.channel_id`), for the notification this module shows itself. It is the
   * device's business and not part of the message JavaScript is given, so [toMap] leaves it out and the extras of a `PendingIntent` do not carry it.
   */
  val channelId: String? = null,
) {
  /**
   * What the Expo module hands to JavaScript (`PushMessage` of `src/push/types.ts`: not [channelId]). A member the sender did not give is left out, not sent as null, because `title`, `body` and `url` are optional members
   * of the TypeScript type and JavaScript reads `undefined` for them.
   */
  fun toMap(): Map<String, Any?> {
    val result = LinkedHashMap<String, Any?>()
    result["id"] = id
    if (title != null) result["title"] = title
    if (body != null) result["body"] = body
    if (url != null) result["url"] = url
    result["data"] = data
    result["provider"] = provider
    return result
  }

  /** Whether there is anything to show: a message with neither a title nor a body is data only, and a notification of it would be empty. */
  val hasContent: Boolean get() = title != null || body != null
}

/** The device's registration (`PushToken` of `src/push/types.ts`): the FCM token and the package it belongs to, which the sender checks against its Firebase project. */
data class PushToken(val token: String, val app: String, val provider: String = PROVIDER_FCM) {
  fun toMap(): Map<String, Any?> = linkedMapOf("provider" to provider, "token" to token, "app" to app)
}

/**
 * How the foreground hook says to show a message (`PushPresentation` of `src/push/hooks.ts`), every member decided. JavaScript fills the defaults, so a member that is
 * missing here is only a bug of the caller, and it reads as the default (shown).
 */
data class Presentation(val banner: Boolean = true, val sound: Boolean = true, val badge: Boolean = true) {
  companion object {
    /** Shown as it is when the app is in the background: what a message gets when JavaScript does not answer in time. */
    val DEFAULT = Presentation()

    /** The presentation JavaScript sent: a member that is not a boolean reads as `true`. */
    fun from(map: Map<String, Any?>?): Presentation {
      if (map == null) return DEFAULT
      return Presentation(map["banner"] as? Boolean ?: true, map["sound"] as? Boolean ?: true, map["badge"] as? Boolean ?: true)
    }
  }
}
