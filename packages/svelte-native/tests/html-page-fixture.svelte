<script lang="ts">
  // A page written with HTML only: no import from the package. The Metro transformer lowers it (`lowerPrimitives(..., { html: true })`).
  const probe = globalThis as unknown as { __htmlLog: (entry: string) => void; __htmlPage: Record<string, unknown> };
  const log = (entry: string) => probe.__htmlLog(entry);
  let name = $state("Ada");
  let agreed = $state(false);
  let showDialog = $state(false);
  let secret = $state(true);
  let box: unknown = $state(null);
  let section: unknown = $state(null);
  const extra = { accessibilityLabel: "from a spread", onclick: () => log("section") };
  const links = ["/a", "/b"];
  probe.__htmlPage = {
    snapshot: () => ({ name, agreed, showDialog, boxed: box !== null, sectioned: section !== null }),
    setDialog: (value: boolean) => { showDialog = value; },
    setName: (value: string) => { name = value; },
    toggleSecret: () => { secret = !secret; },
  };
</script>

<div testID="card" class="card" onclick={() => log("card")}>
  Hello {name}
  <h1 testID="title">Title</h1>
  <p testID="para">Read the <a href="/a" testID="terms">terms</a> or <b>else</b>.</p>
  <ul>
    {#each links as link (link)}
      <li testID={`row${link}`}>{link}</li>
    {/each}
  </ul>
  <button testID="save" type="submit" disabled={!name} onclick={() => log("save")}>Save</button>
  <button testID="off" disabled onclick={() => log("off")}>Off</button>
  <a testID="go" href="/a">Go to A</a>
  <a testID="site" href="https://example.com/x" onclick={() => log("site")}>Site</a>
  <img testID="logo" src="/logo.png" alt="Logo" width="40" height="30" />
  <img testID="asset" src={{ uri: "https://x.dev/a.png" }} />
  <input testID="email" type="email" bind:value={name} bind:this={box} placeholder="Email" maxlength="20" oninput={(event) => log(`input ${event.currentTarget.value}`)} />
  <input testID="pass" type={secret ? "password" : "text"} />
  <input testID="off-input" disabled />
  <textarea testID="notes" rows="3"></textarea>
  <input testID="agree" type="checkbox" bind:checked={agreed} onchange={(event) => log(`agree ${event.currentTarget.checked}`)} />
  <section testID="styled" style={{ padding: 4 }} {...extra} bind:this={section}>style</section>
  <dialog testID="dialog" open={showDialog}><p testID="dialog-text">Dialog body</p></dialog>
</div>
