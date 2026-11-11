/**
 * Tailwind 4's compiled CSS to a class table: one entry per class, each a list of rules in cascade order, with the conditions
 * (`dark:`, `md:`) kept as data and everything else (`var()`, `calc()`, colors, units) resolved here, at build time.
 *
 * Only a selector that is a single class (with Tailwind's escapes) is a class; `:hover`, `group-*`, `space-x-*` and the like are reported
 * in `unsupported` and left out. The cascade is `order`: layer first (theme < base < components < utilities < unlayered, in the order
 * `@layer` names first appear, `!important` above all of them), then source order. A rule nested in a rule (`@media` inside `.card`)
 * is its own rule after its parent's, and declarations after a nested block come after it.
 */
import { classifySelector, type Declaration, type Item, parseCss, type SelectorKind, splitTop } from "./parse.ts";
import { convertDeclaration, emptyResult, isEmptyResult, type Result } from "./properties.ts";
import type { ClassCondition, ClassRule, ClassTable, Unsupported } from "./table.ts";
import { evaluate, type VarLookup } from "./values.ts";

type Scheme = "light" | "dark";
type Cond = ClassCondition;

/** A theme variable's definition on `:root`/`:host`: its value, the scheme it applies to (none: both), and its place in the cascade. */
type VarDef = { value: string; scheme?: Scheme; rank: number; seq: number };

/** A rule before `order` is assigned. `rank` and `seq` sort it; the light and dark twin of a scheme-dependent rule share both. */
type Pending = { className: string; rank: number; seq: number; rule: Omit<ClassRule, "order"> };

/** Why the rules of a block cannot be used: its at-rule (`@media (hover: hover)`, `@supports ...`) and the reason. */
type Blocked = { property: string; reason: string };

type Ctx = { layer: string | null; when: Cond; blocked: Blocked | null };

// --- At-rule conditions ------------------------------------------------------------------------------------------------------

/** Both conditions at once, or null when no width and scheme can satisfy both. */
function combine(a: Cond, b: Cond): Cond | null {
  const out: Cond = { ...a };
  if (b.scheme !== undefined) {
    if (out.scheme !== undefined && out.scheme !== b.scheme) return null;
    out.scheme = b.scheme;
  }
  if (b.platform !== undefined) {
    if (out.platform !== undefined && out.platform !== b.platform) return null;
    out.platform = b.platform;
  }
  if (b.minWidth !== undefined) out.minWidth = Math.max(out.minWidth ?? 0, b.minWidth);
  if (b.maxWidth !== undefined) out.maxWidth = Math.min(out.maxWidth ?? Number.POSITIVE_INFINITY, b.maxWidth);
  if (out.minWidth !== undefined && out.maxWidth !== undefined && out.minWidth >= out.maxWidth) return null;
  return out;
}

/**
 * `base` narrowed by an `@media` prelude: the combined condition, null when no window satisfies both, or why the prelude is not supported.
 * `width >` and `<=` take the same boundary as `>=` and `<` (a pixel off at most), like `min-width` and `max-width`.
 */
function narrow(base: Cond, prelude: string, remPx: number): { when: Cond | null } | { error: string } {
  let when: Cond | null = base;
  const queries = splitTop(prelude.toLowerCase(), ",");
  if (queries.length !== 1) return { error: `media query list ${prelude} is not supported` };
  const text = (queries[0] as string).replace(/^only\s+/, "");
  if (/^not\s/.test(text)) return { error: `@media ${prelude} is not supported` };
  for (const part of text.split(/\s+and\s+/)) {
    const word = part.trim();
    if (word === "all" || word === "screen") continue;
    const feature = /^\((.*)\)$/.exec(word);
    if (!feature) return { error: `media type ${word} is not supported` };
    const next = parseFeature((feature[1] as string).trim(), remPx);
    if ("error" in next) return next;
    when = when === null ? null : combine(when, next.when);
  }
  return { when };
}

function pixels(text: string, remPx: number): number | null {
  const q = evaluate(text, remPx);
  if ("error" in q) return null;
  const dims = Object.keys(q.q).filter((k) => q.q[k] !== 0);
  if (dims.length === 0) return 0;
  return dims.length === 1 && dims[0] === "px" ? (q.q.px as number) : null;
}

function parseFeature(feature: string, remPx: number): { when: Cond } | { error: string } {
  const unsupported = { error: `media feature (${feature}) is not supported` };
  const scheme = /^prefers-color-scheme\s*:\s*(dark|light)$/.exec(feature);
  if (scheme) return { when: { scheme: scheme[1] as Scheme } };
  const platform = /^platform\s*:\s*(ios|android)$/.exec(feature);
  if (platform) return { when: { platform: platform[1] as "ios" | "android" } };
  const legacy = /^(min|max)-width\s*:\s*(.+)$/.exec(feature);
  if (legacy) {
    const px = pixels(legacy[2] as string, remPx);
    if (px === null) return unsupported;
    return { when: legacy[1] === "min" ? { minWidth: px } : { maxWidth: px } };
  }
  // Range syntax: `width >= 48rem`, `48rem <= width`, `48rem <= width < 64rem`.
  const double = /^(.+?)\s*(<=|<)\s*width\s*(<=|<)\s*(.+)$/.exec(feature);
  if (double) {
    const low = pixels(double[1] as string, remPx);
    const high = pixels(double[4] as string, remPx);
    return low === null || high === null ? unsupported : { when: { minWidth: low, maxWidth: high } };
  }
  const feat = /^width\s*(>=|<=|>|<)\s*(.+)$/.exec(feature);
  if (feat) {
    const px = pixels(feat[2] as string, remPx);
    if (px === null) return unsupported;
    return { when: feat[1] === ">=" || feat[1] === ">" ? { minWidth: px } : { maxWidth: px } };
  }
  const reversed = /^(.+?)\s*(>=|<=|>|<)\s*width$/.exec(feature);
  if (reversed) {
    const px = pixels(reversed[1] as string, remPx);
    if (px === null) return unsupported;
    return { when: reversed[2] === "<=" || reversed[2] === "<" ? { minWidth: px } : { maxWidth: px } };
  }
  return unsupported;
}

/** `@supports (color: color-mix(...))` is how Tailwind offers its oklab variants; the converter computes color-mix, so it holds. */
function supportsColorMix(prelude: string): boolean {
  return /^\(\s*color\s*:\s*color-mix\(.*\)\s*\)$/i.test(prelude.trim());
}

/** The rules of the transparent `@supports` blocks inlined: their declarations count as the rule's own, in order. */
function inlineSupports(items: Item[]): Item[] {
  return items.flatMap((item) => (item.kind === "at" && item.name === "supports" && item.body !== null && supportsColorMix(item.prelude) ? inlineSupports(item.body) : [item]));
}

/** At-rules with no class selectors inside: skipped without a word. */
const SILENT_AT_RULES = new Set(["property", "keyframes", "font-face", "import", "charset", "namespace", "page", "counter-style", "font-palette-values", "font-feature-values", "view-transition"]);

// --- The converter -----------------------------------------------------------------------------------------------------------

class Converter {
  private readonly layers = new Map<string, number>();
  private readonly themeVars = new Map<string, VarDef[]>();
  private readonly propertyDefaults = new Map<string, string>();
  private readonly pending: Pending[] = [];
  private readonly unsupported: Unsupported[] = [];
  private readonly seen = new Set<string>();
  private seq = 0;

  constructor(private readonly remPx: number) {}

  run(css: string): { table: ClassTable; unsupported: Unsupported[] } {
    const items = parseCss(css);
    this.registerLayers(items, null);
    this.collect(items, { layer: null, when: {}, blocked: null });
    this.emit(items, { layer: null, when: {}, blocked: null });
    return { table: this.table(), unsupported: this.unsupported };
  }

  // Layers: ranked by the first time a name appears, in a statement or a block.
  private registerLayers(items: Item[], parent: string | null): void {
    for (const item of items) {
      if (item.kind === "at" && item.name === "layer") {
        const names = splitTop(item.prelude, ",").filter((name) => name !== "");
        for (const name of names) {
          const qualified = parent === null ? name : `${parent}.${name}`;
          if (!this.layers.has(qualified)) this.layers.set(qualified, this.layers.size);
          if (item.body !== null && names.length === 1) this.registerLayers(item.body, qualified);
        }
      } else if (item.kind === "at" && item.body !== null) this.registerLayers(item.body, parent);
      else if (item.kind === "rule") this.registerLayers(item.body, parent);
    }
  }

  private rank(layer: string | null, important: boolean): number {
    if (important) return this.layers.size + 1;
    return layer === null ? this.layers.size : (this.layers.get(layer) ?? this.layers.size);
  }

  /** The layer a `@layer` block puts its rules in (an anonymous block stays in the layer around it). */
  private qualify(layer: string | null, prelude: string): string | null {
    if (prelude === "") return layer;
    return layer === null ? prelude : `${layer}.${prelude}`;
  }

  // --- Pass 1: variables ---------------------------------------------------------------------------------------------------

  /** Theme variables (`:root`, `:host`), `@property` initial values and the `@layer properties` defaults. */
  private collect(items: Item[], ctx: Ctx): void {
    for (const item of items) {
      if (item.kind === "at") {
        if (item.name === "layer" && item.body !== null) this.collect(item.body, { ...ctx, layer: this.qualify(ctx.layer, item.prelude) });
        else if (item.name === "property") this.collectProperty(item);
        else if (item.name === "media" && item.body !== null) {
          const media = narrow(ctx.when, item.prelude, this.remPx);
          if (!("error" in media) && media.when !== null) this.collect(item.body, { ...ctx, when: media.when });
        } else if (item.name === "supports" && item.body !== null) {
          // The `properties` layer's defaults sit in a `@supports` for old browsers; they are the defaults either way.
          if (supportsColorMix(item.prelude) || ctx.layer === "properties") this.collect(item.body, ctx);
        }
      } else if (item.kind === "rule") this.collectRule(item.selector, item.body, ctx);
    }
  }

  private collectProperty(item: Extract<Item, { kind: "at" }>): void {
    const initial = item.body?.find((i): i is Declaration => i.kind === "decl" && i.property === "initial-value");
    if (initial !== undefined) this.propertyDefaults.set(item.prelude.trim(), initial.value);
  }

  private collectRule(selector: string, body: Item[], ctx: Ctx): void {
    const parts = splitTop(selector, ",").map((part) => classifySelector(part));
    if (ctx.layer === "properties") {
      for (const decl of inlineSupports(body)) {
        if (decl.kind !== "decl" || !decl.property.startsWith("--")) continue;
        // `initial` is the guaranteed-invalid value: the default is that there is none.
        if (decl.value.trim() === "initial") this.propertyDefaults.delete(decl.property);
        else this.propertyDefaults.set(decl.property, decl.value);
      }
      return;
    }
    if (!parts.some((part) => part.kind === "root")) return;
    this.collectRootBody(body, ctx);
  }

  private collectRootBody(body: Item[], ctx: Ctx): void {
    for (const item of inlineSupports(body)) {
      if (item.kind === "decl") {
        if (!item.property.startsWith("--")) continue;
        // Only a condition on the scheme can be a variable's; a width-dependent variable is not expressible.
        if (ctx.when.minWidth !== undefined || ctx.when.maxWidth !== undefined || ctx.when.platform !== undefined) continue;
        const defs = this.themeVars.get(item.property) ?? [];
        defs.push({ value: item.value, scheme: ctx.when.scheme, rank: this.rank(ctx.layer, item.important), seq: this.seq++ });
        this.themeVars.set(item.property, defs);
      } else if (item.kind === "at" && item.name === "media" && item.body !== null) {
        const media = narrow(ctx.when, item.prelude, this.remPx);
        if (!("error" in media) && media.when !== null) this.collectRootBody(item.body, { ...ctx, when: media.when });
      }
    }
  }

  // --- Pass 2: classes -----------------------------------------------------------------------------------------------------

  private emit(items: Item[], ctx: Ctx): void {
    for (const item of items) {
      if (item.kind === "decl") continue;
      if (item.kind === "rule") this.emitRule(item.selector, item.body, ctx);
      else if (item.body === null || SILENT_AT_RULES.has(item.name)) continue;
      else if (item.name === "layer") this.emit(item.body, { ...ctx, layer: this.qualify(ctx.layer, item.prelude) });
      else if (item.name === "media") {
        const media = narrow(ctx.when, item.prelude, this.remPx);
        if ("error" in media) this.emit(item.body, { ...ctx, blocked: ctx.blocked ?? { property: "@media", reason: media.error } });
        else if (media.when !== null) this.emit(item.body, { ...ctx, when: media.when });
      } else if (item.name === "supports") {
        if (supportsColorMix(item.prelude)) this.emit(item.body, ctx);
        else this.emit(item.body, { ...ctx, blocked: ctx.blocked ?? { property: "@supports", reason: `@supports ${item.prelude} is not supported` } });
      } else this.emit(item.body, { ...ctx, blocked: ctx.blocked ?? { property: `@${item.name}`, reason: `@${item.name} is not supported` } });
    }
  }

  private report(className: string, property: string, reason: string): void {
    const key = `${className}\u0000${property}\u0000${reason}`;
    if (this.seen.has(key)) return;
    this.seen.add(key);
    this.unsupported.push({ className, property, reason });
  }

  /** What to say about a selector the table cannot hold; element selectors in Tailwind's own layers are not classes and not worth a word. */
  private reportSelector(sel: Extract<SelectorKind, { kind: "unsupported" }>, part: string, ctx: Ctx): void {
    if (sel.className === null) {
      if (ctx.layer === "theme" || ctx.layer === "base" || ctx.layer === "properties") return;
      this.report(part.trim(), "selector", sel.reason);
      return;
    }
    this.report(sel.className, "selector", sel.reason);
  }

  private emitRule(selector: string, body: Item[], ctx: Ctx): void {
    for (const part of splitTop(selector, ",")) {
      const sel = classifySelector(part);
      if (sel.kind === "root") continue;
      if (sel.kind === "unsupported") this.reportSelector(sel, part, ctx);
      else if (ctx.blocked !== null) this.report(sel.className, ctx.blocked.property, ctx.blocked.reason);
      else this.emitBody(sel.className, part.trim(), body, ctx, new Map());
    }
  }

  /** The rules of one class from a rule body: its declarations in runs, a nested block ending the run before it. */
  private emitBody(className: string, selector: string, body: Item[], ctx: Ctx, inherited: Map<string, string>): void {
    const items = inlineSupports(body);
    // The rule's own custom properties, wherever they are in the body, are what its declarations and nested blocks see.
    const own = new Map(inherited);
    for (const item of items) if (item.kind === "decl" && item.property.startsWith("--")) own.set(item.property, item.value);
    // A class that only sets custom properties (`shadow-sky-500`, `from-red-500`) works through another class's declaration, which a table cannot compose.
    if (items.length > 0 && items.every((item) => item.kind === "decl" && item.property.startsWith("--"))) {
      this.report(className, [...new Set(items.map((item) => (item as Declaration).property))].join(", "), "sets only custom properties, which another class's declaration would read; a class table does not compose classes");
    }
    let run: Declaration[] = [];
    const flush = () => {
      if (run.length > 0) this.emitDeclarations(className, run, ctx, own);
      run = [];
    };
    for (const item of items) {
      if (item.kind === "decl") {
        if (!item.property.startsWith("--")) run.push(item);
        continue;
      }
      flush();
      this.emitNested(className, selector, item, ctx, own);
    }
    flush();
  }

  private emitNested(className: string, selector: string, item: Exclude<Item, Declaration>, ctx: Ctx, own: Map<string, string>): void {
    if (item.kind === "rule") {
      for (const part of splitTop(item.selector, ",")) {
        const full = part.includes("&") ? part.replaceAll("&", selector) : `${selector} ${part}`;
        const sel = classifySelector(full);
        if (sel.kind === "class") this.emitBody(sel.className, full.trim(), item.body, ctx, own);
        else if (sel.kind === "unsupported") this.report(sel.className ?? className, "selector", sel.reason);
      }
      return;
    }
    if (item.body === null || SILENT_AT_RULES.has(item.name)) return;
    if (item.name === "layer") this.emitBody(className, selector, item.body, ctx, own);
    else if (item.name === "media") {
      const media = narrow(ctx.when, item.prelude, this.remPx);
      if ("error" in media) this.report(className, "@media", media.error);
      else if (media.when !== null) this.emitBody(className, selector, item.body, { ...ctx, when: media.when }, own);
    } else this.report(className, `@${item.name}`, `@${item.name} ${item.prelude} is not supported`);
  }

  /** Converts one run of declarations (normal ones, then the `!important` ones above every layer) into rules, once per scheme the values depend on. */
  private emitDeclarations(className: string, decls: Declaration[], ctx: Ctx, own: Map<string, string>): void {
    for (const important of [false, true]) {
      const group = decls.filter((decl) => decl.important === important);
      if (group.length === 0) continue;
      const seq = this.seq++;
      const rank = this.rank(ctx.layer, important);
      const results = this.resultsFor(className, group, ctx.when.scheme, own);
      for (const { scheme, result } of results) {
        if (isEmptyResult(result)) continue;
        const when: Cond = { ...ctx.when, ...(scheme !== undefined ? { scheme } : {}) };
        const rule: Omit<ClassRule, "order"> = { ...(Object.keys(when).length > 0 ? { when } : {}), style: result.style };
        if (Object.keys(result.dynamic).length > 0) rule.dynamic = result.dynamic;
        if (Object.keys(result.fontRelative).length > 0) rule.fontRelative = result.fontRelative;
        this.pending.push({ className, rank, seq, rule });
      }
    }
  }

  /**
   * The declarations' style under each scheme they could apply in: one result when no variable they read has a light/dark pair
   * (or the rule is already in a scheme), two when some does and the styles differ.
   */
  private resultsFor(className: string, decls: Declaration[], scheme: Scheme | undefined, own: Map<string, string>): { scheme?: Scheme; result: Result }[] {
    if (scheme !== undefined) return [{ result: this.evaluateDecls(className, decls, scheme, own).result }];
    const light = this.evaluateDecls(className, decls, "light", own);
    if (!light.dependsOnScheme) return [{ result: light.result }];
    const dark = this.evaluateDecls(className, decls, "dark", own);
    if (JSON.stringify(light.result) === JSON.stringify(dark.result)) return [{ result: light.result }];
    return [
      { scheme: "light", result: light.result },
      { scheme: "dark", result: dark.result },
    ];
  }

  private evaluateDecls(className: string, decls: Declaration[], scheme: Scheme, own: Map<string, string>): { result: Result; dependsOnScheme: boolean } {
    let dependsOnScheme = false;
    const lookup: VarLookup = (name) => {
      const mine = own.get(name);
      if (mine !== undefined) return mine.trim() === "initial" ? undefined : { value: mine, source: "own" };
      const defs = this.themeVars.get(name);
      if (defs !== undefined) {
        if (defs.some((def) => def.scheme !== undefined)) dependsOnScheme = true;
        const applicable = defs.filter((def) => def.scheme === undefined || def.scheme === scheme);
        const best = applicable.reduce<VarDef | undefined>((a, b) => (a === undefined || b.rank > a.rank || (b.rank === a.rank && b.seq > a.seq) ? b : a), undefined);
        if (best !== undefined) return { value: best.value, source: "theme" };
      }
      const fallback = this.propertyDefaults.get(name);
      return fallback === undefined ? undefined : { value: fallback, source: "default" };
    };
    const result = emptyResult();
    for (const decl of decls) convertDeclaration(decl.property, decl.value, { remPx: this.remPx, lookup }, result, (property, reason) => this.report(className, property, reason));
    return { result, dependsOnScheme };
  }

  // --- Output --------------------------------------------------------------------------------------------------------------

  /** Orders the rules by layer, then source (the light and dark twins of one rule share a place), and groups them by class. */
  private table(): ClassTable {
    const sorted = [...this.pending].sort((a, b) => a.rank - b.rank || a.seq - b.seq);
    const classes = new Map<string, ClassRule[]>();
    let order = 0;
    let last = "";
    for (const { className, rank, seq, rule } of sorted) {
      const key = `${rank}:${seq}`;
      if (key !== last) order++;
      last = key;
      const rules = classes.get(className) ?? [];
      rules.push({ order, ...rule });
      classes.set(className, rules);
    }
    return { version: 1, classes: Object.fromEntries(classes) };
  }
}

/**
 * Converts Tailwind 4's compiled CSS (and any CSS written next to it) into a class table. `remPx` is what `1rem` is in dp.
 * `unsupported` lists what was left out: classes with a pseudo-class or a combinator in their selector, at-rules and properties
 * with no React Native counterpart, values that cannot be resolved.
 */
export function convertCss(css: string, options: { remPx?: number } = {}): { table: ClassTable; unsupported: Unsupported[] } {
  return new Converter(options.remPx ?? 16).run(css);
}
