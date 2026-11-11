package expo.modules.svelteengine

import java.text.BreakIterator
import java.util.Locale

/**
 * `TextTransform.apply` of React Native: the text a fragment's `textTransform` lays out. Free of Android classes so that the touch rules, which need the length of
 * what was laid out (an uppercased `ß` is two characters, a lowercased `İ` is two in English), can be checked on the host.
 */
object TextTransform {
  const val NONE = 0
  const val UPPERCASE = 1
  const val LOWERCASE = 2
  const val CAPITALIZE = 3

  fun apply(text: String, mode: Int, locale: Locale = Locale.getDefault()): String = when (mode) {
    UPPERCASE -> text.uppercase(locale)
    LOWERCASE -> text.lowercase(locale)
    CAPITALIZE -> {
      val words = BreakIterator.getWordInstance(locale)
      words.setText(text)
      val out = StringBuilder(text.length)
      var start = words.first()
      var end = words.next()
      while (end != BreakIterator.DONE) {
        out.append(text.substring(start, end).replaceFirstChar { it.uppercaseChar() })
        start = end
        end = words.next()
      }
      out.toString()
    }
    else -> text
  }
}
