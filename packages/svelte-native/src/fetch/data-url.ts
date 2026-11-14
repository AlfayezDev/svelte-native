import { base64Decode, latin1, percentDecode } from "./encoding.ts";

const TOKEN = /^[!#$%&'*+\-.^_`|~0-9A-Za-z]+$/;
const HTTP_WHITESPACE = /^[\t\n\r ]+|[\t\n\r ]+$/g;

/**
 * The MIME Sniffing standard's "parse a MIME type" followed by its "serialize a MIME type": the form a Content-Type header takes from a `data:` URL. The type and subtype are
 * lower-cased; the parameters' names are lower-cased and kept in order, the first of a repeated one wins, one without a name or a usable value is dropped, a quoted value is
 * unquoted when it is a token and quoted again when it is not, and no whitespace is left between the parts. Null when the text is not a MIME type.
 */
export function serializeMimeType(text: string): string | null {
  const input = text.replace(HTTP_WHITESPACE, "");
  const slash = input.indexOf("/");
  if (slash <= 0) return null;
  const type = input.slice(0, slash);
  let at = input.indexOf(";", slash);
  const subtype = input.slice(slash + 1, at === -1 ? input.length : at).replace(HTTP_WHITESPACE, "");
  if (!TOKEN.test(type) || !TOKEN.test(subtype)) return null;
  const parameters = new Map<string, string>();
  while (at !== -1 && at < input.length) {
    at++;
    while (at < input.length && /[\t\n\r ]/.test(input[at]!)) at++;
    let end = at;
    while (end < input.length && input[end] !== ";" && input[end] !== "=") end++;
    const name = input.slice(at, end).toLowerCase();
    at = end;
    if (input[at] !== "=") {
      at = input.indexOf(";", at);
      continue;
    }
    at++;
    let value = "";
    if (input[at] === '"') {
      for (at++; at < input.length && input[at] !== '"'; at++) {
        if (input[at] === "\\" && at + 1 < input.length) at++;
        value += input[at];
      }
      at = input.indexOf(";", at);
    } else {
      end = input.indexOf(";", at);
      value = input.slice(at, end === -1 ? input.length : end).replace(HTTP_WHITESPACE, "");
      at = end;
      if (value === "") continue;
    }
    if (TOKEN.test(name) && !parameters.has(name) && !/[^\t\x20-\x7e\x80-\xff]/.test(value)) parameters.set(name, value);
  }
  let result = `${type.toLowerCase()}/${subtype.toLowerCase()}`;
  for (const [name, value] of parameters) result += `;${name}=${value === "" || !TOKEN.test(value) ? `"${value.replace(/["\\]/g, "\\$&")}"` : value}`;
  return result;
}

/**
 * A `data:` URL's Content-Type and bytes (the Fetch standard's "data: URL processor"), or null when the URL is not valid. The MIME part is read as it is written, not
 * percent-decoded (`data:text/plain%3Bbase64,SGk=` is not base64), and one that is not a MIME type is `text/plain;charset=US-ASCII`.
 */
export function parseDataURL(href: string): { type: string; bytes: Uint8Array } | null {
  if (!/^data:/i.test(href)) return null;
  const rest = href.slice(5).replace(/#[\s\S]*$/, "");
  const comma = rest.indexOf(",");
  if (comma === -1) return null;
  let mime = rest.slice(0, comma).replace(HTTP_WHITESPACE, "");
  let bytes = percentDecode(rest.slice(comma + 1));
  const base64 = /;[ ]*base64$/i.exec(mime);
  if (base64 !== null) {
    mime = mime.slice(0, base64.index);
    const decoded = base64Decode(latin1(bytes));
    if (decoded === null) return null;
    bytes = decoded;
  }
  if (mime.startsWith(";")) mime = `text/plain${mime}`;
  return { type: serializeMimeType(mime) ?? "text/plain;charset=US-ASCII", bytes };
}
