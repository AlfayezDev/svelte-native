package expo.modules.svelteengine

import java.io.File

/**
 * The files of the `tmpfile` result. The library's own clean-up on exit runs only when its module was instantiated (its
 * `invalidate()`), and an app that captures only engine views may never have loaded it, so the engine deletes what it made itself
 * when its module is destroyed ([deleteAll]).
 */
class CaptureFiles {
  private val made = LinkedHashSet<File>()

  fun create(prefix: String, suffix: String, directory: File): File =
    File.createTempFile(prefix, suffix, directory).also { synchronized(made) { made.add(it) } }

  /** Deletes every file made so far and forgets them; answers how many it deleted (one the library's `releaseCapture` already removed is not counted). */
  fun deleteAll(): Int {
    val files = synchronized(made) { made.toList().also { made.clear() } }
    return files.count { it.delete() }
  }
}
