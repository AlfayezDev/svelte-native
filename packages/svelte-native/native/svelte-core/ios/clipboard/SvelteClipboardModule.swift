import ExpoModulesCore
import UIKit
import UniformTypeIdentifiers

/// The system clipboard behind `navigator.clipboard` (`src/clipboard.ts`): its text, as plain text and as HTML. Reading it shows iOS's
/// paste permission prompt, as reading the clipboard does in Safari.
public final class SvelteClipboardModule: Module {
  public func definition() -> ModuleDefinition {
    Name("SvelteClipboard")

    // The first item by type: "text/plain" and "text/html" when it has them. Nothing for an empty clipboard.
    AsyncFunction("read") { () -> [String: String] in
      let board = UIPasteboard.general
      var result: [String: String] = [:]
      if let text = board.string {
        result["text/plain"] = text
      }
      if let html = board.value(forPasteboardType: UTType.html.identifier) as? String {
        result["text/html"] = html
      } else if let data = board.data(forPasteboardType: UTType.html.identifier), let html = String(data: data, encoding: .utf8) {
        result["text/html"] = html
      }
      return result
    }.runOnQueue(.main)

    // One item: the text, and the same content as HTML when there is any.
    AsyncFunction("write") { (text: String, html: String?) in
      var item: [String: Any] = [UTType.utf8PlainText.identifier: text]
      if let html {
        item[UTType.html.identifier] = html
      }
      UIPasteboard.general.setItems([item])
    }.runOnQueue(.main)
  }
}
