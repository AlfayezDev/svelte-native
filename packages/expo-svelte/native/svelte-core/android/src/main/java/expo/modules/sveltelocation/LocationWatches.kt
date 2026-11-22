package expo.modules.sveltelocation

/**
 * The watches that run, by the id JavaScript gave them: one registry for the module, so that stopping a watch, replacing one that has the same id (a JavaScript that started again and counts from 1 once
 * more) and stopping them all when the module goes are each one place. The handle is what stops it (the platform's listener); this class never calls it, the caller does with what comes back.
 * Plain Kotlin and thread-safe: a watch is started on the module's queue and its listener, on the main looper, may end it.
 */
class LocationWatches<Handle : Any> {
  private val handles = LinkedHashMap<Int, Handle>()

  /** Registers the watch; the handle it replaces, if the id had one, is returned for the caller to stop. */
  @Synchronized
  fun add(id: Int, handle: Handle): Handle? = handles.put(id, handle)

  /** Takes the watch out, and returns its handle, or null for an id that does not run. */
  @Synchronized
  fun remove(id: Int): Handle? = handles.remove(id)

  /** Takes the watch out only when it is still the one registered: a watch that was replaced does not take its successor's place with it. */
  @Synchronized
  fun removeIf(id: Int, handle: Handle): Boolean {
    if (handles[id] !== handle) return false
    handles.remove(id)
    return true
  }

  @Synchronized
  fun contains(id: Int): Boolean = handles.containsKey(id)

  @Synchronized
  fun size(): Int = handles.size

  /** Every handle, in the order they were added, and the registry empty. */
  @Synchronized
  fun clear(): List<Handle> {
    val all = handles.values.toList()
    handles.clear()
    return all
  }
}
