import { base64Decode, decodeUtf8, latin1, percentDecode } from "./encoding.ts";

/** A `data:` URL's Content-Type and bytes (the Fetch standard's "data: URL processor"), or null when the URL is not valid. */
export function parseDataURL(href: string): { type: string; bytes: Uint8Array } | null {
  if (!/^data:/i.test(href)) return null;
  const rest = href.slice(5).replace(/#[\s\S]*$/, "");
  const comma = rest.indexOf(",");
  if (comma === -1) return null;
  let type = decodeUtf8(percentDecode(rest.slice(0, comma)), true).replace(/^[\t\n\f\r ]+|[\t\n\f\r ]+$/g, "");
  let bytes = percentDecode(rest.slice(comma + 1));
  const base64 = /;[ ]*base64$/i.exec(type);
  if (base64 !== null) {
    type = type.slice(0, base64.index);
    const decoded = base64Decode(latin1(bytes));
    if (decoded === null) return null;
    bytes = decoded;
  }
  if (type.startsWith(";")) type = `text/plain${type}`;
  if (!/^[^\s/;]+\/[^\s/;]+/.test(type)) type = "text/plain;charset=US-ASCII";
  return { type: type.replace(/^[^;]*/, (essence) => essence.toLowerCase()), bytes };
}
