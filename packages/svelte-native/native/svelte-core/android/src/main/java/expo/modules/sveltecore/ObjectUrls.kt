package expo.modules.sveltecore

import java.io.File
import java.io.FileOutputStream
import java.io.IOException
import java.util.UUID

/** The files behind `URL.createObjectURL`: `<cache>/svelte-native-blobs/<uuid>`, one per Blob that asked for a URL. */
internal class ObjectUrls(private val directory: File) {
  /** Writes the Blob's bytes to a new file and returns its `file://` URL. Synchronous, as `createObjectURL` is. */
  @Throws(IOException::class)
  fun create(data: BlobData): String {
    if (!directory.isDirectory && !directory.mkdirs() && !directory.isDirectory) throw IOException("Cannot create ${directory.path}")
    val name = UUID.randomUUID().toString()
    val partial = File(directory, "$name.part")
    try {
      FileOutputStream(partial).use { out ->
        data.copyTo(0, data.size) { bytes, offset, count -> out.write(bytes, offset, count) }
      }
      val file = File(directory, name)
      if (!partial.renameTo(file)) throw IOException("Cannot move ${partial.path} to ${file.path}")
      return FileUrls.urlOf(file)
    } finally {
      partial.delete()
    }
  }

  /** Whether the file behind a URL this class returned is still there (it is gone once revoked, or when the system cleared the cache). */
  fun exists(url: String): Boolean = FileUrls.pathOf(url)?.let { File(it).isFile } ?: false

  /** Deletes the file behind `url` when it is a file of this directory; any other URL is ignored. */
  fun revoke(url: String) {
    val path = FileUrls.pathOf(url) ?: return
    try {
      val file = File(path).canonicalFile
      if (file.parentFile == directory.canonicalFile && file.isFile) file.delete()
    } catch (_: IOException) {
      // A path that cannot be resolved is not one of ours.
    }
  }

  /** Deletes what is older than `before`; see [sweepOlderThan]. */
  fun sweep(before: Long) = sweepOlderThan(directory, before)
}
