<script lang="ts">
  /**
   * The lab's screen of HTML elements and classes (`/__dev/html`, and the checks of the native checks lab, `html-lab.ts`): no component of the library is imported, the build turns the markup into
   * native views and texts, and the same file would be a page in a browser. What it holds, and what the checks read of it:
   *  - a card whose `text-lg text-sky-900` is inherited by the text inside it (a `p`, the spans of a flex row), with the headings' default styles;
   *  - a flex row with two spans (`justify-between`), which are two items;
   *  - a block `div` with text, spans and an `<a>`, which is one line (the link counts its presses);
   *  - a form: a text input, a password input, a checkbox, a submit button and a button that is not;
   *  - an `<hr>` and a `<pre>`.
   * `{@attach hold(name)}` keeps the element it is given, the renderer's node (`bind:this` gives a handle, which has no props), so the checks read the tree the host drew from: its props through
   * `mergeHostProps`, its snapshot, and what the host built for it (`hostState`). Every class is written in full, which is how Tailwind finds it.
   */
  const nodes: Record<string, unknown> = {};
  const hold = (name: string) => (element: unknown) => {
    nodes[name] = element;
    return () => { if (nodes[name] === element) delete nodes[name]; };
  };
  let links = $state(0);
  let submits = $state(0);
  let last = $state<{ type: string; prevented: boolean; target: boolean; submitter: boolean } | null>(null);
  let name = $state("");

  /** The renderer's node of an element of the screen, by name (the lab reads its props, its snapshot and what the host built for it). */
  export function node(wanted: string): unknown {
    return nodes[wanted];
  }
  /** What the screen counted: the presses of the link, the submissions of the form and what the last one looked like to its handler. */
  export function counted(): { links: number; submits: number; last: { type: string; prevented: boolean; target: boolean; submitter: boolean } | null } {
    return { links, submits, last };
  }
</script>

<div class="gap-4">
  <div {@attach hold("card")} class="gap-2 rounded-xl border border-sky-200 bg-sky-50 p-4 text-lg text-sky-900 dark:border-sky-800 dark:bg-sky-950 dark:text-sky-100">
    <h1 {@attach hold("h1")}>Heading one</h1>
    <h2>Heading two</h2>
    <h3>Heading three</h3>
    <p {@attach hold("p")}>Text that inherits the card's colour and size.</p>
    <div {@attach hold("row")} class="flex flex-row justify-between"><span {@attach hold("rowLeft")}>Total</span><span {@attach hold("rowRight")}>42</span></div>
  </div>

  <div {@attach hold("block")} class="text-base text-zinc-900 dark:text-zinc-100">Read the <a {@attach hold("link")} href="#terms" onclick={() => { links += 1; }} class="text-sky-600 underline dark:text-sky-400">terms of use</a> and the <span class="font-semibold">privacy notice</span>, or <b>both</b>.</div>
  <p class="text-sm text-zinc-600 dark:text-zinc-400">Link presses: {links}. Submissions: {submits}.</p>

  <form
    {@attach hold("form")}
    onsubmit={(event) => {
      event.preventDefault();
      submits += 1;
      last = { type: event.type, prevented: event.defaultPrevented, target: event.target === nodes.form, submitter: (event.submitter as unknown) === nodes.submit };
    }}
    class="gap-3"
  >
    <input aria-label="Name" placeholder="Name" bind:value={name} class="min-h-12 rounded-xl border border-zinc-300 px-3 text-base text-zinc-900 dark:border-zinc-700 dark:text-zinc-100" />
    <input type="password" aria-label="Password" placeholder="Password" class="min-h-12 rounded-xl border border-zinc-300 px-3 text-base text-zinc-900 dark:border-zinc-700 dark:text-zinc-100" />
    <label class="flex-row items-center justify-between"><span class="text-base text-zinc-900 dark:text-zinc-100">Remember me</span><input type="checkbox" aria-label="Remember me" /></label>
    <button {@attach hold("submit")} type="submit" class="items-center rounded-xl bg-sky-600 px-4 py-3 text-base font-semibold text-white">Send</button>
    <button {@attach hold("cancel")} type="button" class="items-center rounded-xl bg-zinc-200 px-4 py-3 text-base text-zinc-900">Cancel</button>
  </form>

  <hr />
  <pre class="text-sm text-zinc-900 dark:text-zinc-100">pre keeps   its spaces
  and its lines</pre>
</div>
