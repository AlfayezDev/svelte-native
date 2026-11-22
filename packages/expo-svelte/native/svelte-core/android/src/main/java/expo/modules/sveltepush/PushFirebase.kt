package expo.modules.sveltepush

import com.google.firebase.messaging.FirebaseMessaging

/**
 * The calls of `register` and `unregister` that name Firebase's classes, and the only code besides the messaging service that does. Firebase Messaging is `compileOnly` in this
 * project (`build.gradle`): an app has it only when the config plugin added it, for `capabilities.push.android`. Nothing loads this class unless push is on and JavaScript calls
 * `register` or `unregister`, so an app without push never resolves a Firebase class, whatever the module's other code does.
 */
internal object PushFirebase {
  /**
   * Asks Firebase for the registration token. `getToken` is deprecated since Firebase 25.1 for `register()`, and it answers an error only for an app that opted into the new
   * registration with the meta-data `firebase_messaging_installation_id_enabled`, which this library does not set: the contract names `getToken` and `deleteToken` (PUSH.md).
   * Throws `IllegalStateException` when there is no default FirebaseApp (no google-services.json); [onDone] hears the token, or why there is none.
   */
  @Suppress("DEPRECATION")
  fun token(onDone: (token: String?, failure: Exception?) -> Unit) {
    FirebaseMessaging.getInstance().token.addOnCompleteListener { task ->
      onDone(if (task.isSuccessful) task.result else null, task.exception)
    }
  }

  /** Deletes the registration token; [onDone] hears whether it went, and why not. Throws `IllegalStateException` as [token] does. */
  @Suppress("DEPRECATION")
  fun deleteToken(onDone: (ok: Boolean, failure: Exception?) -> Unit) {
    FirebaseMessaging.getInstance().deleteToken().addOnCompleteListener { task ->
      onDone(task.isSuccessful, task.exception)
    }
  }
}
