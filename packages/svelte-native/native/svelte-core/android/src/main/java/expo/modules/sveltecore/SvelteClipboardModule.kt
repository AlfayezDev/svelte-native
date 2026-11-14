package expo.modules.sveltecore

import android.content.ClipData
import android.content.ClipboardManager
import android.content.Context
import expo.modules.kotlin.exception.Exceptions
import expo.modules.kotlin.functions.Queues
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

/**
 * The system clipboard behind `navigator.clipboard` (`src/clipboard.ts`): its text, as plain text and as HTML. Android lets an app read
 * the clipboard only while one of its windows has the focus; at any other time the clipboard reads as empty.
 */
class SvelteClipboardModule : Module() {
  private val context: Context
    get() = appContext.reactContext ?: throw Exceptions.ReactContextLost()

  private val clipboard: ClipboardManager
    get() = context.getSystemService(Context.CLIPBOARD_SERVICE) as ClipboardManager

  override fun definition() = ModuleDefinition {
    Name("SvelteClipboard")

    // The first item of the clipboard by type: "text/plain" (the item as text, which is the text of an HTML item and the address of a URI
    // item) and "text/html" when the item has HTML. Nothing for an empty clipboard.
    AsyncFunction("read") {
      val item = clipboard.primaryClip?.takeIf { it.itemCount > 0 }?.getItemAt(0)
      val result = mutableMapOf<String, String>()
      if (item != null) {
        item.coerceToText(context)?.toString()?.let { result["text/plain"] = it }
        item.htmlText?.let { result["text/html"] = it }
      }
      result
    }.runOnQueue(Queues.MAIN)

    // One item: the text, and the same content as HTML when there is any.
    AsyncFunction("write") { text: String, html: String? ->
      clipboard.setPrimaryClip(if (html != null) ClipData.newHtmlText("", text, html) else ClipData.newPlainText("", text))
    }.runOnQueue(Queues.MAIN)
  }
}
