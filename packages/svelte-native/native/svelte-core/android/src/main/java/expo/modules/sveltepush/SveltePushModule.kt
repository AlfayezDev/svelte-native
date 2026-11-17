package expo.modules.sveltepush

import android.Manifest
import android.app.Application
import android.content.Context
import android.os.Build
import android.util.Log
import androidx.core.app.NotificationManagerCompat
import com.google.firebase.messaging.FirebaseMessaging
import expo.modules.interfaces.permissions.PermissionsResponse
import expo.modules.kotlin.Promise
import expo.modules.kotlin.exception.CodedException
import expo.modules.kotlin.exception.Exceptions
import expo.modules.kotlin.functions.Queues
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

private const val ERR_PERMISSIONS = "ERR_PUSH_PERMISSIONS"
private const val ERR_FIREBASE = "ERR_PUSH_FIREBASE_NOT_INITIALIZED"
private const val ERR_REGISTER = "ERR_PUSH_REGISTER"
private const val ERR_UNREGISTER = "ERR_PUSH_UNREGISTER"
private const val ERR_SHOW = "ERR_PUSH_SHOW"

/** The events of the contract (PUSH.md, "The native module's contract"); JavaScript listens to all four when push starts. */
private val EVENTS = arrayOf("token", "message", "opened", "background")

/**
 * The module behind `@alfayez/svelte-native/push` (`src/push/client.ts`; the contract is PUSH.md's "The native module's contract"): the permission, the FCM token,
 * answering a foreground message's `show`, the message a tap launched the process with, and the events. It is a thin skin: everything that has to outlive the module
 * (the events and their backlog, the waits, the tap rule) is `PushRuntime`'s and everything that can be decided without Android is plain Kotlin, checked on the host.
 */
class SveltePushModule : Module() {
  /** This module's way into JavaScript. A reload makes a new module with a sink of its own, which `PushEvents.detach` tells apart. */
  private val sink = EventSink { name, payload -> sendEvent(name, payload) }

  private val context: Context
    get() = appContext.reactContext?.applicationContext ?: throw Exceptions.ReactContextLost()

  /** Android 13 added the permission, and an app that targets an older API does not get to ask for it (the system asks by itself at its first channel). */
  private fun asksAtRunTime(): Boolean = Build.VERSION.SDK_INT >= 33 && context.applicationInfo.targetSdkVersion >= 33

  override fun definition() = ModuleDefinition {
    Name("SveltePush")

    Events(*EVENTS)

    OnCreate {
      (context as? Application)?.let { PushRuntime.install(it) }
      PushRuntime.events.attach(sink)
    }

    OnDestroy { PushRuntime.events.detach(sink) }

    // The events that came while nobody listened (a message that started the process) go out when the first listener of their name is added, and a name whose last
    // listener left keeps what comes next.
    for (name in EVENTS) {
      OnStartObserving(name) { PushRuntime.events.observe(name) }
      OnStopObserving(name) { PushRuntime.events.unobserve(name) }
    }

    AsyncFunction("permission") { promise: Promise -> readPermission(promise) }

    // Asked from the main thread: the question is a dialog of the current Activity.
    AsyncFunction("requestPermission") { promise: Promise -> requestPermission(promise) }.runOnQueue(Queues.MAIN)

    AsyncFunction("register") { promise: Promise -> register(promise) }

    AsyncFunction("unregister") { promise: Promise -> unregister(promise) }

    AsyncFunction("show") { message: Map<String, Any?>, presentation: Map<String, Any?> -> show(message, presentation) }

    Function("takeLaunchMessage") { PushRuntime.tapsOrNull()?.takeLaunch()?.toMap() }

    Function("backgroundDone") { id: String -> backgroundDone(id) }
  }

  /** `granted`, `denied` or `prompt`, from Expo's permission service on Android 13 and later and from the notification settings before. Never asks. */
  private fun readPermission(promise: Promise) {
    val enabled = NotificationManagerCompat.from(context).areNotificationsEnabled()
    if (!asksAtRunTime()) {
      promise.resolve(PushRules.permissionWithoutRuntimeAsk(enabled))
      return
    }
    val permissions = appContext.permissions
    if (permissions == null) {
      promise.reject(ERR_PERMISSIONS, "Expo's permissions module is not linked, so the notification permission cannot be read", null)
      return
    }
    permissions.getPermissions({ result -> promise.resolve(stateOf(result, enabled)) }, Manifest.permission.POST_NOTIFICATIONS)
  }

  private fun requestPermission(promise: Promise) {
    // Android 13 shows its question only for an app that has a channel.
    PushNotifier.ensureChannel(context)
    if (!asksAtRunTime()) {
      readPermission(promise)
      return
    }
    val permissions = appContext.permissions
    if (permissions == null) {
      promise.reject(ERR_PERMISSIONS, "Expo's permissions module is not linked, so the notification permission cannot be asked for", null)
      return
    }
    if (appContext.currentActivity == null) {
      // Expo's service answers "denied" for every permission when there is no Activity, and records the permission as blocked for good; so it is not asked.
      Log.w(LOG_TAG, "there is no Activity to ask for the notification permission from: the state is read, not asked")
      readPermission(promise)
      return
    }
    val applicationContext = context
    try {
      permissions.askForPermissions({ result ->
        promise.resolve(stateOf(result, NotificationManagerCompat.from(applicationContext).areNotificationsEnabled()))
      }, Manifest.permission.POST_NOTIFICATIONS)
    } catch (error: IllegalStateException) {
      promise.reject(ERR_PERMISSIONS, "the notification permission could not be asked for: ${error.message}", error)
    }
  }

  private fun stateOf(result: Map<String, PermissionsResponse>, notificationsEnabled: Boolean): String {
    val response = result[Manifest.permission.POST_NOTIFICATIONS] ?: return "prompt"
    return PushRules.permission(response.status.status, response.canAskAgain, notificationsEnabled)
  }

  // `getToken` is deprecated since Firebase 25.1 for `register()`, and it answers an error only for an app that opted into the new registration with the meta-data
  // `firebase_messaging_installation_id_enabled`, which this library does not set: the contract names `getToken` and `deleteToken` (PUSH.md).
  @Suppress("DEPRECATION")
  private fun register(promise: Promise) {
    val packageName = context.packageName
    try {
      PushNotifier.ensureChannel(context)
      FirebaseMessaging.getInstance().token.addOnCompleteListener { task ->
        val token = if (task.isSuccessful) task.result else null
        if (token.isNullOrEmpty()) {
          promise.reject(ERR_REGISTER, "Firebase did not give a token: ${task.exception?.message ?: "no reason given"}", task.exception)
        } else {
          promise.resolve(PushToken(token, packageName).toMap())
        }
      }
    } catch (error: IllegalStateException) {
      // FirebaseApp is made from the google-services.json that the config plugin's `googleServicesFile` copies in; without it there is no default app.
      promise.reject(ERR_FIREBASE, "Firebase is not initialized in this app: is capabilities.push.android.googleServicesFile set, and the app built again? ${error.message}", error)
    }
  }

  @Suppress("DEPRECATION")
  private fun unregister(promise: Promise) {
    try {
      FirebaseMessaging.getInstance().deleteToken().addOnCompleteListener { task ->
        if (task.isSuccessful) {
          promise.resolve()
        } else {
          promise.reject(ERR_UNREGISTER, "Firebase could not delete the token: ${task.exception?.message ?: "no reason given"}", task.exception)
        }
      }
    } catch (error: IllegalStateException) {
      promise.reject(ERR_FIREBASE, "Firebase is not initialized in this app: ${error.message}", error)
    }
  }

  /**
   * JavaScript's answer to a `message` event. It shows nothing by itself: the thread that received the message is waiting for this answer and shows the message
   * when it has it, so a message is shown once, and an answer that comes after the default (or twice) finds nobody waiting and does nothing.
   */
  private fun show(message: Map<String, Any?>, presentation: Map<String, Any?>) {
    val id = message["id"] as? String ?: throw CodedException(ERR_SHOW, "show takes the message of the `message` event, and this one has no id", null)
    if (!PushRuntime.shows.answer(id, Presentation.from(presentation))) {
      Log.d(LOG_TAG, "the answer for message $id came after the default was shown, or twice: nothing to do")
    }
  }

  private fun backgroundDone(id: String) {
    if (!PushRuntime.waits.done(id)) {
      Log.w(LOG_TAG, "backgroundDone($id): nothing waits for it (the wait ran out, or the id is not one this module gave)")
    }
  }
}
