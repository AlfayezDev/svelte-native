package expo.modules.sveltepush

import android.Manifest
import android.app.Application
import android.content.Context
import android.os.Build
import android.util.Log
import androidx.core.app.NotificationManagerCompat
import expo.modules.interfaces.permissions.PermissionsResponse
import expo.modules.kotlin.Promise
import expo.modules.kotlin.exception.CodedException
import expo.modules.kotlin.exception.Exceptions
import expo.modules.kotlin.functions.Queues
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

private const val ERR_DISABLED = "ERR_PUSH_DISABLED"
private const val ERR_PERMISSIONS = "ERR_PUSH_PERMISSIONS"
private const val ERR_FIREBASE = "ERR_PUSH_FIREBASE_NOT_INITIALIZED"
private const val ERR_REGISTER = "ERR_PUSH_REGISTER"
private const val ERR_UNREGISTER = "ERR_PUSH_UNREGISTER"
private const val ERR_SHOW = "ERR_PUSH_SHOW"

private const val DISABLED_MESSAGE =
  "Push is off in this build: turn it on with capabilities.push.android in the @alfayez/svelte-native config plugin, and build again (the module's `enabled` constant says which)"

/** The events of the contract (PUSH.md, "The native module's contract"); JavaScript listens to all four when push starts. */
private val EVENTS = arrayOf("token", "message", "opened", "background")

/**
 * The module behind `@alfayez/svelte-native/push` (`src/push/client.ts`; the contract is PUSH.md's "The native module's contract"): the permission, the FCM token,
 * answering a foreground message's `show`, the message a tap launched the process with, and the events. It is a thin skin: everything that has to outlive the module
 * (the events and their backlog, the waits, the tap rule) is `PushRuntime`'s and everything that can be decided without Android is plain Kotlin, checked on the host.
 *
 * The module is in every app, since it is part of svelte-core, and `enabled` (a constant) says whether push is on in this build: the config plugin turns it on for
 * `capabilities.push.android` (`PushManifest.enabled`) and adds Firebase Messaging with it. Off, the module attaches nothing, reads nothing and loads no Firebase class; its
 * asynchronous calls reject with `ERR_PUSH_DISABLED`, `takeLaunchMessage` answers `null` and `backgroundDone` does nothing. JavaScript does not call any of them (it reads `enabled`).
 * The calls that name Firebase are `PushFirebase`'s, which this class reaches only from `register` and `unregister`.
 */
class SveltePushModule : Module() {
  /** This module's way into JavaScript. A reload makes a new module with a sink of its own, which `PushEvents.detach` tells apart. */
  private val sink = EventSink { name, payload -> sendEvent(name, payload) }

  private val context: Context
    get() = appContext.reactContext?.applicationContext ?: throw Exceptions.ReactContextLost()

  /** Whether this module attached itself to `PushRuntime`, so that it detaches exactly then (the React context may be gone by `OnDestroy`). */
  private var attached = false

  /** Whether push is on in this build. Not cached here: without a context it is false, and a later call asks again (`PushManifest` caches the answer it could read). */
  private fun isEnabled(): Boolean {
    val application = appContext.reactContext?.applicationContext ?: return false
    return PushManifest.enabled(application)
  }

  /** Runs [action] when push is on, and rejects [promise] with `ERR_PUSH_DISABLED` when it is off. */
  private inline fun whenEnabled(promise: Promise, action: () -> Unit) {
    if (!isEnabled()) {
      promise.reject(ERR_DISABLED, DISABLED_MESSAGE, null)
      return
    }
    action()
  }

  /** Android 13 added the permission, and an app that targets an older API does not get to ask for it (the system asks by itself at its first channel). */
  private fun asksAtRunTime(): Boolean = Build.VERSION.SDK_INT >= 33 && context.applicationInfo.targetSdkVersion >= 33

  override fun definition() = ModuleDefinition {
    Name("SveltePush")

    // Whether push is on in this build (the config plugin's `capabilities.push.android`): the one thing JavaScript may ask of an app that has none.
    Constant("enabled") { isEnabled() }

    Events(*EVENTS)

    OnCreate {
      if (isEnabled()) {
        (context as? Application)?.let { PushRuntime.install(it) }
        PushRuntime.events.attach(sink)
        attached = true
      }
    }

    OnDestroy {
      if (attached) {
        PushRuntime.events.detach(sink)
        attached = false
      }
    }

    // The events that came while nobody listened (a message that started the process) go out when the first listener of their name is added, and a name whose last
    // listener left keeps what comes next.
    for (name in EVENTS) {
      OnStartObserving(name) { if (attached) PushRuntime.events.observe(name) }
      OnStopObserving(name) { if (attached) PushRuntime.events.unobserve(name) }
    }

    AsyncFunction("permission") { promise: Promise -> whenEnabled(promise) { readPermission(promise) } }

    // Asked from the main thread: the question is a dialog of the current Activity.
    AsyncFunction("requestPermission") { promise: Promise -> whenEnabled(promise) { requestPermission(promise) } }.runOnQueue(Queues.MAIN)

    AsyncFunction("register") { promise: Promise -> whenEnabled(promise) { register(promise) } }

    AsyncFunction("unregister") { promise: Promise -> whenEnabled(promise) { unregister(promise) } }

    AsyncFunction("show") { message: Map<String, Any?>, presentation: Map<String, Any?> -> show(message, presentation) }

    Function("takeLaunchMessage") { if (attached) PushRuntime.tapsOrNull()?.takeLaunch()?.toMap() else null }

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

  private fun register(promise: Promise) {
    val packageName = context.packageName
    try {
      PushNotifier.ensureChannel(context)
      PushFirebase.token { token, failure ->
        if (token.isNullOrEmpty()) {
          promise.reject(ERR_REGISTER, "Firebase did not give a token: ${failure?.message ?: "no reason given"}", failure)
        } else {
          promise.resolve(PushToken(token, packageName).toMap())
        }
      }
    } catch (error: IllegalStateException) {
      // FirebaseApp is made from the google-services.json that the config plugin's `googleServicesFile` copies in; without it there is no default app.
      promise.reject(ERR_FIREBASE, "Firebase is not initialized in this app: is capabilities.push.android.googleServicesFile set, and the app built again? ${error.message}", error)
    }
  }

  private fun unregister(promise: Promise) {
    try {
      PushFirebase.deleteToken { ok, failure ->
        if (ok) {
          promise.resolve()
        } else {
          promise.reject(ERR_UNREGISTER, "Firebase could not delete the token: ${failure?.message ?: "no reason given"}", failure)
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
    if (!attached) throw CodedException(ERR_DISABLED, DISABLED_MESSAGE, null)
    val id = message["id"] as? String ?: throw CodedException(ERR_SHOW, "show takes the message of the `message` event, and this one has no id", null)
    if (!PushRuntime.shows.answer(id, Presentation.from(presentation))) {
      Log.d(LOG_TAG, "the answer for message $id came after the default was shown, or twice: nothing to do")
    }
  }

  private fun backgroundDone(id: String) {
    if (!attached) return
    if (!PushRuntime.waits.done(id)) {
      Log.w(LOG_TAG, "backgroundDone($id): nothing waits for it (the wait ran out, or the id is not one this module gave)")
    }
  }
}
