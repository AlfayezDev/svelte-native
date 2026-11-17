package expo.modules.sveltepush

/** Where the ledger of tapped messages is kept between runs of the process: `SharedPreferences` on the device, a list in the host check. */
interface TapStore {
  fun load(): List<String>

  fun save(ids: List<String>)
}

/**
 * The ids of the messages whose tap was already delivered, the last [capacity] of them, kept in the [TapStore] so that they survive the process.
 *
 * A tap reaches this module as an Intent, and the same Intent can be read again: a recreated Activity (a rotation, a font scale) still holds its first intent in
 * `getIntent()`, and an Activity restored after the system killed the process holds the intent it was launched with. Neither is a tap, and the app would open the
 * notification's link a second time. A notification is cancelled by the tap that opens it and a message id never comes twice, so the id of the message is what says that
 * a tap was seen.
 */
class TapLedger(private val store: TapStore, private val capacity: Int = 32) {
  // Read at the first tap, not at construction: nothing before a tap needs the file, and the process starts without it.
  private val ids: ArrayList<String> by lazy { ArrayList(store.load()) }

  /** True the first time this id is asked about, and false after; a failure of the store is the caller's (the tap is delivered and the id forgotten at the next run). */
  @Synchronized
  fun firstTime(id: String): Boolean {
    if (ids.contains(id)) return false
    ids.add(id)
    while (ids.size > capacity) ids.removeAt(0)
    store.save(ArrayList(ids))
    return true
  }
}

/**
 * What a tap becomes, by the rule of the contract (PUSH.md, "The native module's contract"): until JavaScript has called `takeLaunchMessage()` once, a tap is the
 * launch message, and after that it is an `opened` event. JavaScript calls it when the router first reads the launch link, not when it starts, so a process that began
 * without a screen (a background message) and shows its first screen later still opens the link of the notification that was tapped in between.
 */
class PushTaps(private val events: PushEvents, private val ledger: TapLedger, private val log: (String) -> Unit = {}) {
  private var launch: PushMessage? = null
  private var launchTaken = false

  /**
   * A tap. Returns false, and does nothing, for a message whose tap was already delivered. Before JavaScript took the launch message a tap replaces the one that
   * waits: the user's last tap is where they meant to go.
   */
  @Synchronized
  fun tapped(message: PushMessage): Boolean {
    if (!ledger.firstTime(message.id)) {
      log("the tap on message ${message.id} was delivered before and is ignored")
      return false
    }
    if (launchTaken) {
      events.emit("opened", message.toMap())
    } else {
      launch = message
    }
    return true
  }

  /** The message whose tap launched the process, once: null after that, and when no tap did. From the first call on, taps are `opened` events. */
  @Synchronized
  fun takeLaunch(): PushMessage? {
    launchTaken = true
    val message = launch
    launch = null
    return message
  }
}
