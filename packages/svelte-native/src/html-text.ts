/**
 * The text of an HTML fragment, for the plain-text part of a clipboard item that was given HTML only (`clipboard.ts`): the markup goes, a line break or the end of a
 * block is a new line, and character references are decoded as HTML's tokenizer decodes them in text (`Caf&#233; &copy 2026` is `Café © 2026`).
 */
import { LEGACY, NAMED } from "./html-entities.ts";

let named: Map<string, string> | undefined;
let legacy: ReadonlySet<string> | undefined;

/** What a named reference stands for, the name written without its `&` and `;`. The table is read on the first named reference. */
function namedText(name: string): string | undefined {
  named ??= new Map(NAMED.split(",").map((entry) => {
    const [key = "", points = ""] = entry.split(":");
    return [key, String.fromCodePoint(...points.split("+").map((point) => Number.parseInt(point, 16)))];
  }));
  return named.get(name);
}

/** The C1 controls a numeric reference names that HTML reads as the Windows-1252 characters of those bytes (`&#150;` is `–`). */
const WINDOWS_1252: Readonly<Record<number, number>> = {
  0x80: 0x20ac, 0x82: 0x201a, 0x83: 0x0192, 0x84: 0x201e, 0x85: 0x2026, 0x86: 0x2020, 0x87: 0x2021, 0x88: 0x02c6, 0x89: 0x2030, 0x8a: 0x0160, 0x8b: 0x2039,
  0x8c: 0x0152, 0x8e: 0x017d, 0x91: 0x2018, 0x92: 0x2019, 0x93: 0x201c, 0x94: 0x201d, 0x95: 0x2022, 0x96: 0x2013, 0x97: 0x2014, 0x98: 0x02dc, 0x99: 0x2122,
  0x9a: 0x0161, 0x9b: 0x203a, 0x9c: 0x0153, 0x9e: 0x017e, 0x9f: 0x0178,
};

/** The character a numeric reference names: none, a surrogate and a number past Unicode are U+FFFD. */
function numericText(code: number): string {
  if (code === 0 || code > 0x10ffff || (code >= 0xd800 && code <= 0xdfff)) return "\ufffd";
  return String.fromCodePoint(WINDOWS_1252[code] ?? code);
}

/**
 * `text` with its character references decoded, as in the text of an element: `&#233;`, `&#xE9;` and `&eacute;` are `é`, a reference without its `;` is
 * read where HTML reads one (`&#233`, `&copy`, and `&notit;` is `¬it;`), and one HTML does not know stays as it is.
 */
export function decodeEntities(text: string): string {
  return text.replace(/&(?:#([xX][0-9a-fA-F]+|[0-9]+);?|([A-Za-z][A-Za-z0-9]*)(;?))/g, (reference: string, number?: string, name?: string, semicolon?: string) => {
    if (number !== undefined) return numericText(number[0] === "x" || number[0] === "X" ? Number.parseInt(number.slice(1), 16) : Number.parseInt(number, 10));
    if (name === undefined) return reference;
    const full = semicolon === ";" ? namedText(name) : undefined;
    if (full !== undefined) return full;
    // The longest name HTML reads without a `;` that the run of letters starts with; the rest of the run is text.
    legacy ??= new Set(LEGACY.split(" "));
    for (let end = name.length; end > 1; end--) {
      const prefix = name.slice(0, end);
      if (legacy.has(prefix)) return `${namedText(prefix) ?? prefix}${name.slice(end)}${semicolon ?? ""}`;
    }
    return reference;
  });
}

/**
 * The text of an HTML fragment: scripts and styles go, `<br>` and the end of a paragraph, block or list item is a new line, then the tags go and the references are decoded
 * (`&nbsp;` as a plain space).
 */
export function htmlText(html: string): string {
  const text = html.replace(/<(script|style)[\s\S]*?<\/\1>/gi, "").replace(/<br\s*\/?>/gi, "\n").replace(/<\/(p|div|li|h[1-6])>/gi, "\n").replace(/<[^>]*>/g, "");
  // A no-break space is a space in the plain text, as a browser copies it.
  return decodeEntities(text).replace(/\u00a0/g, " ").trim();
}
