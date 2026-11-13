<script lang="ts">
  import { Text, TextInput, View } from "@alfayez/svelte-native";
  import { native } from "@alfayez/svelte-native/remote";
  import Button from "#lib/components/Button.svelte";
  import Section from "#lib/components/Section.svelte";
  import { addNote, hello, listNotes, visit, visits } from "#lib/remote/notes.remote.ts";
  import { text, theme } from "#lib/theme.svelte.ts";

  // The part of the Remote functions screen that calls the server. It is a component of its own because calling a remote function without a host
  // throws: the screen shows it only once a host is set. `hello("...")` is a query, `visit()` a command, `addNote` a form.
  const greeting = hello("Svelte Native");
  const counter = visits();
  const notes = listNotes();
  const add = native(addNote); // the same object, typed for native inputs
  let failure = $state("");
  const field = $derived({ minHeight: 48, borderWidth: 1, borderColor: theme.colors.border, borderRadius: 12, paddingHorizontal: 12, color: theme.colors.text, fontSize: 16 });
</script>

<Section title="query" note="Read greeting.current, or greeting.loading and greeting.error.">
  <Text style={text.body}>{greeting.error ? `Error: ${greeting.error.message}` : (greeting.current ?? "Loading")}</Text>
</Section>

<Section title="command" note="The server adds one and answers with the new number.">
  <Text style={text.body}>Visits counted: {counter.current ?? "..."}</Text>
  <Button label="Count a visit" onPress={() => { failure = ""; visit().catch((error: unknown) => { failure = String(error); }); }} />
  {#if failure}<Text accessibilityRole="alert" style={[text.caption, { color: theme.colors.danger }]}>{failure}</Text>{/if}
</Section>

<Section title="form" note="The fields spread onto a TextInput. The server's schema checks them.">
  <TextInput {...add.fields.text.as("text")} accessibilityLabel="Note" placeholder="A note" placeholderTextColor={theme.colors.muted} style={field} />
  {#each add.fields.text.issues() ?? [] as issue (issue.message)}<Text accessibilityRole="alert" style={[text.caption, { color: theme.colors.danger }]}>{issue.message}</Text>{/each}
  <Button label="Add the note" onPress={() => add.submit()} disabled={add.pending > 0} />
  <View style={{ gap: 4 }}>
    {#each notes.current ?? [] as note, index (index)}<Text style={text.body}>{note}</Text>{/each}
  </View>
</Section>
