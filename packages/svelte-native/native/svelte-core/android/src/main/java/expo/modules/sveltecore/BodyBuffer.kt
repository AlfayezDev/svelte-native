package expo.modules.sveltecore

import okio.BufferedSource
import java.io.FileOutputStream
import java.io.IOException
import java.io.OutputStream
import java.nio.ByteBuffer
import java.util.concurrent.Executor

/** Bytes of a response body as they arrived: `data[start, end)`. Never written after it is queued, so a consumer may read it outside the lock. */
internal class Chunk(val data: ByteArray, var start: Int, val end: Int)

/** The chunks as one buffer `alloc` made for exactly their total size; a body that does not fit in one buffer is an error, not an overflow. */
internal fun List<Chunk>.assemble(alloc: Alloc): ByteBuffer {
  var total = 0L
  for (chunk in this) total += chunk.end - chunk.start
  if (total > Int.MAX_VALUE) throw FetchError(FetchCodes.NETWORK, "The body is $total bytes, more than one buffer holds")
  val buffer = alloc(total.toInt())
  for (chunk in this) buffer.put(chunk.data, chunk.start, chunk.end - chunk.start)
  buffer.flip()
  return buffer
}

/**
 * The body of one response, between a background reader and a consumer that asks for it a piece at a time.
 *
 * A pump on the executor reads the source (blocking, never on a caller's thread) into chunks and stops while 1 MiB or more is unread; the transfer then pauses
 * through TCP flow control and no thread waits meanwhile, because a pump that stopped has returned. A consumer takes the body one way, once: `read` as often as it
 * likes, or one of the two ways of taking all of it, which lift the pause:
 *  - [readAllBytes]: one buffer. When the length is known the pump fills that buffer directly, so the body is never held twice; when it is not, chunks collect
 *    (up to `maxBuffer` bytes) and are copied into the buffer at the end.
 *  - [readAllBlob]: a Blob. The bytes stay native: past `spillAfter` bytes they go to a [TempFiles] file and the Blob is a range of that file (plus the
 *    little that arrived since the last write), so a download larger than the Java heap can still be a Blob.
 * Every answer is delivered from the executor, never from the consumer's call.
 */
internal class BodyBuffer(
  private val source: BufferedSource,
  private val release: () -> Unit,
  private val executor: Executor,
  private val alloc: Alloc,
  /** The length of the body when the response says (a Content-Length, a file's size), else -1. */
  private val expectedLength: Long = -1,
  private val temps: TempFiles? = null,
  private val highWater: Int = HIGH_WATER,
  private val maxBuffer: Long = Int.MAX_VALUE.toLong(),
  private val spillAfter: Long = SPILL_AFTER
) {
  private sealed class Waiter {
    abstract fun reject(error: FetchError)

    class Read(val max: Int, val reply: Reply<ByteBuffer?>) : Waiter() {
      override fun reject(error: FetchError) = reply.reject(error)
    }

    class Bytes(val alloc: Alloc, val reply: Reply<ByteBuffer>) : Waiter() {
      override fun reject(error: FetchError) = reply.reject(error)
    }

    class Blob(val reply: Reply<BlobData>) : Waiter() {
      override fun reject(error: FetchError) = reply.reject(error)
    }
  }

  private enum class Mode { NONE, STREAM, BYTES, BLOB }

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

  // Taking all as bytes with a known length: the buffer the pump fills.
  private var target: ByteBuffer? = null
  private var targetTried = false

  // Taking all as a Blob: the file that has the first `spilledBytes` bytes, the batch waiting to be written to it, and the stream that writes it (the pump's alone).
  private var spillTemp: TempFile? = null
  private var spilledBytes = 0L
  private var spillBatch: List<Chunk>? = null
  private var spillOut: OutputStream? = null

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
        (mode != Mode.NONE && mode != Mode.STREAM) || waiter != null -> delivery = { reply.reject(FetchError.bodyUsed()) }
        else -> {
          mode = Mode.STREAM
          waiter = Waiter.Read(max.coerceAtLeast(1), reply)
          delivery = serveLocked()
          schedulePumpLocked()
        }
      }
    }
    deliverLater(delivery)
  }

  /** The rest of the body as one buffer made by `alloc`, once it has all arrived. */
  fun readAllBytes(alloc: Alloc, reply: Reply<ByteBuffer>) = gather(Mode.BYTES, Waiter.Bytes(alloc, reply))

  /** The rest of the body as a Blob, once it has all arrived. */
  fun readAllBlob(reply: Reply<BlobData>) = gather(Mode.BLOB, Waiter.Blob(reply))

  private fun gather(taking: Mode, pending: Waiter) {
    var delivery: (() -> Unit)? = null
    synchronized(lock) {
      when {
        closed -> delivery = { pending.reject(FetchError.aborted()) }
        mode != Mode.NONE -> delivery = { pending.reject(FetchError.bodyUsed()) }
        else -> {
          mode = taking
          waiter = pending
          delivery = serveLocked()
          schedulePumpLocked()
        }
      }
    }
    deliverLater(delivery)
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
      target = null
      spillBatch = null
      pending = waiter
      waiter = null
      // A pump that is running closes the source itself when its read returns; with none running, nobody else will.
      if (!pumping) releaseNow = markReleasedLocked()
    }
    deliver { pending?.reject(FetchError.aborted()) }
    // Closing a response can read what is left of it (OkHttp tries for 100 ms), so not on the thread that aborted, which may be JavaScript's.
    if (releaseNow) executor.execute { releaseQuietly() }
    return true
  }

  private fun markReleasedLocked(): Boolean {
    if (released) return false
    released = true
    return true
  }

  private fun gatheringLocked() = mode == Mode.BYTES || mode == Mode.BLOB

  /** A pump is wanted when something can still arrive and either everything is wanted or at most half of the limit is unread. */
  private fun schedulePumpLocked() {
    if (pumping || closed || eof || failure != null) return
    if (!gatheringLocked() && unread > highWater / 2) return
    pumping = true
    executor.execute { pump() }
  }

  private fun pump() {
    var scratch: ByteArray? = null
    try {
      while (pumpGoesOn()) {
        var failed: FetchError? = null
        var n = -1
        var chunk: Chunk? = null
        try {
          writeSpilledBatch()
          val filling = bufferToFill()
          if (filling != null) {
            n = if (filling.hasRemaining()) source.read(filling) else -1
          } else {
            val bytes = scratch ?: ByteArray(CHUNK).also { scratch = it }
            n = source.read(bytes, 0, bytes.size)
            if (n > 0) chunk = Chunk(bytes.copyOfRange(0, n), 0, n)
          }
          if (n < 0) closeSpill()
        } catch (e: FetchError) {
          failed = e
        } catch (e: IOException) {
          failed = FetchError.network(e)
        } catch (e: RuntimeException) {
          // OkHttp reports a source closed from another thread as an IllegalStateException, and a provider may throw anything.
          failed = FetchError.network(e)
        }
        var delivery: (() -> Unit)? = null
        var releaseNow = false
        synchronized(lock) {
          if (closed) {
            pumping = false
            releaseNow = markReleasedLocked()
          } else {
            val error = failed
            val arrived = chunk
            when {
              error != null -> failure = error
              n < 0 -> eof = true
              arrived != null -> {
                chunks.addLast(arrived)
                unread += arrived.end - arrived.start
                if (unread > peakUnread) peakUnread = unread
                if (mode == Mode.BYTES && target == null && unread > maxBuffer) {
                  failure = FetchError(FetchCodes.NETWORK, "The body is more than $maxBuffer bytes, more than one buffer holds")
                }
                takeSpillBatchLocked()
              }
            }
            delivery = serveLocked()
            if (eof || failure != null) {
              pumping = false
              releaseNow = markReleasedLocked()
            }
          }
        }
        deliver(delivery)
        if (releaseNow) releaseQuietly()
      }
    } catch (e: OutOfMemoryError) {
      // Out of memory fails this one fetch. Left uncaught it would end the pump thread, and with it the app, with the promise still pending.
      outOfMemory(e)
    } finally {
      closeSpillQuietly()
    }
  }

  /** The pump ran out of memory, anywhere: what had collected is let go first, since nothing can even be reported while the heap is full. */
  private fun outOfMemory(cause: OutOfMemoryError) {
    var delivery: (() -> Unit)? = null
    var releaseNow = false
    synchronized(lock) {
      chunks.clear()
      unread = 0
      target = null
      spillBatch = null
      if (!closed) {
        failure = FetchError(FetchCodes.NETWORK, "Not enough memory for the body", cause)
        delivery = serveLocked()
      }
      pumping = false
      releaseNow = markReleasedLocked()
    }
    deliver(delivery)
    if (releaseNow) releaseQuietly()
  }

  /** Whether to read on. When not, the pump is over, and the source is closed if the body is over for good (it stays open while only paused). */
  private fun pumpGoesOn(): Boolean {
    var releaseNow = false
    val goesOn = synchronized(lock) {
      val wanted = !closed && !eof && failure == null && (gatheringLocked() || unread < highWater)
      if (!wanted) {
        pumping = false
        if (closed || eof || failure != null) releaseNow = markReleasedLocked()
      }
      wanted
    }
    if (releaseNow) releaseQuietly()
    return goesOn
  }

  /**
   * For all-as-bytes of a body whose length is known: the buffer to read into, made on first use with what is already queued copied in. Null when the length is
   * unknown or the consumer takes the body another way (the pump then fills chunks). A length no buffer can hold, or no memory for it, fails the fetch.
   */
  private fun bufferToFill(): ByteBuffer? {
    val pending: Waiter.Bytes
    synchronized(lock) {
      target?.let { return it }
      pending = waiter as? Waiter.Bytes ?: return null
      if (targetTried || expectedLength < 0) return null
      targetTried = true
    }
    if (expectedLength > Int.MAX_VALUE) {
      throw FetchError(FetchCodes.NETWORK, "The body is $expectedLength bytes, more than one buffer holds")
    }
    val fresh = try {
      pending.alloc(expectedLength.toInt())
    } catch (e: OutOfMemoryError) {
      throw FetchError(FetchCodes.NETWORK, "Not enough memory for $expectedLength bytes", e)
    }
    synchronized(lock) {
      if (closed) return null
      if (unread > expectedLength) throw FetchError(FetchCodes.NETWORK, "The body is longer than its Content-Length")
      for (queued in chunks) fresh.put(queued.data, queued.start, queued.end - queued.start)
      chunks.clear()
      unread = 0
      target = fresh
    }
    return fresh
  }

  /** Under the lock: once enough has collected for a Blob that is too big to keep, takes it out of the queue to be written to the file (by the pump, next). */
  private fun takeSpillBatchLocked() {
    if (mode != Mode.BLOB || temps == null || spillBatch != null) return
    if (unread < (if (spilledBytes == 0L) spillAfter else SPILL_STEP)) return
    spillBatch = chunks.toList()
    chunks.clear()
    spilledBytes += unread
    unread = 0
  }

  private fun writeSpilledBatch() {
    val batch = synchronized(lock) { spillBatch } ?: return
    val out = spillOut ?: run {
      val temp = temps!!.create()
      synchronized(lock) { spillTemp = temp }
      FileOutputStream(temp.file).also { spillOut = it }
    }
    for (part in batch) out.write(part.data, part.start, part.end - part.start)
    synchronized(lock) { spillBatch = null }
  }

  private fun closeSpill() {
    val out = spillOut ?: return
    spillOut = null
    out.close()
  }

  private fun closeSpillQuietly() {
    try {
      closeSpill()
    } catch (_: IOException) {
      // The Blob that wanted the file is not coming.
    }
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
      if (pending !is Waiter.Read) {
        // Whoever takes all of a body wants none of it when it fails; what had collected (perhaps all the memory there was) is let go now.
        chunks.clear()
        unread = 0
        target = null
        spillBatch = null
      }
      return { pending.reject(error) }
    }
    if (!eof) return null
    waiter = null
    finished = true
    if (pending is Waiter.Read) return { pending.reply.resolve(null) }
    if (pending is Waiter.Bytes) {
      val filled = target
      target = null
      val queued = chunks.toList()
      chunks.clear()
      unread = 0
      return {
        try {
          pending.reply.resolve(if (filled != null) exact(filled, pending.alloc) else queued.assemble(pending.alloc))
        } catch (e: FetchError) {
          pending.reply.reject(e)
        } catch (e: OutOfMemoryError) {
          pending.reply.reject(FetchError(FetchCodes.NETWORK, "Not enough memory for the body", e))
        }
      }
    }
    pending as Waiter.Blob
    val temp = spillTemp
    val spilled = spilledBytes
    val tail = chunks.toList()
    chunks.clear()
    unread = 0
    return {
      val parts = ArrayList<BlobData>(2)
      if (temp != null && spilled > 0) parts.add(temp.blob(spilled))
      parts.add(BlobData.ofChunks(tail))
      pending.reply.resolve(BlobData.concat(parts))
    }
  }

  /** The filled buffer as the answer: made to start at 0 and end where the bytes end, copied into a smaller one only when the body fell short of its length. */
  private fun exact(filled: ByteBuffer, alloc: Alloc): ByteBuffer {
    filled.flip()
    if (filled.limit() == filled.capacity()) return filled
    return alloc(filled.limit()).also {
      it.put(filled)
      it.flip()
    }
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

  /** Runs an answer on the executor: the consumer's own thread is not asked to copy bytes. */
  private fun deliverLater(task: (() -> Unit)?) {
    if (task != null) executor.execute { deliver(task) }
  }

  /** A reply that throws must not take the pump thread down with it; there is nobody to tell. */
  private fun deliver(task: (() -> Unit)?) {
    try {
      task?.invoke()
    } catch (_: Exception) {
    }
  }

  /** Closing is best effort: a source that fails to close has nothing left to lose. */
  private fun releaseQuietly() {
    try {
      release()
    } catch (_: Exception) {
    }
  }

  companion object {
    /** The contract's limit: the transfer pauses while more than 1 MiB is unread. */
    const val HIGH_WATER = 1024 * 1024

    /** A body taken as a Blob stays in memory up to this size; past it the bytes go to a file. */
    const val SPILL_AFTER = 16L * 1024 * 1024

    /** After the first write the file is appended to in pieces of at least this many bytes. */
    const val SPILL_STEP = 1024L * 1024

    private const val CHUNK = 64 * 1024
  }
}
