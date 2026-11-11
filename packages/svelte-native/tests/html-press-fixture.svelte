<script>
  let { log } = $props();
  // The press handlers below are `undefined` while the gate is closed (an `onclick` that may be undefined: the element is no responder, and the press goes to the one around it).
  let gate = $state(true);
  let words = $state(true);
  export function setGate(open) { gate = open; }
  export function setWords(shown) { words = shown; }
  const note = (name) => () => log(name);
</script>
<div testID="root" onclick={note("root.press")}>
  <div testID="div" onclick={gate ? note("div.press") : undefined}>d</div>
  <span testID="span" onclick={gate ? note("span.press") : undefined}>s</span>
  <button testID="button" onclick={gate ? note("button.press") : undefined}>b</button>
  <div testID="spread" {...(gate ? { onclick: note("spread.press") } : {})}>x</div>
</div>
<p testID="para" onclick={note("para.press")}>See <a testID="link" href="mailto:a@b.c" onclick={gate ? note("link.press") : undefined}>this link</a> and <span testID="inner" onclick={gate ? note("inner.press") : undefined}>this</span> here</p>
<div testID="run" onclick={note("run.press")}>{#if words}See {/if}<span testID="runSpan" onclick={note("runSpan.press")}>run span</span>{#if words} here{/if}</div>
<div testID="linkBox" onclick={note("linkBox.press")}><a testID="boxLink" href="mailto:r@b.c" onclick={note("boxLink.press")}>box link</a></div>
