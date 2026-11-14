/**
 * `navigator.clipboard` and `ClipboardItem` on the device: the web's async Clipboard API over the system clipboard (the `SvelteClipboard`
 * module in `native/svelte-core`). Text, as `text/plain` and `text/html`: `readText()`, `writeText()`, and `read()` and `write()` with
 * `ClipboardItem`s of those two types. `polyfills.ts` defines both names lazily, so nothing of this loads until one is read.
 *
 * Where it differs from a browser: one item is read and written (the system clipboards hold one); a type other than the two is refused
 * with `NotAllowedError`, as Chrome refuses a type it does not support; there is no `clipboardchange` event. On Android the clipboard reads
 * as empty while none of the app's windows has the focus, and on iOS a read shows the system's paste prompt, as Safari's does.
 */

type NativeClipboard = {
  read(): Promise<Partial<Record<ClipboardType, string>>>;
  write(text: string, html: string | null): Promise<void>;
};

const TYPES = ["text/plain", "text/html"] as const;
type ClipboardType = (typeof TYPES)[number];
const supported = (type: string): type is ClipboardType => (TYPES as readonly string[]).includes(type);

type ItemData = string | Blob | PromiseLike<string | Blob>;

function notAllowed(message: string): Error {
  return typeof DOMException === "function" ? new DOMException(message, "NotAllowedError") : Object.assign(new Error(message), { name: "NotAllowedError" });
}

/** The web's `ClipboardItem`: data by MIME type, each a string, a `Blob` or a promise of one. */
export class ClipboardItem {
  readonly #items: ReadonlyMap<string, ItemData>;
  readonly presentationStyle: "unspecified" | "inline" | "attachment";

  constructor(items: Record<string, ItemData>, options: { presentationStyle?: "unspecified" | "inline" | "attachment" } = {}) {
    const entries = Object.entries(items ?? {});
    if (entries.length === 0) throw new TypeError("Failed to construct 'ClipboardItem': Empty dictionary argument");
    this.#items = new Map(entries);
    this.presentationStyle = options.presentationStyle ?? "unspecified";
  }

  get types(): readonly string[] {
    return Object.freeze([...this.#items.keys()]);
  }

  /** The data of one type, as a `Blob` of that type. */
  async getType(type: string): Promise<Blob> {
    if (!this.#items.has(type)) throw typeof DOMException === "function" ? new DOMException(`The type '${type}' was not found`, "NotFoundError") : new Error(`The type '${type}' was not found`);
    const data = await this.#items.get(type);
    return data instanceof Blob ? data : new Blob([String(data)], { type });
  }

  /** Whether `navigator.clipboard.write` takes the type here: `text/plain` and `text/html`. */
  static supports(type: string): boolean {
    return supported(type);
  }
}
Object.defineProperty(ClipboardItem.prototype, Symbol.toStringTag, { value: "ClipboardItem", configurable: true });

/** The web's `Clipboard` over the native module. */
export class Clipboard {
  readonly #native: NativeClipboard;

  constructor(native: NativeClipboard) {
    this.#native = native;
  }

  /** The clipboard's text; `""` when it holds none. */
  async readText(): Promise<string> {
    return (await this.#native.read())["text/plain"] ?? "";
  }

  async writeText(text: string): Promise<void> {
    await this.#native.write(String(text), null);
  }

  /** What the clipboard holds, as one `ClipboardItem` of its types; none when it is empty. */
  async read(): Promise<ClipboardItem[]> {
    const content = await this.#native.read();
    const types = TYPES.filter((type) => content[type] !== undefined);
    if (types.length === 0) return [];
    return [new ClipboardItem(Object.fromEntries(types.map((type) => [type, new Blob([content[type] as string], { type })])))];
  }

  /** Writes one item of `text/plain`, `text/html` or both (HTML alone is written with its text as the plain text). */
  async write(items: readonly ClipboardItem[]): Promise<void> {
    if (items.length === 0) return;
    if (items.length > 1) throw notAllowed("Support for multiple ClipboardItems is not implemented.");
    const [item] = items;
    for (const type of item.types) if (!supported(type)) throw notAllowed(`Type ${type} not supported on write.`);
    const text = item.types.includes("text/plain") ? await (await item.getType("text/plain")).text() : undefined;
    const html = item.types.includes("text/html") ? await (await item.getType("text/html")).text() : null;
    await this.#native.write(text ?? htmlText(html ?? ""), html);
  }
}
Object.defineProperty(Clipboard.prototype, Symbol.toStringTag, { value: "Clipboard", configurable: true });

/** The text of an HTML fragment, for the plain-text part of a clipboard item that was given HTML only. */
function htmlText(html: string): string {
  return html.replace(/<(script|style)[\s\S]*?<\/\1>/gi, "").replace(/<br\s*\/?>/gi, "\n").replace(/<\/(p|div|li|h[1-6])>/gi, "\n").replace(/<[^>]*>/g, "")
    .replace(/&nbsp;/g, " ").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, "&").trim();
}

/** `navigator.clipboard`: the native module, looked up on the first read. Throws in a binary without it (the lazy global then reads as `undefined`). */
export function loadClipboard(): Clipboard {
  // eslint-disable-next-line @typescript-eslint/no-require-imports -- required on the first read of `navigator.clipboard`
  const registry = require("expo-modules-core") as Partial<typeof import("expo-modules-core")>;
  const native = registry.requireOptionalNativeModule?.<NativeClipboard>("SvelteClipboard") ?? null;
  if (native === null) throw new Error("the SvelteClipboard native module is not part of this app's build: rebuild the native app");
  return new Clipboard(native);
}
