package expo.modules.sveltecore

import android.content.Context
import android.content.res.AssetFileDescriptor
import android.net.Uri
import android.system.ErrnoException
import android.system.Os
import android.system.OsConstants
import java.io.FileInputStream
import java.io.FileNotFoundException
import java.io.IOException
import java.nio.ByteBuffer

/** `file://` as on any JVM, `content://` through the content resolver. */
internal class AndroidFiles(private val context: Context) : LocalFiles() {
  override fun open(uri: String): FileHandle {
    if (!uri.startsWith("content:", ignoreCase = true)) return super.open(uri)
    try {
      return openContent(uri)
    } catch (e: IOException) {
      throw e
    } catch (e: Exception) {
      // A content provider is another app's code: a SecurityException for a permission missing, an NPE or IllegalStateException for whatever else.
      throw IOException("Cannot open $uri: ${e.message}", e)
    }
  }

  private fun openContent(uri: String): FileHandle {
    val parsed = Uri.parse(uri)
    val resolver = context.contentResolver
    val descriptor = resolver.openAssetFileDescriptor(parsed, "r") ?: throw FileNotFoundException(uri)
    if (isSeekable(descriptor)) return DescriptorHandle(descriptor)
    // A provider that hands out a pipe: positional reads are impossible, so the stream is read forward (Blob.ofFile copies such a file once).
    val declared = descriptor.length
    descriptor.close()
    return StreamHandle({ resolver.openInputStream(parsed) ?: throw FileNotFoundException(uri) }, declared)
  }

  private fun isSeekable(descriptor: AssetFileDescriptor): Boolean = try {
    Os.lseek(descriptor.fileDescriptor, 0, OsConstants.SEEK_CUR)
    true
  } catch (_: ErrnoException) {
    false
  }

  /** A descriptor of a real file (or a part of one, as an asset has): reads are positional, bounded by the range the provider declared. */
  private class DescriptorHandle(private val descriptor: AssetFileDescriptor) : FileHandle {
    private val channel = FileInputStream(descriptor.fileDescriptor).channel
    private val start = descriptor.startOffset

    override val size: Long = if (descriptor.length >= 0) descriptor.length else channel.size() - start

    override fun read(position: Long, dst: ByteBuffer): Int {
      val left = size - position
      if (left <= 0) return -1
      if (dst.remaining() <= left) return channel.read(dst, start + position)
      val limit = dst.limit()
      dst.limit(dst.position() + left.toInt())
      try {
        return channel.read(dst, start + position)
      } finally {
        dst.limit(limit)
      }
    }

    override fun close() = descriptor.close()
  }
}
