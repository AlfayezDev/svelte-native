package expo.modules.sveltecore

import okhttp3.MediaType
import okhttp3.RequestBody
import okio.BufferedSink

/**
 * A Blob sent as a request body, streamed from its segments (file ranges are read as they are written). It has no media type: JavaScript sets `Content-Type`
 * as a header, and OkHttp adds one of its own only for a body that has a media type. It can be written again, which a 307 or 308 redirect needs.
 */
internal class BlobRequestBody(private val data: BlobData) : RequestBody() {
  override fun contentType(): MediaType? = null

  override fun contentLength(): Long = data.size

  override fun writeTo(sink: BufferedSink) {
    data.copyTo(0, data.size) { bytes, offset, count -> sink.write(bytes, offset, count) }
  }
}
