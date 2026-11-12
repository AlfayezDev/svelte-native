<script lang="ts">
  import Page from "#lib/components/Page.svelte";
  import Section from "#lib/components/Section.svelte";
  import { scroller, typeInto, useDemo } from "#lib/demo.ts";

  // Everything below the Page frame is HTML: no component of the library is imported for it. The build turns div, p, button, a, img, input, form and
  // dialog into native views, texts, pressables, an image, a TextInput, a Switch and a Modal, and the file would mean the same in a browser.
  // Text style set by a class or a style on an element (text-white on the button, text-sm on the card) reaches the text inside it, as in CSS.
  // An 8 by 8 gradient, as a data URI: `src` of an `img` is a string, as it is in a browser.
  const avatar = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAgAAAAICAIAAABLbSncAAAAT0lEQVR42mPgW/pSbPEruYWv1ea/0Zv71nzOO/tZ791nfGDAKuo/7SMDVtHwKZ8YsIomTP7MgFU0Y+IXBqyiBf1fGbCKVvR+Y8Aq2tjzAwAAqnPEnjmbYwAAAABJRU5ErkJggg==";
  type Contact = { id: number; name: string; email: string };
  let contacts = $state<Contact[]>([
    { id: 1, name: "Amal Haddad", email: "amal@example.com" },
    { id: 2, name: "Jon Reyes", email: "jon@example.com" },
  ]);
  let name = $state("");
  let email = $state("");
  let updates = $state(true);
  let message = $state("Add a contact, or remove one.");
  let removing = $state<Contact | undefined>();
  let nextId = 3;

  function add(event?: SubmitEvent) {
    event?.preventDefault();
    contacts.push({ id: nextId++, name: name.trim(), email: email.trim() });
    message = `Added ${name.trim()}${updates ? ", who will get updates" : ""}.`;
    name = email = "";
  }
  function remove() {
    if (!removing) return;
    contacts = contacts.filter((contact) => contact !== removing);
    message = `Removed ${removing.name}.`;
    removing = undefined;
  }

  // `?demo`: fill in the form and add a contact, then remove that contact through the dialog.
  let { url }: { url: URL } = $props();
  const view = scroller();
  useDemo(() => url, [
    [() => view.glide(360, 900), 300],
    [(signal) => typeInto((value) => (name = value), "Sam Ito", 70, signal), 300],
    [(signal) => typeInto((value) => (email = value), "sam@example.com", 55, signal), 500],
    [() => add(), 900],
    [() => view.glide(0, 800), 300],
    [() => (removing = contacts[2]), 1800],
    [() => { remove(); message = "Add a contact, or remove one."; }, 0],
  ]);
</script>

<Page title="HTML elements" scrollRef={view.ref} intro="This screen is written with HTML elements and Tailwind classes. The build turns them into native views, so the same markup could also be a web page.">
  <Section title="A card list" note="ul and li are views, h3 and p texts, img an image, button a pressable. text-sm on the card sets the size of the text inside it.">
    <ul class="gap-3">
      {#each contacts as contact (contact.id)}
        <li class="flex-row items-center gap-3 rounded-xl border border-zinc-300 bg-white p-3 text-sm dark:border-zinc-700 dark:bg-zinc-900">
          <img src={avatar} alt="" class="h-12 w-12 rounded-full" />
          <div class="flex-1">
            <h3 class="text-base font-semibold text-zinc-900 dark:text-zinc-100">{contact.name}</h3>
            <p class="text-zinc-600 dark:text-zinc-400">{contact.email}</p>
          </div>
          <button onclick={() => (removing = contact)} class="rounded-lg bg-rose-100 px-3 py-2 text-rose-700">Remove</button>
        </li>
      {/each}
    </ul>
    <p class="text-sm text-zinc-600 dark:text-zinc-400">{message}</p>
  </Section>

  <Section title="A form" note="input is a TextInput with the keyboard of its type, the checkbox a Switch. The button submits the form, and so does Enter in the last field.">
    <form onsubmit={add} class="gap-3">
      <input bind:value={name} placeholder="Name" class="min-h-12 rounded-xl border border-zinc-300 px-3 text-base text-zinc-900 dark:border-zinc-700 dark:text-zinc-100" />
      <input bind:value={email} type="email" placeholder="Email" class="min-h-12 rounded-xl border border-zinc-300 px-3 text-base text-zinc-900 dark:border-zinc-700 dark:text-zinc-100" />
      <label class="flex-row items-center justify-between">
        <span class="text-base text-zinc-900 dark:text-zinc-100">Send updates</span>
        <input type="checkbox" bind:checked={updates} />
      </label>
      <button type="submit" disabled={name.trim() === "" || email.trim() === ""} class="items-center rounded-xl bg-sky-600 px-4 py-3 text-base font-semibold text-white">Add contact</button>
    </form>
  </Section>

  <Section title="Links" note="A path goes to a screen of the app, as router.goto does; a web address is opened by the phone.">
    <p class="text-base text-zinc-900 dark:text-zinc-100">
      See the <a href="/navigation/stack" class="text-sky-600 underline">stack screen</a>, or read about
      <a href="https://svelte.dev" class="text-sky-600 underline">Svelte</a>.
    </p>
  </Section>

  <dialog open={removing !== undefined} onclose={() => (removing = undefined)}>
    <div class="flex-1 justify-center gap-3 bg-white p-8 dark:bg-zinc-900">
      <h3 class="text-xl font-semibold text-zinc-900 dark:text-zinc-100">Remove {removing?.name}?</h3>
      <p class="text-base text-zinc-600 dark:text-zinc-400">The contact is taken off the list. The dialog is a Modal: the Back key or a swipe closes it too.</p>
      <button onclick={remove} class="items-center rounded-xl bg-rose-600 px-4 py-3 text-base font-semibold text-white">Remove</button>
      <button onclick={() => (removing = undefined)} class="items-center rounded-xl bg-zinc-200 px-4 py-3 text-base text-zinc-900">Cancel</button>
    </div>
  </dialog>
</Page>
