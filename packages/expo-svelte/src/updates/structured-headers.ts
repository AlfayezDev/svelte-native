/**
 * The part of RFC 8941 (Structured Field Values) the Expo Updates protocol uses: the server sends `expo-manifest-filters` and
 * `expo-server-defined-headers` as dictionaries, the client sends `expo-recent-failed-update-ids` as a list of strings and
 * `expo-extra-params` as a dictionary of strings. Mirrors the reading rules of expo-updates' `ResponseHeaderData`: entries that
 * are not strings, numbers or booleans are dropped, and a header that does not parse yields `null`.
 */
export type HeaderValue = string | number | boolean;

const KEY = /^[a-z*][a-z0-9_\-.*]*/;
const NUMBER = /^-?\d{1,15}(?:\.\d{1,3})?/;

class Reader {
  position = 0;
  constructor(readonly text: string) {}
  get done(): boolean { return this.position >= this.text.length; }
  peek(): string { return this.text[this.position] ?? ""; }
  skipSpaces(): void { while (this.peek() === " " || this.peek() === "\t") this.position++; }
  take(pattern: RegExp): string | null {
    const match = pattern.exec(this.text.slice(this.position));
    if (!match) return null;
    this.position += match[0].length;
    return match[0];
  }
}

/** An sf-string: double quotes, `\"` and `\\` escapes, printable ASCII only. */
function readString(reader: Reader): string {
  reader.position++;
  let value = "";
  while (!reader.done) {
    const char = reader.text[reader.position++] ?? "";
    if (char === "\\") {
      const next = reader.text[reader.position++];
      if (next !== "\\" && next !== '"') throw new Error("Invalid escape in structured string");
      value += next;
    } else if (char === '"') {
      return value;
    } else if (char < " " || char > "~") {
      throw new Error("Invalid character in structured string");
    } else {
      value += char;
    }
  }
  throw new Error("Unterminated structured string");
}

/** Reads one bare item; returns `undefined` for the types the protocol ignores (tokens, byte sequences, dates, inner lists). */
function readItem(reader: Reader): HeaderValue | undefined {
  const char = reader.peek();
  if (char === '"') return readString(reader);
  if (char === "?") {
    reader.position++;
    const flag = reader.take(/^[01]/);
    if (flag === null) throw new Error("Invalid structured boolean");
    return flag === "1";
  }
  if (char === "-" || (char >= "0" && char <= "9")) {
    const number = reader.take(NUMBER);
    if (number === null) throw new Error("Invalid structured number");
    return Number(number);
  }
  if (char === ":") {
    reader.position++;
    if (reader.take(/^[A-Za-z0-9+/=]*:/) === null) throw new Error("Invalid structured byte sequence");
    return undefined;
  }
  if (char === "(") {
    reader.position++;
    while (!reader.done && reader.peek() !== ")") {
      reader.skipSpaces();
      if (reader.peek() === ")") break;
      readItem(reader);
      readParameters(reader);
    }
    if (reader.peek() !== ")") throw new Error("Unterminated structured inner list");
    reader.position++;
    return undefined;
  }
  if (reader.take(/^[A-Za-z*][A-Za-z0-9:/!#$%&'*+\-.^_`|~]*/) !== null) return undefined;
  throw new Error("Invalid structured item");
}

function readParameters(reader: Reader): void {
  while (reader.peek() === ";") {
    reader.position++;
    reader.skipSpaces();
    if (reader.take(KEY) === null) throw new Error("Invalid structured parameter");
    if (reader.peek() === "=") {
      reader.position++;
      readItem(reader);
    }
  }
}

/** Parses an sf-dictionary into the members whose values are strings, numbers or booleans. A member without `=` is boolean true. */
export function parseDictionary(header: string): Record<string, HeaderValue> | null {
  try {
    const reader = new Reader(header);
    const result: Record<string, HeaderValue> = {};
    reader.skipSpaces();
    while (!reader.done) {
      const key = reader.take(KEY);
      if (key === null) throw new Error("Invalid structured dictionary key");
      let value: HeaderValue | undefined = true;
      if (reader.peek() === "=") {
        reader.position++;
        value = readItem(reader);
      }
      readParameters(reader);
      if (value !== undefined) result[key] = value;
      reader.skipSpaces();
      if (reader.done) break;
      if (reader.peek() !== ",") throw new Error("Expected a comma in structured dictionary");
      reader.position++;
      reader.skipSpaces();
      if (reader.done) throw new Error("Trailing comma in structured dictionary");
    }
    return result;
  } catch {
    return null;
  }
}

const serializeString = (value: string): string => {
  if (/[^ -~]/.test(value)) throw new Error("Structured strings are printable ASCII");
  return `"${value.replace(/[\\"]/g, "\\$&")}"`;
};

/** An sf-list of strings: `"a", "b"`. */
export function serializeStringList(values: string[]): string {
  return values.map(serializeString).join(", ");
}

/** An sf-dictionary of string members: `key="value", other="value"`. */
export function serializeStringDictionary(entries: Record<string, string>): string {
  return Object.entries(entries).map(([key, value]) => {
    if (!KEY.test(key) || KEY.exec(key)?.[0] !== key) throw new Error(`Invalid structured dictionary key: ${key}`);
    return `${key}=${serializeString(value)}`;
  }).join(", ");
}
