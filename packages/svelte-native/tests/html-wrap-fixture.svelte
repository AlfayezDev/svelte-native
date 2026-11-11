<script lang="ts">
  import Btn from "./html-btn-fixture.svelte";
  import Inp from "./html-inp-fixture.svelte";
  const probe = globalThis as unknown as { __log: string[] };
  let pw = $state("");
  let amount = $state(5);
  const linkProps = { href: "https://example.com/spread" };
  const preventing = { onclick: (event: { preventDefault(): void }) => { event.preventDefault(); probe.__log.push("link prevented"); } };
</script>

<a testID="spread-link" {...linkProps}>Go</a>
<a testID="spread-prevented" href="https://example.com/never" {...preventing}>Never</a>

<form testID="f" onsubmit={(event) => { event.preventDefault(); probe.__log.push("submitted"); }}>
  <Btn testID="cancel" type="button" onclick={() => probe.__log.push("cancel")}>Cancel</Btn>
  <Btn testID="save" onclick={() => probe.__log.push("save click")}>Save</Btn>
  <Btn testID="prevent" onclick={(event) => { event.preventDefault(); probe.__log.push("prevented"); }}>Prevent</Btn>
  <Inp testID="pass" type="password" bind:value={pw} oninput={(event) => probe.__log.push(`input ${event.currentTarget.value}`)} maxlength="8" />
  <Inp testID="off" disabled readonly />
  <Inp testID="num" type="number" bind:value={amount} />
</form>
