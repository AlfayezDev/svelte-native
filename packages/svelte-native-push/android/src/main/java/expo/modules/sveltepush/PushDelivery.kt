package expo.modules.sveltepush

/**
 * What `onMessageReceived` does with a message once it is a [PushMessage], on the thread Firebase gave it (PUSH.md, "Android"). It blocks that thread on purpose: the
 * system keeps a process alive while a service is inside `onMessageReceived`, and a process started by a message has no other reason to live until JavaScript has run.
 * [post] shows a notification (the Android side); everything else is plain Kotlin that the host check runs with short limits.
 */
class PushDelivery(
  private val events: PushEvents,
  private val shows: ShowGate,
  private val waits: BackgroundWaits,
  private val post: (PushMessage, Presentation) -> Unit,
  private val log: (String) -> Unit = {},
  private val foregroundWaitMs: Long = FOREGROUND_WAIT_MS,
  private val backgroundWaitMs: Long = BACKGROUND_WAIT_MS,
) {
  /** Routes the message and runs its route to the end; returns the route, for the host check. */
  fun deliver(message: PushMessage, foreground: Boolean, hasNotification: Boolean): PushRules.Route {
    val route = PushRules.route(foreground, hasNotification)
    when (route) {
      PushRules.Route.FOREGROUND -> {
        val hold = shows.hold(message.id)
        events.emit("message", message.toMap())
        val answer = shows.await(hold, foregroundWaitMs)
        if (answer == null) log("JavaScript did not answer for message ${message.id} in $foregroundWaitMs ms: it is shown by default")
        post(message, answer ?: Presentation.DEFAULT)
      }
      PushRules.Route.SHOW_NOW -> post(message, Presentation.DEFAULT)
      PushRules.Route.BACKGROUND -> {
        val completion = waits.open()
        events.emit("background", mapOf("id" to completion, "message" to message.toMap()))
        if (!waits.await(completion, backgroundWaitMs)) log("the background hook for message ${message.id} did not finish in $backgroundWaitMs ms: the process is let go")
      }
    }
    return route
  }

  companion object {
    /** JavaScript has 900 ms (`FOREGROUND_TIMEOUT_MS`); this waits a little longer so that its default and ours do not race. */
    const val FOREGROUND_WAIT_MS = 1_000L

    /** Android lets a message's work run for about 20 s; the hook gets 18 and the thread returns with room to spare. */
    const val BACKGROUND_WAIT_MS = 18_000L
  }
}
