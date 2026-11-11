import { tick } from "svelte";
import { Appearance } from "@rasheed/svelte-native/platform";
import { mergeHostProps } from "@rasheed/svelte-native/renderer";
import { sentStyle, type Outcome, type Style } from "./class-checks.ts";
import { builtOf, expectations, find, htmlCheckNames, isBlank, members, textOf, type Counted, type HtmlNode, type InputRead, type MemberRead } from "./html-checks.ts";

/**
 * The HTML checks of the native checks lab (`/__dev`, "Run all checks", after the class checks): the elements of `HtmlScreen.svelte` are written in HTML, and what the host drew from them is read on the
 * device from the mounted tree (`html-checks.ts` says which reads). The submit check presses the button the way the host hears a press: the node's own press handlers, called with the event the host's dispatch
 * gives an element lowered from HTML (`currentTarget` and `target` the node), so the button's click, the form's submission and the handler the screen wrote are the real ones.
 */

/** What `HtmlScreen.svelte` hands out. */
export type HtmlProbeHandle = { node(name: string): unknown; counted(): Counted };
type Report = (name: string, passed: boolean, detail?: string) => void;

const nodeNames = ["card", "h1", "p", "row", "rowLeft", "rowRight", "block", "link", "form", "submit", "cancel"] as const;
const settle = async () => { await tick(); await Promise.resolve(); await tick(); };

/** Presses [node] as the host does: its press handlers (the key is `Press`, or `press`) get the event of an element lowered from HTML. */
function press(node: HtmlNode): void {
  const type = [...node.listeners.keys()].find((key) => key.toLowerCase() === "press");
  if (type === undefined) throw new Error(`${node.name} has no press handler`);
  node.dispatcher(type)({ nativeEvent: {}, currentTarget: node, target: node });
}

export async function runHtmlChecks(probe: HtmlProbeHandle | undefined, report: Report): Promise<void> {
  const missing = probe ? nodeNames.filter((name) => typeof (probe.node(name) as HtmlNode | undefined)?.getSnapshot !== "function") : [...nodeNames];
  if (!probe || missing.length > 0) {
    // Each check still reports, so that a screen that did not mount is that many failures and not a count that quietly fell.
    for (const name of htmlCheckNames) report(name, false, `the screen's elements are not mounted: ${missing.join(", ")}`);
    return;
  }
  const node = (name: (typeof nodeNames)[number]): HtmlNode => probe.node(name) as HtmlNode;
  /** What the host sends for a node from its own attributes (class under style), flattened: the style the element was given, before it inherits. */
  const own = (target: HtmlNode): Style => sentStyle(mergeHostProps(target.peekProps()));
  const [inherit, row, block, heading, submit, password] = htmlCheckNames;
  const outcomes = new Map<string, Outcome>();
  const card = own(node("card"));

  outcomes.set(inherit, expectations.inherit(card, builtOf(node("p")), builtOf(node("rowLeft")), Appearance.getColorScheme() === "dark" ? "dark" : "light"));

  const items = members(node("row")).filter((member) => !isBlank(member));
  outcomes.set(row, expectations.row(builtOf(node("row")), items.map((item) => ({ view: builtOf(item)?.viewName, text: textOf(item) }))));

  const parts: MemberRead[] = members(node("block")).map((member) => {
    const built = builtOf(member);
    return { kind: member.kind, view: built?.viewName, text: textOf(member), role: built?.props.accessibilityRole, href: built?.props.href };
  });
  outcomes.set(block, expectations.block(builtOf(node("block")), parts));

  outcomes.set(heading, expectations.heading(card, builtOf(node("h1"))));

  const before = probe.counted();
  press(node("submit"));
  await settle();
  const afterSubmit = probe.counted();
  press(node("cancel"));
  await settle();
  outcomes.set(submit, expectations.submit(before, afterSubmit, probe.counted()));

  const inputs = find(node("form"), (candidate) => candidate.name === "native-input");
  const sent = (target: HtmlNode) => mergeHostProps(target.peekProps());
  const read = (target: HtmlNode | undefined): InputRead | null => (target ? { own: sent(target).secureTextEntry, built: builtOf(target)?.props.secureTextEntry } : null);
  outcomes.set(password, expectations.password(read(inputs.find((input) => sent(input).placeholder === "Password")), read(inputs.find((input) => sent(input).placeholder !== "Password"))));

  for (const name of htmlCheckNames) {
    const outcome = outcomes.get(name);
    report(name, outcome?.passed === true, outcome?.detail ?? "the check did not run");
  }
}
