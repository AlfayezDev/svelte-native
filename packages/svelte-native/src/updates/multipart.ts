/**
 * `multipart/mixed` bodies of the Expo Updates protocol (https://docs.expo.dev/technical-specs/expo-updates-1/): parts named
 * `manifest`, `extensions`, `certificate_chain` and `directive` by their `Content-Disposition`, each with its own headers.
 * Mirrors expo-updates' `FileDownloader.parseMultipartRemoteUpdateResponse`: parts without a name are skipped, and an empty
 * multipart body (the closing delimiter alone) is a valid response with no parts.
 */
export type Part = { name: string; headers: Record<string, string>; body: string };

/** The boundary parameter of a `multipart/*` content type, or null when the type is not multipart. */
export function multipartBoundary(contentType: string | null): string | null {
  if (!contentType || !/^\s*multipart\//i.test(contentType)) return null;
  const match = /;\s*boundary\s*=\s*(?:"([^"]+)"|([^\s;]+))/i.exec(contentType);
  return match ? (match[1] ?? match[2] ?? null) : null;
}

/** The `name` parameter of a `Content-Disposition` value (`inline; name="manifest"`). The first `name` wins, as in upstream. */
export function dispositionName(value: string): string | null {
  const parameter = /;\s*([a-zA-Z0-9\-!#$%&'*+.^_`|~]+)\s*=\s*(?:([a-zA-Z0-9\-!#$%&'*+.^_`|~]+)|"([^"]*)")/g;
  for (let match = parameter.exec(value); match; match = parameter.exec(value)) {
    if (match[1] !== "name") continue;
    const token = match[2];
    if (token === undefined) return match[3] ?? null;
    return token.length > 2 && token.startsWith("'") && token.endsWith("'") ? token.slice(1, -1) : token;
  }
  return null;
}

export function parseMultipart(contentType: string | null, body: string): Part[] {
  const boundary = multipartBoundary(contentType);
  if (boundary === null) throw new Error("Response is not multipart: no boundary in the content type");
  const delimiter = `--${boundary}`;
  const parts: Part[] = [];
  // A delimiter starts a line; the leading break lets the first one follow a break like every other.
  const text = `\r\n${body}`;
  const first = text.indexOf(`\r\n${delimiter}`);
  if (first < 0) {
    if (body.trim() === "") return parts;
    throw new Error("Multipart body has no opening delimiter");
  }
  for (let at = first + 2; ; ) {
    at += delimiter.length;
    // `--` after a delimiter closes the body; anything after it is the epilogue.
    if (text.startsWith("--", at)) return parts;
    const lineEnd = text.indexOf("\r\n", at);
    if (lineEnd < 0) throw new Error("Multipart delimiter is not followed by a line break");
    const headersStart = lineEnd + 2;
    const next = text.indexOf(`\r\n${delimiter}`, headersStart - 2);
    if (next < 0) throw new Error("Multipart body is not closed");
    const section = text.slice(headersStart, next);
    // A part without headers starts with the blank line itself.
    const split = section.startsWith("\r\n") ? 0 : section.indexOf("\r\n\r\n");
    const headerBlock = split < 0 ? section : section.slice(0, split);
    const partBody = split < 0 ? "" : section.slice(split + (split === 0 ? 2 : 4));
    const headers: Record<string, string> = {};
    for (const line of headerBlock.split("\r\n")) {
      const colon = line.indexOf(":");
      if (colon > 0) headers[line.slice(0, colon).trim().toLowerCase()] = line.slice(colon + 1).trim();
    }
    const name = headers["content-disposition"] ? dispositionName(headers["content-disposition"]) : null;
    if (name !== null) parts.push({ name, headers, body: partBody });
    at = next + 2;
  }
}
