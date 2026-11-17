package expo.modules.sveltepush

import android.annotation.SuppressLint
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.content.res.Resources
import android.os.Build
import android.os.Bundle
import android.util.Log
import androidx.core.app.NotificationChannelCompat
import androidx.core.app.NotificationCompat
import androidx.core.app.NotificationManagerCompat
import androidx.core.content.ContextCompat

/**
 * Shows a notification the way Firebase would have shown it in the background, so that the two look the same: the channel, the small icon and the color come from
 * the manifest (the config plugin wrote them; `capabilities.ts`), and a tap launches the app's launch Activity with the message in the extras, which `PushTapListener`
 * reads back. Notifications of the same message id replace each other (the tag), so `show` is idempotent per message.
 */
internal object PushNotifier {
  private var channel: ChannelSpec? = null
  private var channelCreated = false
  private var meta: Bundle? = null
  private var metaRead = false

  /** The application's `<meta-data>`, read once: it cannot change while the process lives. */
  @Synchronized
  @Suppress("DEPRECATION")
  private fun metaData(context: Context): Bundle? {
    if (metaRead) return meta
    try {
      val manager = context.packageManager
      val info =
        if (Build.VERSION.SDK_INT >= 33) {
          manager.getApplicationInfo(context.packageName, PackageManager.ApplicationInfoFlags.of(PackageManager.GET_META_DATA.toLong()))
        } else {
          manager.getApplicationInfo(context.packageName, PackageManager.GET_META_DATA)
        }
      meta = info.metaData
    } catch (error: PackageManager.NameNotFoundException) {
      Log.w(LOG_TAG, "the application's own manifest could not be read, so the channel, icon and color are the defaults: $error")
    }
    metaRead = true
    return meta
  }

  /**
   * Creates the channel from the config, once per process, and returns its id. Called wherever the channel has to exist before something else: asking for the
   * permission (Android 13 shows its question only for an app that has a channel), the token (the first thing an app does) and showing. The system keeps the
   * first version of a channel it has seen, so a change of the config's name reaches only an app that is reinstalled; the importance is `HIGH`, so a notification
   * is a banner with a sound, as `banner: true` means on iOS.
   */
  @Synchronized
  @Suppress("DEPRECATION")
  fun ensureChannel(context: Context): String {
    val spec = channel ?: PushRules.channel { name -> metaData(context)?.get(name) }.also { channel = it }
    if (!channelCreated) {
      val builder = NotificationChannelCompat.Builder(spec.id, NotificationManagerCompat.IMPORTANCE_HIGH).setName(spec.name)
      spec.description?.let { builder.setDescription(it) }
      NotificationManagerCompat.from(context).createNotificationChannel(builder.build())
      channelCreated = true
    }
    return spec.id
  }

  /** The small icon: the manifest's Firebase default (a white silhouette the config plugin copied), else the application icon, else the system's. */
  private fun smallIcon(context: Context): Int {
    val configured = metaData(context)?.getInt(PushRules.META_ICON, 0) ?: 0
    if (configured != 0) return configured
    return context.applicationInfo.icon.takeIf { it != 0 } ?: android.R.drawable.sym_def_app_icon
  }

  /** The accent color, or null when the manifest names none or names a resource that is not there (logged: the notification is shown without it). */
  private fun accentColor(context: Context): Int? {
    val resource = metaData(context)?.getInt(PushRules.META_COLOR, 0) ?: 0
    if (resource == 0) return null
    return try {
      ContextCompat.getColor(context, resource)
    } catch (error: Resources.NotFoundException) {
      Log.w(LOG_TAG, "the notification color of the manifest names a resource that is not there; the notification has no accent color: $error")
      null
    }
  }

  /**
   * What a tap on the notification starts: the app's launch Activity, on top of its own task (`CLEAR_TOP`, as Firebase's own notifications do, and `SINGLE_TOP` so that
   * an Activity that is already at the top hears `onNewIntent` rather than being made again), with the message in the extras. `FLAG_IMMUTABLE` is required from API 31
   * and the intent is explicit, so it is the right flag on every version; `FLAG_UPDATE_CURRENT` makes a second `show` of the same message carry the same extras.
   */
  private fun contentIntent(context: Context, message: PushMessage): PendingIntent? {
    val launch = context.packageManager.getLaunchIntentForPackage(context.packageName)
    if (launch == null) {
      Log.w(LOG_TAG, "the app has no launch Activity, so the notification of message ${message.id} has nothing to open")
      return null
    }
    launch.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TOP or Intent.FLAG_ACTIVITY_SINGLE_TOP)
    for ((key, value) in PushMapping.toExtras(message)) launch.putExtra(key, value)
    return PendingIntent.getActivity(context, message.id.hashCode(), launch, PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE)
  }

  /**
   * Posts the notification of `message` as `presentation` says. Nothing is posted for `banner: false` or for a message that has no title and no body, and nothing can be
   * posted while the user has switched the app's notifications off (on Android 13 and later: without the permission); each of those is logged, as the message is
   * otherwise lost without a trace. A failure to post is logged too, and not thrown: this runs on Firebase's thread, and a service that throws is restarted.
   */
  @SuppressLint("MissingPermission")
  fun post(context: Context, message: PushMessage, presentation: Presentation) {
    if (!PushRules.shouldPost(message, presentation)) {
      Log.d(LOG_TAG, "message ${message.id} is not shown (banner ${presentation.banner}, title or body ${message.hasContent})")
      return
    }
    val manager = NotificationManagerCompat.from(context)
    if (!manager.areNotificationsEnabled()) {
      Log.w(LOG_TAG, "notifications are switched off for the app, so message ${message.id} is not shown")
      return
    }
    try {
      val builder = NotificationCompat.Builder(context, ensureChannel(context))
        .setSmallIcon(smallIcon(context))
        .setAutoCancel(true)
        .setPriority(NotificationCompat.PRIORITY_HIGH)
      contentIntent(context, message)?.let { builder.setContentIntent(it) }
      message.title?.let { builder.setContentTitle(it) }
      message.body?.let { builder.setContentText(it).setStyle(NotificationCompat.BigTextStyle().bigText(it)) }
      accentColor(context)?.let { builder.setColor(it) }
      // Android's sound is the channel's; the only way to play none for one notification is to make it silent.
      if (!presentation.sound) builder.setSilent(true)
      manager.notify("svelte-push:${message.id}", 0, builder.build())
    } catch (error: RuntimeException) {
      Log.e(LOG_TAG, "message ${message.id} could not be shown", error)
    }
  }
}
