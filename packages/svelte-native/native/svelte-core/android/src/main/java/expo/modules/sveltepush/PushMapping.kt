package expo.modules.sveltepush

/**
 * The three places a `PushMessage` comes from and goes to on Android, as plain maps and strings so that the host check runs them:
 *
 * - a `RemoteMessage` that Firebase delivers to `onMessageReceived` (`fromRemote`);
 * - the extras of the `PendingIntent` this module makes for a notification it shows itself (`toExtras`, and `fromExtras` reads them back);
 * - the extras of the launch intent of a notification the system showed while the app was in the background (`fromExtras`): Firebase puts the message's data keys
 *   there, with `google.message_id` and a few keys of its own, and leaves the notification's title and body out (its `gcm.n.*` keys are removed before the intent is
 *   made), so a tap on such a notification has an id, a `url` and the data, and no title or body.
 */
object PushMapping {
  /** The key the sender's `url` travels under in a message's data (`PushSend` in PUSH.md: "`url`, `data`: `data` (`url` among them)"). */
  const val URL_KEY = "url"

  /** Firebase's id of a message in the launch intent of a notification it showed. It is what tells such an intent from any other. */
  const val FCM_MESSAGE_ID = "google.message_id"

  /** The extras of this module's own `PendingIntent`, all under one prefix so that nothing a sender names can collide with them. */
  const val EXTRA_PREFIX = "svelte.push."
  const val EXTRA_ID = "svelte.push.id"
  const val EXTRA_TITLE = "svelte.push.title"
  const val EXTRA_BODY = "svelte.push.body"
  const val EXTRA_URL = "svelte.push.url"
  const val EXTRA_PROVIDER = "svelte.push.provider"
  const val EXTRA_DATA_PREFIX = "svelte.push.data."

  /** Keys Firebase and Android put in a launch intent beside the message's own data: the reserved words of FCM's data keys, and the namespaces of the system. */
  private val RESERVED_KEYS = setOf("from", "collapse_key", "message_type", "message_id")
  private val RESERVED_PREFIXES = listOf("google.", "gcm.", "android.", EXTRA_PREFIX)

  private fun blankToNull(value: String?): String? = value?.takeIf { it.isNotBlank() }

  /**
   * A message id the tap ledger can keep: not blank, and with no line break. The ledger stores one id to a line (`TapStore`), so an id with a `\n` would write more than one
   * (an intent anybody can send to the app's launch Activity can carry one in `svelte.push.id`, and could so write the ids of messages that are not sent yet, which would then
   * never open). An id like that is no id.
   */
  private fun usableId(value: String?): String? = blankToNull(value)?.takeIf { !it.contains('\n') }

  /**
   * A message Firebase delivered. `title` and `body` are the notification block's, when the message has one. The sender's `url` is split off the data, and the id is
   * FCM's, or a new one (`newId`) for a message that has none, so that a tap and `show` still have something to know it by. `channelId` is the notification block's
   * `channel_id`, for the notification this module shows when it is the one that shows it.
   */
  fun fromRemote(messageId: String?, title: String?, body: String?, data: Map<String, String>, newId: () -> String, channelId: String? = null): PushMessage {
    return PushMessage(
      id = usableId(messageId) ?: newId(),
      title = blankToNull(title),
      body = blankToNull(body),
      url = blankToNull(data[URL_KEY]),
      data = data.filterKeys { it != URL_KEY },
      channelId = blankToNull(channelId),
    )
  }

  /** The extras that carry `message` through a `PendingIntent` made by this module: strings only, so any `Bundle` holds them. */
  fun toExtras(message: PushMessage): Map<String, String> {
    val extras = LinkedHashMap<String, String>()
    extras[EXTRA_ID] = message.id
    extras[EXTRA_PROVIDER] = message.provider
    message.title?.let { extras[EXTRA_TITLE] = it }
    message.body?.let { extras[EXTRA_BODY] = it }
    message.url?.let { extras[EXTRA_URL] = it }
    for ((key, value) in message.data) extras[EXTRA_DATA_PREFIX + key] = value
    return extras
  }

  /**
   * The message a launch intent's extras say was tapped, or null when the intent is not a push tap (an ordinary launch, a deep link, another library's intent). Values
   * that are not strings are not the sender's: FCM's data is strings only, and the extras Android and the launchers add (a boolean here, a bundle there) are skipped.
   */
  fun fromExtras(extras: Map<String, Any?>): PushMessage? {
    val own = usableId(extras[EXTRA_ID] as? String)
    if (own != null) {
      val data = LinkedHashMap<String, String>()
      for ((key, value) in extras) {
        if (key.startsWith(EXTRA_DATA_PREFIX) && value is String) data[key.substring(EXTRA_DATA_PREFIX.length)] = value
      }
      val provider = (extras[EXTRA_PROVIDER] as? String)?.takeIf { it == "fcm" || it == "apns" } ?: PROVIDER_FCM
      return PushMessage(
        id = own,
        title = blankToNull(extras[EXTRA_TITLE] as? String),
        body = blankToNull(extras[EXTRA_BODY] as? String),
        url = blankToNull(extras[EXTRA_URL] as? String),
        data = data,
        provider = provider,
      )
    }
    val fcm = usableId(extras[FCM_MESSAGE_ID] as? String) ?: return null
    val data = LinkedHashMap<String, String>()
    for ((key, value) in extras) {
      if (value !is String || key == URL_KEY || RESERVED_KEYS.contains(key) || RESERVED_PREFIXES.any { key.startsWith(it) }) continue
      data[key] = value
    }
    return PushMessage(id = fcm, url = blankToNull(extras[URL_KEY] as? String), data = data)
  }
}
