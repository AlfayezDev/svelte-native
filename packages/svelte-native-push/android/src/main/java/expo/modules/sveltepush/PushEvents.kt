package expo.modules.sveltepush

/** Where the events go: the Expo module's `sendEvent`. It must not block and must not call back into [PushEvents], which holds its lock while it sends. */
fun interface EventSink {
  fun send(name: String, payload: Map<String, Any?>)
}

/**
 * The events of the native module (`token`, `message`, `opened`, `background`) between the places that make them and the JavaScript that listens.
 *
 * Those places live longer than the module does. A message can start the process before any JavaScript exists, Expo registers its modules lazily so the module itself
 * may not exist until JavaScript first asks for it, and a reload destroys the module and makes another. So the events belong to the process (this class, held by
 * `PushRuntime`) and the module only attaches to it: an event that comes while nobody listens is kept, and delivered, in order, when the first listener of that name is
 * added (Expo's `OnStartObserving`), as the contract in PUSH.md says.
 */
class PushEvents(private val capacity: Int = 64, private val log: (String) -> Unit = {}) {
  private val lock = Any()
  private var sink: EventSink? = null
  private val observed = HashSet<String>()
  private val queued = LinkedHashMap<String, ArrayList<Map<String, Any?>>>()

  /**
   * Sends the event when JavaScript listens to it, and keeps it otherwise. At most [capacity] events are kept for a name, for a process whose JavaScript never starts:
   * the oldest goes, and the log says so. A `token` event is replaced by a newer one, as only the latest token is of any use.
   */
  fun emit(name: String, payload: Map<String, Any?>) {
    synchronized(lock) {
      val target = sink
      if (target != null && observed.contains(name)) {
        deliver(target, name, payload)
        return
      }
      val list = queued.getOrPut(name) { ArrayList() }
      if (name == LATEST_ONLY) list.clear()
      list.add(payload)
      if (list.size > capacity) {
        list.removeAt(0)
        log("the $name events nobody listens to are more than $capacity: the oldest was dropped")
      }
    }
  }

  /** The module of a new JavaScript runtime. Its listeners are not added yet, so nothing is observed until they are. */
  fun attach(target: EventSink) {
    synchronized(lock) {
      sink = target
      observed.clear()
    }
  }

  /** The module is going away. It is ignored when another module has attached since (a reload creates the new module before it destroys the old one). */
  fun detach(target: EventSink) {
    synchronized(lock) {
      if (sink !== target) return
      sink = null
      observed.clear()
    }
  }

  /** The first listener of `name` was added: its kept events go out now, in the order they came. */
  fun observe(name: String) {
    synchronized(lock) {
      observed.add(name)
      val target = sink ?: return
      val waiting = queued.remove(name) ?: return
      for (payload in waiting) deliver(target, name, payload)
    }
  }

  /** The last listener of `name` was removed: what comes next is kept. */
  fun unobserve(name: String) {
    synchronized(lock) { observed.remove(name) }
  }

  /** How many events of `name` are kept, for the host check. */
  fun pending(name: String): Int = synchronized(lock) { queued[name]?.size ?: 0 }

  private fun deliver(target: EventSink, name: String, payload: Map<String, Any?>) {
    try {
      target.send(name, payload)
    } catch (error: RuntimeException) {
      // An event the runtime refuses (a module that is being torn down) is lost, and a dropped message is worth a line: nothing else records it.
      log("the $name event could not be sent to JavaScript and was dropped: $error")
    }
  }

  companion object {
    /** The event of which only the newest matters: a provider that rotates the token twice before JavaScript listens has one token to tell. */
    const val LATEST_ONLY = "token"
  }
}
