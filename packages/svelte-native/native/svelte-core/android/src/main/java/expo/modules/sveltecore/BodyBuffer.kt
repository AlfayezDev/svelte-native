package expo.modules.sveltecore

import okio.BufferedSource
import java.io.IOException
import java.nio.ByteBuffer
import java.util.concurrent.Executor

/** Bytes of a response body as they arrived: `data[start, end)`. Never written after it is queued, so a consumer may read it outside the lock. */
internal class Chunk(val data: ByteArray, var start: Int, val end: Int)

/** The chunks as one buffer `alloc` made for exactly their total size. */
internal fun List<Chunk>.assemble(alloc: Alloc): ByteBuffer {
  var total = 0
  for (chunk in this) total += chunk.end - chunk.start
  val buffer = alloc(total)
  for (chunk in this) buffer.put(chunk.data, chunk.start, chunk.end - chunk.start)
  buffer.flip()
  return buffer
}

/**
 * The body of one response, between a background reader and a consumer that asks for it a piece at a time.
 *
 * A pump on the executor reads the source (blocking, never on a caller's thread) into chunks and stops while 1 MiB or more is unread; the transfer then pauses
 * through TCP flow control and no thread waits meanwhile, because a pump that stopped has returned. A consumer takes the body one way, once: `read` as often as it
 * likes, or `readAll` (which lifts the pause, since everything is wanted). Every answer is delivered from the executor, never from the consumer's call.
 */
internal class BodyBuffer(
  private val source: BufferedSource,
  private val release: () -> Unit,
  private val executor: Executor,
  private val alloc: Alloc,
  private val highWater: Int = HIGH_WATER
) {
  private sealed class Waiter {
    abstract fun reject(error: FetchError)

    class Read(val max: Int, val reply: Reply<ByteBuffer?>) : Waiter() {
      override fun reject(error: FetchError) = reply.reject(error)
    }

    class All(val reply: Reply<List<Chunk>>) : Waiter() {
      override fun reject(error: FetchError) = reply.reject(error)
    }
  }

  private enum class Mode { NONE, STREAM, ALL }

  private val lock = Any()
  private val chunks = ArrayDeque<Chunk>()
  private var unread = 0L
  private var eof = false
  private var failure: FetchError? = null
  private var closed = false // aborted: nothing more is delivered
  private var finished = false // the consumer has taken the end of the body
  private var pumping = false
  private var released = false
  private var mode = Mode.NONE
  private var waiter: Waiter? = null

  /** The most bytes that were ever unread at once (for the host checks of backpressure). */
  @Volatile
  var peakUnread = 0L
    private set

  /** Starts reading ahead; call once the head has been handed on. */
  fun start() {
    synchronized(lock) { schedulePumpLocked() }
  }

  /** The next bytes, at least 1 and at most `max`, or null at the end of the body. */
  fun read(max: Int, reply: Reply<ByteBuffer?>) {
    var delivery: (() -> Unit)? = null
    synchronized(lock) {
      when {
        closed -> delivery = { reply.reject(FetchError.aborted()) }
        mode == Mode.ALL || waiter != null -> delivery = { reply.reject(FetchError.bodyUsed()) }
        else -> {
          mode = Mode.STREAM
          waiter = Waiter.Read(max.coerceAtLeast(1), reply)
          delivery = serveLocked()
          schedulePumpLocked()
        }
      }
    }
    delivery?.let { run -> executor.execute { run() } }
  }

  /** The rest of the body, once it has all arrived. */
  fun readAll(reply: Reply<List<Chunk>>) {
    var delivery: (() -> Unit)? = null
    synchronized(lock) {
      when {
        closed -> delivery = { reply.reject(FetchError.aborted()) }
        mode != Mode.NONE -> delivery = { reply.reject(FetchError.bodyUsed()) }
        else -> {
          mode = Mode.ALL
          waiter = Waiter.All(reply)
          delivery = serveLocked()
          schedulePumpLocked()
        }
      }
    }
    delivery?.let { run -> executor.execute { run() } }
  }

  /**
   * Stops the transfer and drops what was buffered; a pending read rejects with ERR_FETCH_ABORTED. False, and no effect, once the consumer has taken the end.
   * The caller cancels the network call after this returns, which unblocks a pump that is inside a read.
   */
  fun abort(): Boolean {
    var pending: Waiter? = null
    var releaseNow = false
    synchronized(lock) {
      if (closed || finished) return false
      closed = true
      chunks.clear()
      unread = 0
      pending = waiter
      waiter = null
      // A pump that is running closes the source itself when its read returns; with none running, nobody else will.
      if (!pumping) releaseNow = markReleasedLocked()
    }
    pending?.reject(FetchError.aborted())
    if (releaseNow) release()
    return true
  }

  private fun markReleasedLocked(): Boolean {
    if (released) return false
    released = true
    return true
  }

  /** A pump is wanted when something can still arrive and either everything is wanted or at most half of the limit is unread. */
  private fun schedulePumpLocked() {
    if (pumping || closed || eof || failure != null) return
    if (mode != Mode.ALL && unread > highWater / 2) return
    pumping = true
    executor.execute { pump() }
  }

  private fun pump() {
    val scratch = ByteArray(CHUNK)
    while (pumpGoesOn()) {
      var failed: FetchError? = null
      var n = -1
      try {
        n = source.read(scratch, 0, scratch.size)
      } catch (e: IOException) {
        failed = FetchError.network(e)
      } catch (e: RuntimeException) {
        // OkHttp reports a source closed from another thread as an IllegalStateException.
        failed = FetchError.network(e)
      }
      var delivery: (() -> Unit)? = null
      var releaseNow = false
      synchronized(lock) {
        if (closed) {
          pumping = false
          releaseNow = markReleasedLocked()
        } else {
          when {
            failed != null -> failure = failed
            n < 0 -> eof = true
            else -> {
              chunks.addLast(Chunk(scratch.copyOfRange(0, n), 0, n))
              unread += n
              if (unread > peakUnread) peakUnread = unread
            }
          }
          delivery = serveLocked()
          if (eof || failure != null) {
            pumping = false
            releaseNow = markReleasedLocked()
          }
        }
      }
      delivery?.invoke()
      if (releaseNow) release()
    }
  }

  /** Whether to read on. When not, the pump is over, and the source is closed if the body is over for good (it stays open while only paused). */
  private fun pumpGoesOn(): Boolean {
    var releaseNow = false
    val goesOn = synchronized(lock) {
      val wanted = !closed && !eof && failure == null && (mode == Mode.ALL || unread < highWater)
      if (!wanted) {
        pumping = false
        if (closed || eof || failure != null) releaseNow = markReleasedLocked()
      }
      wanted
    }
    if (releaseNow) release()
    return goesOn
  }

  /** What to do (outside the lock) for the waiting consumer given what has arrived, or null when it must keep waiting. */
  private fun serveLocked(): (() -> Unit)? {
    val pending = waiter ?: return null
    if (pending is Waiter.Read && unread > 0) {
      waiter = null
      val taken = takeLocked(pending.max)
      return {
        try {
          pending.reply.resolve(taken.assemble(alloc))
        } catch (e: OutOfMemoryError) {
          pending.reply.reject(FetchError(FetchCodes.NETWORK, "Not enough memory for ${taken.sumOf { it.end - it.start }} bytes", e))
        }
      }
    }
    failure?.let { error ->
      waiter = null
      return { pending.reject(error) }
    }
    if (!eof) return null
    waiter = null
    finished = true
    if (pending is Waiter.Read) return { pending.reply.resolve(null) }
    pending as Waiter.All
    val all = chunks.toList()
    chunks.clear()
    unread = 0
    return { pending.reply.resolve(all) }
  }

  /** Up to `max` bytes from the front of the queue as views of its chunks; a chunk taken in part keeps the rest. */
  private fun takeLocked(max: Int): List<Chunk> {
    val taken = ArrayList<Chunk>(2)
    var left = max
    while (left > 0 && chunks.isNotEmpty()) {
      val head = chunks.first()
      val available = head.end - head.start
      if (available <= left) {
        chunks.removeFirst()
        taken.add(head)
        left -= available
      } else {
        taken.add(Chunk(head.data, head.start, head.start + left))
        head.start += left
        left = 0
      }
    }
    unread -= max - left
    return taken
  }

  companion object {
    /** The contract's limit: the transfer pauses while more than 1 MiB is unread. */
    const val HIGH_WATER = 1024 * 1024
    private const val CHUNK = 64 * 1024
  }
}
