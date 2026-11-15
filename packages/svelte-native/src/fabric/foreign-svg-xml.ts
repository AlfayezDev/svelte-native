/**
 * The XML half of react-native-svg (`xml.tsx`) without React: the library's parser, line for line, producing a plain tree of
 * `{ tag, props, children }` where the library produces React elements (`astToReact`), and `fetchText` of `utils/fetchData.ts`
 * for `SvgUri`. `SvgXml.svelte` renders the tree with the Svelte components. `xml.tsx` itself imports React and every element
 * class, so it cannot be bundled; `tests/foreign/svg/support/oracle.ts` bundles it with a stand-in for React as the oracle and compares the trees.
 */
import { Platform } from "./deps-rn.ts";

export type Styles = Record<string, string>;
/** One element of the parsed document; its children are elements and text (non-blank text between tags, CDATA). */
export type SvgNode = { tag: string; props: Record<string, Styles | string | number | boolean | undefined>; children: (SvgNode | string)[]; styles?: string };

const upperCase = (_match: string, letter: string) => letter.toUpperCase();

export const camelCase = (phrase: string) => phrase.replace(/[:-]([a-z])/g, upperCase);

export function getStyle(string: string): Styles {
  const style: Styles = {};
  const declarations = string.split(";").filter((value) => value.trim());
  const { length } = declarations;
  for (let index = 0; index < length; index++) {
    const declaration = declarations[index];
    if (declaration.length !== 0) {
      const split = declaration.split(":");
      const property = split[0];
      const value = split[1];
      style[camelCase(property.trim())] = value.trim();
    }
  }
  return style;
}

// slimmed down parser based on https://github.com/Rich-Harris/svg-parser

function repeat(text: string, count: number) {
  let result = "";
  while (count--) result += text;
  return result;
}

const toSpaces = (tabs: string) => repeat("  ", tabs.length);

function locate(source: string, position: number) {
  const lines = source.split("\n");
  const lineCount = lines.length;
  let column = position;
  let line = 0;
  for (; line < lineCount; line++) {
    const { length } = lines[line];
    if (column >= length) column -= length;
    else break;
  }
  const before = source.slice(0, position).replace(/^\t+/, toSpaces);
  const beforeExec = /(^|\n).*$/.exec(before);
  const beforeLine = beforeExec?.[0] || "";
  const after = source.slice(position);
  const afterExec = /.*(\n|$)/.exec(after);
  const afterLine = afterExec?.[0];
  const pad = repeat(" ", beforeLine.length);
  const snippet = `${beforeLine}${afterLine}\n${pad}^`;
  return { line, column, snippet };
}

const validNameCharacters = /[a-zA-Z0-9:_-]/;
const commentStart = /<!--/;
const whitespace = /[\s\t\r\n]/;
const quotemarks = /['"]/;

/**
 * The library's `parse`: the document's root element, or null for a document without one. Throws with the position of a syntax error.
 * Not ported: its `middleware` argument (`SvgCss` passes the style-sheet inliner of `css/css.tsx`) and the `parent` link of an element.
 */
export function parse(source: string): SvgNode | null {
  const length = source.length;
  let currentElement: SvgNode | null = null;
  let state: (() => unknown) | undefined = metadata;
  let children: (SvgNode | string)[] = [];
  let root: SvgNode | undefined;
  const stack: SvgNode[] = [];

  function error(message: string): never {
    const { line, column, snippet } = locate(source, i);
    throw new Error(`${message} (${line}:${column}). If this is valid SVG, it's probably a bug. Please raise an issue\n\n${snippet}`);
  }

  function metadata() {
    while (i + 1 < length && (source[i] !== "<" || !(validNameCharacters.test(source[i + 1]) || commentStart.test(source.slice(i, i + 4))))) i++;
    return neutral();
  }

  function neutral(): (() => unknown) | undefined {
    const start = i;
    while (i < length && source[i] !== "<") i += 1;
    const text = source.slice(start, i);
    if (/\S/.test(text)) children.push(text);
    if (source[i] === "<") return openingTag;
    return neutral;
  }

  function openingTag(): (() => unknown) | undefined {
    const char = source[i];
    if (char === "?") return neutral; // <?xml...
    if (char === "!") {
      const start = i + 1;
      if (source.slice(start, i + 3) === "--") return comment;
      const end = i + 8;
      if (source.slice(start, end) === "[CDATA[") return cdata;
      if (/doctype/i.test(source.slice(start, end))) return doctype;
    }
    if (char === "/") return closingTag;

    const tag = getName();
    const props: SvgNode["props"] = {};
    const element: SvgNode = { tag, props, children: [] };
    if (currentElement) children.push(element);
    else root = element;

    getAttributes(props);

    const { style } = props;
    if (typeof style === "string") {
      element.styles = style;
      props.style = getStyle(style);
    }

    let selfClosing = false;
    if (source[i] === "/") {
      i += 1;
      selfClosing = true;
    }
    if (source[i] !== ">") error("Expected >");
    if (!selfClosing) {
      currentElement = element;
      ({ children } = element);
      stack.push(element);
    }
    return neutral;
  }

  function comment() {
    const index = source.indexOf("-->", i);
    if (!~index) error("expected -->");
    i = index + 2;
    return neutral;
  }

  function cdata() {
    const index = source.indexOf("]]>", i);
    if (!~index) error("expected ]]>");
    children.push(source.slice(i + 7, index));
    i = index + 2;
    return neutral;
  }

  function doctype() {
    const index = source.indexOf(">", i);
    if (index === -1) error("expected >");
    i = index;
    return neutral;
  }

  function closingTag() {
    const tag = getName();
    if (!tag) error("Expected tag name");
    if (currentElement && tag !== currentElement.tag) error(`Expected closing tag </${tag}> to match opening tag <${currentElement.tag}>`);
    allowSpaces();
    if (source[i] !== ">") error("Expected >");
    stack.pop();
    currentElement = stack[stack.length - 1] ?? null;
    if (currentElement) ({ children } = currentElement);
    return neutral;
  }

  function getName() {
    const start = i;
    while (i < length && validNameCharacters.test(source[i])) i += 1;
    return source.slice(start, i);
  }

  function getAttributes(props: Record<string, Styles | string | number | boolean | undefined>) {
    while (i < length) {
      if (!whitespace.test(source[i])) return;
      allowSpaces();
      const name = getName();
      if (!name) return;
      let value: boolean | number | string = true;
      allowSpaces();
      if (source[i] === "=") {
        i += 1;
        allowSpaces();
        value = getAttributeValue();
        if (name !== "id" && !Number.isNaN(+value) && value.trim() !== "") value = +value;
      }
      props[camelCase(name)] = value;
    }
  }

  function getAttributeValue(): string {
    return quotemarks.test(source[i]) ? getQuotedAttributeValue() : getUnquotedAttributeValue();
  }

  function getUnquotedAttributeValue() {
    let value = "";
    do {
      const char = source[i];
      if (char === " " || char === ">" || char === "/") return value;
      value += char;
      i += 1;
    } while (i < length);
    return value;
  }

  function getQuotedAttributeValue() {
    const quotemark = source[i++];
    let value = "";
    let escaped = false;
    while (i < length) {
      const char = source[i++];
      if (char === quotemark && !escaped) return value;
      if (char === "\\" && !escaped) escaped = true;
      value += escaped ? `\\${char}` : char;
      escaped = false;
    }
    return value;
  }

  function allowSpaces() {
    while (i < length && whitespace.test(source[i])) i += 1;
  }

  let i = 0;
  while (i < length) {
    if (!state) error("Unexpected character");
    state = state() as (() => unknown) | undefined;
    i += 1;
  }

  if (state !== neutral) error("Unexpected end of input");
  return root ?? null;
}

function decodeBase64Image(uri: string): string {
  const decoded = decodeURIComponent(uri);
  const splitContent = decoded.split(";")[1].split(",");
  return atob(splitContent.slice(1).join(","));
}

function dataUriToXml(uri: string): string | null {
  try {
    // decode and remove data:image/svg+xml;utf8, prefix
    return decodeURIComponent(uri).split(",").slice(1).join(",");
  } catch (error) {
    throw new Error(`Decoding ${uri} failed with error: ${String(error)}`, { cause: error });
  }
}

async function fetchUriData(uri: string): Promise<string> {
  const response = await fetch(uri);
  if (response.ok || (response.status === 0 && uri.startsWith("file://"))) return await response.text();
  throw new Error(`Fetching ${uri} failed with status ${response.status}`);
}

/** `fetchText` of `utils/fetchData.ts`: the SVG source behind a URI (a network or file URI, or an SVG data URI). */
export async function fetchText(uri?: string): Promise<string | null> {
  if (!uri) return null;
  if (uri.startsWith("data:image/svg+xml;utf8") && Platform.OS === "android") return dataUriToXml(uri);
  if (uri.startsWith("data:image/svg+xml;base64")) return decodeBase64Image(uri);
  return fetchUriData(uri);
}
