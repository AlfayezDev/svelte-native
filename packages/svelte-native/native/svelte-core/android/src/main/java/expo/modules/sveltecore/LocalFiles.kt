package expo.modules.sveltecore

import okio.Buffer
import okio.Source
import okio.Timeout
import java.io.Closeable
import java.io.File
import java.io.FileNotFoundException
import java.io.IOException
import java.io.InputStream
import java.io.RandomAccessFile
import java.nio.ByteBuffer
import java.nio.charset.StandardCharsets

/** A local file opened for reading. Reads are positional, so one handle serves a Blob's file range and a file response alike. */
internal interface FileHandle : Closeable {
  /** The size in bytes, or -1 when the provider does not say. */
  val size: Long

  /** Reads into `dst` from `position`; the count read, or -1 at the end of the file. */
  @Throws(IOException::class)
  fun read(position: Long, dst: ByteBuffer): Int
}

/** How a `file://` or `content://` URL is opened; the module supplies the Android one, the host checks the plain one. */
internal interface FileAccess {
  @Throws(IOException::class)
  fun open(uri: String): FileHandle
}

/** `file://` URLs through `java.io`. */
internal open class LocalFiles : FileAccess {
  override fun open(uri: String): FileHandle {
    val path = FileUrls.pathOf(uri) ?: throw FileNotFoundException("Not a file URL: $uri")
    val file = RandomAccessFile(path, "r")
    return object : FileHandle {
      private val channel = file.channel
      override val size: Long = channel.size()

      override fun read(position: Long, dst: ByteBuffer): Int = channel.read(dst, position)

      override fun close() = file.close()
    }
  }
}

/**
 * A provider that only hands out a stream (a content provider may not give a seekable descriptor): forward reads continue the stream, a read before its
 * position reopens it. `size` is unknown until asked, then counted by reading the stream to its end once.
 */
internal class StreamHandle(private val reopen: () -> InputStream, private val declaredSize: Long = -1) : FileHandle {
  private var stream: InputStream = reopen()
  private var position = 0L
  private var counted = declaredSize

  override val size: Long
    @Synchronized get() {
      if (counted < 0) {
        counted = 0
        reopen().use { input ->
          val scratch = ByteArray(8192)
          while (true) {
            val n = input.read(scratch)
            if (n < 0) break
            counted += n
          }
        }
      }
      return counted
    }

  @Synchronized
  override fun read(position: Long, dst: ByteBuffer): Int {
    if (position < this.position) {
      stream.close()
      stream = reopen()
      this.position = 0
    }
    while (this.position < position) {
      val skipped = stream.skip(position - this.position)
      if (skipped <= 0) {
        if (stream.read() < 0) return -1
        this.position++
      } else {
        this.position += skipped
      }
    }
    val scratch = ByteArray(minOf(dst.remaining(), 65536))
    val n = stream.read(scratch)
    if (n > 0) {
      dst.put(scratch, 0, n)
      this.position += n
    }
    return n
  }

  @Synchronized
  override fun close() = stream.close()
}

/** A file as an Okio source, so a file response flows through the same body buffer as a network one. */
internal class HandleSource(private val handle: FileHandle) : Source {
  private var position = 0L
  private val scratch = ByteBuffer.wrap(ByteArray(8192))

  override fun read(sink: Buffer, byteCount: Long): Long {
    if (byteCount == 0L) return 0
    scratch.clear()
    scratch.limit(minOf(byteCount, scratch.capacity().toLong()).toInt())
    val n = handle.read(position, scratch)
    if (n < 0) return -1
    position += n
    sink.write(scratch.array(), 0, n)
    return n.toLong()
  }

  override fun timeout(): Timeout = Timeout.NONE

  override fun close() = handle.close()
}

internal object FileUrls {
  /** The path a `file://` URL names (host `localhost` or none, query and fragment dropped, percent escapes decoded), or null for any other URL. */
  fun pathOf(url: String): String? {
    if (!url.startsWith("file:", ignoreCase = true)) return null
    var rest = url.substring(5)
    val cut = rest.indexOfFirst { it == '?' || it == '#' }
    if (cut >= 0) rest = rest.substring(0, cut)
    if (rest.startsWith("//")) {
      val slash = rest.indexOf('/', 2)
      val authority = if (slash < 0) rest.substring(2) else rest.substring(2, slash)
      if (authority.isNotEmpty() && !authority.equals("localhost", ignoreCase = true)) return null
      rest = if (slash < 0) "" else rest.substring(slash)
    }
    return if (rest.startsWith("/")) percentDecode(rest) else null
  }

  /** `file://` plus the path, with everything outside the unreserved set and `/` escaped. */
  fun urlOf(file: File): String {
    val out = StringBuilder("file://")
    for (b in file.absolutePath.toByteArray(StandardCharsets.UTF_8)) {
      val c = (b.toInt() and 0xFF).toChar()
      if (c in 'a'..'z' || c in 'A'..'Z' || c in '0'..'9' || c == '/' || c == '-' || c == '_' || c == '.' || c == '~') {
        out.append(c)
      } else {
        out.append('%').append("0123456789ABCDEF"[(b.toInt() shr 4) and 0xF]).append("0123456789ABCDEF"[b.toInt() and 0xF])
      }
    }
    return out.toString()
  }

  private fun percentDecode(text: String): String {
    if (text.indexOf('%') < 0) return text
    val bytes = java.io.ByteArrayOutputStream(text.length)
    var i = 0
    while (i < text.length) {
      val high = if (text[i] == '%' && i + 2 < text.length) Character.digit(text[i + 1], 16) else -1
      val low = if (high >= 0) Character.digit(text[i + 2], 16) else -1
      if (low >= 0) {
        bytes.write(high * 16 + low)
        i += 3
      } else {
        // A run up to the next `%`: encoded as a whole, so a surrogate pair is not split.
        var end = text.indexOf('%', i + 1)
        if (end < 0) end = text.length
        bytes.write(Utf8.encode(text.substring(i, end)))
        i = end
      }
    }
    return String(bytes.toByteArray(), StandardCharsets.UTF_8)
  }
}
