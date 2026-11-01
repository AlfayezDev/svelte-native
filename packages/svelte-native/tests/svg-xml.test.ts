import { beforeAll, describe, expect, test } from "bun:test";
import type { FakeNode } from "./foreign-harness.ts";
import { loadOracle, type Oracle } from "./svg-oracle.ts";
import { describeOurs, describeTheirs, settle, svgHarness, type Described, type SvgLoaded } from "./svg-harness.ts";
import { icons } from "./svg-icons.ts";
import type { Platform } from "./rn-reference.ts";

/**
 * `SvgXml` and `SvgUri` (SPEC.md, "react-native-svg"): the document is parsed by the port of the library's parser and drawn by the Svelte components. For six
 * real-world shaped icons the tree the library's own parser and element classes mount (`SvgAst`: `<Svg {...ast.props} {...override}>{ast.children}</Svg>`) is
 * the tree the components send, and the parser's tree is the library's.
 */
type App = { showXml(xml: string | null, props?: Record<string, unknown>): void; updateXml(xml: string | null, props?: Record<string, unknown>): void; showUri(uri: string | null, props?: Record<string, unknown>): void; errorLog(): string[]; loadCount(): number };
type Tree = { tag: string; props: Record<string, unknown>; children: (Tree | string)[] };
const platforms: Platform[] = ["android", "ios"];
const timeout = 60_000;

type Parsed = { tag: string; props: Record<string, unknown>; children: unknown[] };
/**
 * The library's parse tree (React elements) as plain tags, props and children; `class` is `className` there, and React has merged each class's
 * `defaultProps` into the element's props, which the parser itself did not put there (they are dropped where the document did not set them).
 */
function libraryTree(oracle: Oracle, element: unknown, mine?: Parsed | string): Tree | string {
  if (typeof element === "string") return element;
  const { type, props } = element as { type: { defaultProps?: Record<string, unknown> }; props: Record<string, unknown> & { children?: unknown } };
  const tag = Object.entries(oracle.tags).find(([, component]) => component === type)?.[0] ?? "missing";
  const { children, ...rest } = props;
  const own = typeof mine === "object" ? mine.props : {};
  for (const key in type.defaultProps) if (key in rest && !(key in own) && rest[key] === type.defaultProps[key]) delete rest[key];
  const list = [children].flat().filter((child) => child !== undefined);
  return { tag, props: rest, children: list.map((child, index) => libraryTree(oracle, child, typeof mine === "object" ? mine.children[index] as Parsed | string : undefined)) };
}
function ourTree(node: Parsed, known: Record<string, unknown>): Tree {
  const props: Record<string, unknown> = { ...node.props };
  if (props.class) { props.className = props.class; delete props.class; }
  return { tag: known[node.tag] ? node.tag : "missing", props, children: node.children.map((child) => (typeof child === "string" ? child : ourTree(child as Parsed, known))) };
}

for (const platform of platforms) {
  describe(platform, () => {
    let loaded: SvgLoaded;
    let oracle: Oracle;
    let app: App;
    let roots: () => Record<number, FakeNode[]>;
    const rootTag = 120;
    beforeAll(async () => {
      const harness = await svgHarness(platform);
      oracle = await loadOracle(platform);
      loaded = await harness.load("svg-xml-fixture.svelte") as SvgLoaded;
      app = loaded.startSurface(rootTag, loaded.Fixture, {}) as App;
      roots = harness.roots;
    }, timeout);

    const ours = (): Described[] => (roots()[rootTag] ?? []).map((node) => describeOurs(node));
    /** What the library mounts for the document: `SvgAst`'s element. */
    const theirs = (xml: string, override: Record<string, unknown> = {}): Described[] => {
      const ast = oracle.parse(xml);
      if (!ast) return [];
      return describeTheirs([oracle.mount(oracle.create(oracle.tags.svg, { ...ast.props, ...override }, ...ast.children)) as never], loaded, platform);
    };

    for (const [name, xml] of Object.entries(icons)) {
      test(`the parser's tree of the ${name} icon is the library's`, () => {
        const ast = oracle.parse(xml);
        const mine = loaded.xml.parse(xml);
        expect(ast).not.toBeNull();
        expect(mine).not.toBeNull();
        const expected = { tag: "svg", props: ast?.props, children: (ast?.children ?? []).map((child, index) => libraryTree(oracle, child, (mine as Parsed).children[index] as Parsed | string)) };
        const actual = ourTree(mine as Parsed, oracle.tags);
        expect(actual).toEqual(expected as Tree);
      });

      test(`SvgXml draws the ${name} icon as the library's elements do`, async () => {
        app.showXml(xml);
        await settle(loaded);
        const got = ours();
        expect(got.length).toBe(1);
        expect(got).toEqual(theirs(xml));
        // Every drawn node is a Fabric component of the library, and the root is the platform's view.
        const names = new Set<string>();
        const walk = (node: Described) => { names.add(node.name); node.children.forEach((child) => typeof child !== "string" && walk(child)); };
        got.forEach(walk);
        expect(got[0]?.name).toBe(platform === "android" ? "RNSVGSvgViewAndroid" : "RNSVGSvgView");
        expect([...names].every((component) => component.startsWith("RNSVG"))).toBe(true);
      });
    }

    test("the icons between them draw every kind of element the task names", async () => {
      const seen = new Set<string>();
      for (const xml of Object.values(icons)) {
        app.showXml(xml);
        await settle(loaded);
        const walk = (node: Described) => { seen.add(node.name); node.children.forEach((child) => typeof child !== "string" && walk(child)); };
        ours().forEach(walk);
      }
      for (const name of ["RNSVGPath", "RNSVGLinearGradient", "RNSVGRadialGradient", "RNSVGClipPath", "RNSVGText", "RNSVGTSpan", "RNSVGUse", "RNSVGSymbol", "RNSVGDefs", "RNSVGGroup", "RNSVGMask", "RNSVGRect", "RNSVGCircle", "RNSVGEllipse"]) expect(seen.has(name), name).toBe(true);
    });

    test("the props of the component replace the root element's, and a new document replaces the nodes", async () => {
      const override = { width: 96, height: 96, color: "#ff0000", fill: "currentColor" };
      app.showXml(icons.paths!, override);
      await settle(loaded);
      expect(ours()).toEqual(theirs(icons.paths!, override));
      const root = ours()[0]!;
      expect(root.props).toMatchObject({ bbWidth: 96, bbHeight: 96 });
      app.showXml(icons.mask!);
      await settle(loaded);
      expect(ours()).toEqual(theirs(icons.mask!));
      app.showXml(null);
      await settle(loaded);
      expect(ours()).toEqual([]);
    });

    test("a document with a CDATA text, a comment, a doctype, unquoted values, a style attribute and unknown elements", async () => {
      const xml = `<?xml version="1.0"?><!DOCTYPE svg><!-- c --><svg width=10 height=10 style="opacity:0.5; fill:red"><title>t</title><metadata><x/></metadata><text><![CDATA[a < b]]></text><circle r=3 class="a"/><feTurbulence/></svg>`;
      const warn = console.warn;
      console.warn = () => {};
      try {
        app.showXml(xml);
        await settle(loaded);
        expect(ours()).toEqual(theirs(xml));
      } finally {
        console.warn = warn;
      }
      expect(loaded.xml.getStyle("opacity: 0.5; fill : red;")).toEqual({ opacity: "0.5", fill: "red" });
      expect(loaded.xml.camelCase("stroke-linecap")).toBe("strokeLinecap");
    });

    test("a document that does not parse reports the library's error and shows the fallback", async () => {
      const bad = "<svg><g></svg>";
      const library = (() => { try { oracle.parse(bad); return ""; } catch (error) { return (error as Error).message; } })();
      expect(library).toContain("Expected closing tag </svg> to match opening tag <g>");
      app.showXml(bad);
      await settle(loaded);
      expect(app.errorLog().at(-1)).toBe(library);
      const names = (roots()[rootTag] ?? []).map((node) => node.name);
      expect(names).toEqual(["RCTView"]);
      // A document that parses again takes the fallback's place.
      app.showXml(icons.paths!);
      await settle(loaded);
      expect(ours()[0]?.name).toBe(platform === "android" ? "RNSVGSvgViewAndroid" : "RNSVGSvgView");
    });
  });
}

describe("SvgUri", () => {
  let loaded: SvgLoaded;
  let oracle: Oracle;
  let app: App;
  let roots: () => Record<number, FakeNode[]>;
  const rootTag = 121;
  const requested: string[] = [];
  const documents: Record<string, string | number> = { "https://example.com/paths.svg": icons.paths!, "https://example.com/mask.svg": icons.mask!, "https://example.com/gone.svg": 404 };
  const fetched = globalThis.fetch;
  beforeAll(async () => {
    (globalThis as { fetch: unknown }).fetch = async (uri: string) => {
      requested.push(uri);
      const body = documents[uri] ?? 404;
      return typeof body === "number" ? { ok: false, status: body, text: async () => "" } : { ok: true, status: 200, text: async () => body };
    };
    const harness = await svgHarness("android");
    oracle = await loadOracle("android");
    loaded = await harness.load("svg-xml-fixture.svelte") as SvgLoaded;
    app = loaded.startSurface(rootTag, loaded.Fixture, {}) as App;
    roots = harness.roots;
  }, timeout);
  const settleAll = async () => { await settle(loaded); await new Promise((resolve) => setTimeout(resolve, 5)); await settle(loaded); };
  const rootNames = () => (roots()[rootTag] ?? []).map((node) => node.name);

  test("fetches the document and draws it as SvgXml does, again for another uri", async () => {
    app.showUri("https://example.com/paths.svg", { width: 50, height: 50 });
    await settleAll();
    expect(rootNames()).toEqual(["RNSVGSvgViewAndroid"]);
    const expected = (xml: string, override: object) => { const ast = oracle.parse(xml)!; return describeTheirs([oracle.mount(oracle.create(oracle.tags.svg, { ...ast.props, ...override }, ...ast.children)) as never], loaded, "android"); };
    expect((roots()[rootTag] ?? []).map((node) => describeOurs(node))).toEqual(expected(icons.paths!, { width: 50, height: 50 }));
    expect(app.loadCount()).toBe(1);
    app.showUri("https://example.com/mask.svg", { width: 50, height: 50 });
    await settleAll();
    // The nodes are updated in place: a prop the new document does not have goes to the native view as null.
    const dropRemoved = (nodes: Described[], reference: Described[]): Described[] => nodes.map((node, index) => {
      const props = { ...node.props };
      for (const key in props) if (props[key] === null && !(key in (reference[index]?.props ?? {}))) delete props[key];
      return { ...node, props, children: dropRemoved(node.children as Described[], (reference[index]?.children ?? []) as Described[]) };
    });
    const wanted = expected(icons.mask!, { width: 50, height: 50 });
    expect(dropRemoved((roots()[rootTag] ?? []).map((node) => describeOurs(node)), wanted)).toEqual(wanted);
    expect(requested).toEqual(["https://example.com/paths.svg", "https://example.com/mask.svg"]);
    expect(app.loadCount()).toBe(2);
  });

  test("an SVG data URI is decoded without a request (utf8 on Android, base64 on both)", async () => {
    const before = requested.length;
    const tiny = `<svg width="4" height="4"><rect width="4" height="4"/></svg>`;
    app.showUri(`data:image/svg+xml;utf8,${encodeURIComponent(tiny)}`);
    await settleAll();
    expect(rootNames()).toEqual(["RNSVGSvgViewAndroid"]);
    app.showUri(null);
    await settleAll();
    expect(rootNames()).toEqual([]);
    app.showUri(`data:image/svg+xml;base64,${Buffer.from(tiny).toString("base64")}`);
    await settleAll();
    expect(rootNames()).toEqual(["RNSVGSvgViewAndroid"]);
    expect(requested.length).toBe(before);
  });

  test("a failed request reports the error and shows the fallback", async () => {
    const warn = console.error;
    app.showUri("https://example.com/gone.svg");
    await settleAll();
    expect(app.errorLog().at(-1)).toBe("Fetching https://example.com/gone.svg failed with status 404");
    expect(rootNames()).toEqual(["RCTView"]);
    console.error = warn;
    (globalThis as { fetch: unknown }).fetch = fetched;
  });
});
