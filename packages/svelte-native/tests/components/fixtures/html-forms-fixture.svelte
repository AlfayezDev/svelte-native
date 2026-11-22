<script lang="ts">
  // Implicit submission (#79), a dialog's onclose from a spread (#81), autocomplete over the type (#86), inputmode and enterkeyhint (#87), readonly (#95).
  import { TextInput } from "@alfayez/svelte-native/core";
  const probe = globalThis as unknown as { __htmlLog: (entry: string) => void; __htmlForms: Record<string, unknown> };
  const log = (entry: string) => probe.__htmlLog(entry);
  let ready = $state(false);
  let shown = $state(true);
  let locked = $state(true);
  const newPassword = { type: "password", autocomplete: "new-password" };
  const nativeWins = { type: "password", autocomplete: "new-password", autoComplete: "password" };
  const closing = { onclose: () => log("closed") };
  const hints = $state({ inputmode: "decimal", enterkeyhint: "send" });
  const who = (event: SubmitEvent) => String((event.submitter as unknown as { getProp(key: string): unknown } | null)?.getProp("testID") ?? "none");
  probe.__htmlForms = {
    setReady: (value: boolean) => { ready = value; },
    setHints: (inputmode: string, enterkeyhint: string) => { hints.inputmode = inputmode; hints.enterkeyhint = enterkeyhint; },
    shown: () => shown,
    setLocked: (value: boolean) => { locked = value; },
  };
</script>

<form testID="send-form" onsubmit={(event) => { event.preventDefault(); log(`submit ${who(event)}`); }}>
  <input testID="message" type="text" />
  <button testID="send" type="submit" disabled={!ready} onclick={() => log("click send")}>Send</button>
  <button testID="draft" type="submit" onclick={() => log("click draft")}>Save draft</button>
</form>
<form onsubmit={(event) => log(`lone ${who(event)}`)}>
  <input testID="lone" />
  <textarea testID="lone-notes"></textarea>
</form>
<form onsubmit={(event) => log(`pair ${who(event)}`)}>
  <input testID="first" />
  <input testID="second" />
</form>
<form onsubmit={(event) => log(`plain ${who(event)}`)}>
  <input testID="before-plain" />
  <input testID="other" />
  <button testID="plain" type="button" onclick={() => log("click plain")}>Plain</button>
  <button testID="last" onclick={(event) => { event.preventDefault(); log("click last"); }}>Last</button>
</form>

<dialog testID="spread-dialog" bind:open={shown} {...closing}>Edit details</dialog>

<input testID="current" type="password" autocomplete="current-password" />
<input testID="new" {...newPassword} />
<input testID="email-off" type="email" autocomplete="off" />
<input testID="tel-off" type="tel" autocomplete="off" />
<input testID="otp" autocomplete="one-time-code" />
<input testID="native-wins" {...nativeWins} />
<input testID="amount" inputmode="decimal" enterkeyhint="send" />
<input testID="email-numeric" type="email" inputmode="numeric" enterkeyhint="next" />
<textarea testID="message-area" inputmode="decimal" enterkeyhint="send"></textarea>
<input testID="search" type="search" enterkeyhint="go" />
<input testID="no-keyboard" inputmode="none" />
<input testID="spread-hints" {...hints} />
<input testID="read-only" readonly />
<input testID="locked" value="Invoice 42" readonly={locked} />
<textarea testID="locked-note" value="Invoice note" {...{ readonly: locked }}></textarea>
<TextInput testID="locked-native" value="Invoice 42" readOnly={locked} />
