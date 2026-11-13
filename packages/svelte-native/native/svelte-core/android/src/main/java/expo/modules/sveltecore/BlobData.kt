package expo.modules.sveltecore

import java.io.IOException
import java.nio.ByteBuffer

/** Allocates a buffer of exactly this many bytes: a direct one in the module (Expo wraps a direct buffer as an ArrayBuffer without copying), a heap one in checks. */
internal typealias Alloc = (Int) -> ByteBuffer

/** Where [BlobData.copyTo] hands bytes; a piece is valid only during the call. */
internal fun interface ByteSink {
  @Throws(IOException::class)
  fun write(bytes: ByteArray, offset: Int, count: Int)
}

/** An immutable run of a Blob's bytes. */
internal sealed class Segment {
  abstract val length: Long

  abstract fun slice(start: Long, end: Long): Segment
}

/** A range of a byte array, shared with every Blob sliced from it. */
internal class MemorySegment(val bytes: ByteArray, val offset: Int, val count: Int) : Segment() {
  override val length: Long get() = count.toLong()

  override fun slice(start: Long, end: Long) = MemorySegment(bytes, offset + start.toInt(), (end - start).toInt())
}

/** A range of a file, read when its bytes are needed. */
internal class FileSegment(val files: FileAccess, val uri: String, val offset: Long, override val length: Long) : Segment() {
  override fun slice(start: Long, end: Long) = FileSegment(files, uri, offset + start, end - start)
}

/**
 * A Blob's bytes as an ordered list of segments. Joining and slicing share segments; nothing is copied until something reads. Slicing costs a binary search
 * and the segments the range touches, however many bytes the range holds.
 */
internal class BlobData private constructor(private val segments: List<Segment>) {
  /** `ends[i]`: the offset just past segment i. */
  private val ends = LongArray(segments.size).also { ends ->
    var total = 0L
    for (i in segments.indices) {
      total += segments[i].length
      ends[i] = total
    }
  }

  val size: Long get() = if (ends.isEmpty()) 0 else ends[ends.size - 1]

  /** Bytes held in memory (as opposed to ranges of files), for the JavaScript engine's memory pressure. */
  val memoryBytes: Int
    get() {
      var total = 0L
      for (segment in segments) if (segment is MemorySegment) total += segment.count
      return total.coerceAtMost(Int.MAX_VALUE.toLong()).toInt()
    }

  /** The first segment that ends after `offset` (the segment count when none does). */
  private fun segmentAt(offset: Long): Int {
    var low = 0
    var high = ends.size
    while (low < high) {
      val mid = (low + high) ushr 1
      if (ends[mid] > offset) high = mid else low = mid + 1
    }
    return low
  }

  fun slice(start: Long, end: Long): BlobData {
    val from = start.coerceIn(0, size)
    val to = end.coerceIn(from, size)
    if (from == 0L && to == size) return this
    if (from == to) return EMPTY
    val first = segmentAt(from)
    val last = segmentAt(to - 1)
    val picked = ArrayList<Segment>(last - first + 1)
    for (i in first..last) {
      val segmentStart = if (i == 0) 0L else ends[i - 1]
      val lo = maxOf(from, segmentStart) - segmentStart
      val hi = minOf(to, ends[i]) - segmentStart
      val segment = segments[i]
      picked.add(if (lo == 0L && hi == segment.length) segment else segment.slice(lo, hi))
    }
    return BlobData(picked)
  }

  /**
   * Hands the bytes in [offset, offset + length) to `out` in pieces, in order. A file shorter than it was when the Blob was made is an `IOException`, as is
   * anything the file system says.
   */
  @Throws(IOException::class)
  fun copyTo(offset: Long, length: Long, out: ByteSink) {
    val end = minOf(offset + length, size)
    if (offset >= end) return
    var i = segmentAt(offset)
    while (i < segments.size) {
      val segmentStart = if (i == 0) 0L else ends[i - 1]
      if (segmentStart >= end) break
      val from = maxOf(offset, segmentStart) - segmentStart
      val to = minOf(end, ends[i]) - segmentStart
      when (val segment = segments[i]) {
        is MemorySegment -> out.write(segment.bytes, segment.offset + from.toInt(), (to - from).toInt())
        is FileSegment -> copyFile(segment, from, to, out)
      }
      i++
    }
  }

  private fun copyFile(segment: FileSegment, from: Long, to: Long, out: ByteSink) {
    segment.files.open(segment.uri).use { handle ->
      val scratch = ByteArray(minOf(to - from, CHUNK.toLong()).toInt())
      val buffer = ByteBuffer.wrap(scratch)
      var position = segment.offset + from
      var remaining = to - from
      while (remaining > 0) {
        buffer.clear()
        buffer.limit(minOf(remaining, scratch.size.toLong()).toInt())
        val n = handle.read(position, buffer)
        if (n <= 0) throw IOException("${segment.uri} is shorter than it was when its Blob was made")
        out.write(scratch, 0, n)
        position += n
        remaining -= n
      }
    }
  }

  /** Up to `length` bytes from `offset` (fewer only at the end of the Blob), in a buffer `alloc` made for exactly that many. */
  @Throws(IOException::class)
  fun read(offset: Long, length: Long, alloc: Alloc): ByteBuffer {
    val start = offset.coerceIn(0, size)
    val count = minOf(length.coerceAtLeast(0), size - start)
    if (count > Int.MAX_VALUE) throw IOException("$count bytes do not fit in one buffer")
    val buffer = alloc(count.toInt())
    copyTo(start, count) { bytes, at, n -> buffer.put(bytes, at, n) }
    buffer.flip()
    return buffer
  }

  companion object {
    private const val CHUNK = 64 * 1024

    val EMPTY = BlobData(emptyList())

    fun ofBytes(bytes: ByteArray): BlobData = if (bytes.isEmpty()) EMPTY else BlobData(listOf(MemorySegment(bytes, 0, bytes.size)))

    /** The parts joined in order, sharing their segments. */
    fun concat(parts: List<BlobData>): BlobData {
      if (parts.size == 1) return parts[0]
      val all = ArrayList<Segment>()
      for (part in parts) all.addAll(part.segments)
      return if (all.isEmpty()) EMPTY else BlobData(all)
    }

    /** The whole of the file `uri` names, at its size now. */
    @Throws(IOException::class)
    fun ofFile(files: FileAccess, uri: String): BlobData {
      val size = files.open(uri).use { it.size }
      return if (size == 0L) EMPTY else BlobData(listOf(FileSegment(files, uri, 0, size)))
    }

    /** Chunks of a body kept as they arrived, without copying them. */
    fun ofChunks(chunks: List<Chunk>): BlobData {
      val segments = ArrayList<Segment>(chunks.size)
      for (chunk in chunks) if (chunk.end > chunk.start) segments.add(MemorySegment(chunk.data, chunk.start, chunk.end - chunk.start))
      return if (segments.isEmpty()) EMPTY else BlobData(segments)
    }
  }
}
