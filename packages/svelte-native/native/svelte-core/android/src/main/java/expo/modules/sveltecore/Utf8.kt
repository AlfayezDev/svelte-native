package expo.modules.sveltecore

import java.nio.ByteBuffer
import java.nio.charset.CharacterCodingException
import java.nio.charset.CodingErrorAction

/**
 * UTF-8 as the Encoding standard has it, which differs from the platform's in two places the contract depends on: a lone surrogate encodes as U+FFFD (the
 * platform writes `?`), and decoding replaces each maximal invalid prefix with one U+FFFD after dropping a leading byte order mark. Android's decoders do not
 * all agree on the second, so the replacement path is written here instead of trusted.
 */
internal object Utf8 {
  private const val REPLACEMENT = 0xFFFD

  fun encode(text: String): ByteArray {
    var size = 0
    var i = 0
    while (i < text.length) {
      val c = text[i]
      when {
        c.code < 0x80 -> size += 1
        c.code < 0x800 -> size += 2
        c.isHighSurrogate() && i + 1 < text.length && text[i + 1].isLowSurrogate() -> {
          size += 4
          i++
        }
        else -> size += 3 // a BMP character, or a lone surrogate written as U+FFFD
      }
      i++
    }
    val out = ByteArray(size)
    var at = 0
    i = 0
    while (i < text.length) {
      val c = text[i]
      val code = c.code
      when {
        code < 0x80 -> out[at++] = code.toByte()
        code < 0x800 -> {
          out[at++] = (0xC0 or (code shr 6)).toByte()
          out[at++] = (0x80 or (code and 0x3F)).toByte()
        }
        c.isHighSurrogate() && i + 1 < text.length && text[i + 1].isLowSurrogate() -> {
          val point = Character.toCodePoint(c, text[i + 1])
          out[at++] = (0xF0 or (point shr 18)).toByte()
          out[at++] = (0x80 or ((point shr 12) and 0x3F)).toByte()
          out[at++] = (0x80 or ((point shr 6) and 0x3F)).toByte()
          out[at++] = (0x80 or (point and 0x3F)).toByte()
          i++
        }
        else -> {
          val point = if (c.isSurrogate()) REPLACEMENT else code
          out[at++] = (0xE0 or (point shr 12)).toByte()
          out[at++] = (0x80 or ((point shr 6) and 0x3F)).toByte()
          out[at++] = (0x80 or (point and 0x3F)).toByte()
        }
      }
      i++
    }
    return out
  }

  /** "UTF-8 decode" of the Encoding standard over `bytes[offset, offset + length)`. */
  fun decode(bytes: ByteArray, offset: Int = 0, length: Int = bytes.size - offset): String {
    var start = offset
    var count = length
    if (count >= 3 && bytes[start] == 0xEF.toByte() && bytes[start + 1] == 0xBB.toByte() && bytes[start + 2] == 0xBF.toByte()) {
      start += 3
      count -= 3
    }
    // Valid input, nearly always, takes the platform's decoder; only the first malformed byte sends the whole input down the slow path below.
    try {
      return Charsets.UTF_8.newDecoder()
        .onMalformedInput(CodingErrorAction.REPORT)
        .onUnmappableCharacter(CodingErrorAction.REPORT)
        .decode(ByteBuffer.wrap(bytes, start, count))
        .toString()
    } catch (_: CharacterCodingException) {
      return decodeWithReplacement(bytes, start, count)
    }
  }

  /** The standard's decoder, step for step: `needed` continuation bytes are still due, and the next one must lie in [lower, upper]. */
  internal fun decodeWithReplacement(bytes: ByteArray, offset: Int, length: Int): String {
    val out = StringBuilder(length)
    var point = 0
    var needed = 0
    var seen = 0
    var lower = 0x80
    var upper = 0xBF
    var i = offset
    val end = offset + length
    while (i < end) {
      val b = bytes[i].toInt() and 0xFF
      if (needed == 0) {
        when {
          b <= 0x7F -> out.append(b.toChar())
          b in 0xC2..0xDF -> {
            needed = 1
            point = b and 0x1F
          }
          b in 0xE0..0xEF -> {
            if (b == 0xE0) lower = 0xA0
            if (b == 0xED) upper = 0x9F
            needed = 2
            point = b and 0xF
          }
          b in 0xF0..0xF4 -> {
            if (b == 0xF0) lower = 0x90
            if (b == 0xF4) upper = 0x8F
            needed = 3
            point = b and 0x7
          }
          else -> out.append(REPLACEMENT.toChar())
        }
        i++
        continue
      }
      if (b < lower || b > upper) {
        // The sequence ends here with an error, and this byte starts over (it is not consumed).
        point = 0
        needed = 0
        seen = 0
        lower = 0x80
        upper = 0xBF
        out.append(REPLACEMENT.toChar())
        continue
      }
      lower = 0x80
      upper = 0xBF
      point = (point shl 6) or (b and 0x3F)
      seen++
      if (seen == needed) {
        out.appendCodePoint(point)
        point = 0
        needed = 0
        seen = 0
      }
      i++
    }
    if (needed != 0) out.append(REPLACEMENT.toChar())
    return out.toString()
  }
}
