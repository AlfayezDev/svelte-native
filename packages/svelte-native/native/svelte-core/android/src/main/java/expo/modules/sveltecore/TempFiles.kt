package expo.modules.sveltecore

import java.io.File
import java.io.FileOutputStream
import java.io.IOException
import java.lang.ref.PhantomReference
import java.lang.ref.ReferenceQueue
import java.nio.ByteBuffer
import java.util.Collections
import java.util.UUID
import java.util.concurrent.ConcurrentHashMap

/**
 * A file this module made so that bytes need not stay on the Java heap: a downloaded Blob too big to keep, a `content://` stream copied to somewhere it can be
 * read at any position. Every file segment over it holds this object, and the file is deleted once nothing does: a Blob lives as long as anything reads it, and
 * slices and joins share its segments, so no single owner could say when it is safe to delete.
 */
internal class TempFile(val file: File) {
  /** The first `length` bytes of the file as a Blob. */
  fun blob(length: Long): BlobData = BlobData.ofSegment(FileSegment(LocalFiles(), FileUrls.urlOf(file), 0, length, this))
}

internal class TempFiles(private val directory: File) {
  @Throws(IOException::class)
  fun create(): TempFile {
    if (!directory.isDirectory && !directory.mkdirs() && !directory.isDirectory) throw IOException("Cannot create ${directory.path}")
    val file = File(directory, UUID.randomUUID().toString())
    if (!file.createNewFile()) throw IOException("Cannot create ${file.path}")
    return TempFile(file).also { Reaper.track(it) }
  }

  /** A new file holding what `handle` yields from its start to its end, as a Blob. The handle is read once, forward only. */
  @Throws(IOException::class)
  fun copyOf(handle: FileHandle): BlobData {
    val temp = create()
    try {
      var position = 0L
      val buffer = ByteBuffer.allocate(64 * 1024)
      FileOutputStream(temp.file).use { out ->
        while (true) {
          buffer.clear()
          val n = handle.read(position, buffer)
          if (n < 0) break
          out.write(buffer.array(), 0, n)
          position += n
        }
      }
      return temp.blob(position)
    } catch (e: IOException) {
      temp.file.delete()
      throw e
    } catch (e: RuntimeException) {
      temp.file.delete()
      throw IOException("Cannot copy the stream: ${e.message}", e)
    }
  }

  /** Deletes what is older than `before` (milliseconds since the epoch); see [sweepOlderThan]. */
  fun sweep(before: Long) = sweepOlderThan(directory, before)
}

/**
 * Deletes the files of `directory` last written before `before`. The startup sweep passes the start of the process: whatever is older was left by an earlier
 * run, and nothing the sweep races with (a file made since the process began) is older than that.
 */
internal fun sweepOlderThan(directory: File, before: Long) {
  directory.listFiles()?.forEach { if (it.lastModified() < before) it.delete() }
}

/** Deletes a [TempFile]'s file after the garbage collector has found the object unreachable. */
private object Reaper {
  private val queue = ReferenceQueue<TempFile>()
  private val tracked: MutableSet<Cleanup> = Collections.newSetFromMap(ConcurrentHashMap())

  private class Cleanup(referent: TempFile, val file: File) : PhantomReference<TempFile>(referent, queue)

  private var started = false

  @Synchronized
  private fun ensureThread() {
    if (started) return
    started = true
    Thread {
      while (true) {
        val done = try {
          queue.remove() as Cleanup
        } catch (_: InterruptedException) {
          return@Thread
        }
        tracked.remove(done)
        try {
          done.file.delete()
        } catch (_: SecurityException) {
          // The startup sweep gets it next time.
        }
      }
    }.apply {
      name = "svelte-fetch-temp-files"
      isDaemon = true
      start()
    }
  }

  fun track(temp: TempFile) {
    tracked.add(Cleanup(temp, temp.file))
    ensureThread()
  }
}
