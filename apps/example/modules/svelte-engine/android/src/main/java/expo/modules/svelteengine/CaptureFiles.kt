package expo.modules.svelteengine

import java.io.File

/**
 * The files of the `tmpfile` result. The library's own clean-up on exit runs only when its module was instantiated (its
 * `invalidate()`), and an app that captures only engine views may never have loaded it, so the engine deletes what it made itself
 * when its module is destroyed ([deleteAll]), and what an earlier process left when it starts ([sweep]).
 */
class CaptureFiles {
  private val made = LinkedHashSet<File>()

  fun create(prefix: String, suffix: String, directory: File): File =
    File.createTempFile(prefix, suffix, directory).also { synchronized(made) { made.add(it) } }

  /**
   * Deletes the files of [directory] whose name starts with [prefix] and that were last written before [before] (milliseconds since the
   * epoch): what a process that has been killed left behind. A `tmpfile` result lasts "until the app exits", and `OnDestroy` does not run in
   * a process that is killed (a swipe from the recents list, the system's low-memory kill, `am force-stop`), so the next process of the app
   * clears them when it starts, before it can make a file of its own. Answers how many it deleted.
   */
  fun sweep(directory: File, prefix: String, before: Long): Int =
    (directory.listFiles() ?: emptyArray()).count { it.isFile && it.name.startsWith(prefix) && it.lastModified() < before && it.delete() }

  /** Deletes every file made so far and forgets them; answers how many it deleted (one the library's `releaseCapture` already removed is not counted). */
  fun deleteAll(): Int {
    val files = synchronized(made) { made.toList().also { made.clear() } }
    return files.count { it.delete() }
  }
}
