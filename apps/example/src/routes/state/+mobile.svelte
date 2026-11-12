<script lang="ts">
  import { ActivityIndicator, Pressable, Switch, Text, TextInput, View } from "@rasheed/svelte-native";
  import Button from "#lib/components/Button.svelte";
  import Page from "#lib/components/Page.svelte";
  import Section from "#lib/components/Section.svelte";
  import { scroller, typeInto, useDemo } from "#lib/demo.ts";
  import { text, theme } from "#lib/theme.svelte.ts";

  // Svelte's runes drive native views the way they drive a web page: change `$state` and the views that read it update. This screen uses
  // `$state` and `$derived` (a counter), `$effect` with a cleanup (a timer), a `$state` array of objects whose fields are bound to Switches
  // (a todo list), and an `{#await}` block. The colours of the whole app come from state as well: src/lib/theme.svelte.ts.
  let count = $state(0);
  const doubled = $derived(count * 2);

  let running = $state(false);
  let seconds = $state(0);
  $effect(() => {
    if (!running) return;
    const timer = setInterval(() => (seconds += 1), 1000);
    return () => clearInterval(timer);
  });

  let nextId = 4;
  let draft = $state("");
  let todos = $state([
    { id: 1, title: "Read the README", done: true },
    { id: 2, title: "Open this screen", done: true },
    { id: 3, title: "Tick this one", done: false },
  ]);
  const remaining = $derived(todos.filter((todo) => !todo.done).length);
  function add() {
    const title = draft.trim();
    if (title === "") return;
    todos.push({ id: nextId++, title, done: false });
    draft = "";
  }

  const ask = () => new Promise<number>((resolve) => setTimeout(() => resolve(Math.round(Math.random() * 100)), 800));
  let answer = $state.raw(ask());

  // `?demo`: count up, run the timer, tick a todo and add one, ask again, and put it all back.
  let { url }: { url: URL } = $props();
  const view = scroller();
  useDemo(() => url, [
    [() => count++, 500],
    [() => count++, 700],
    [() => (running = true), 1400],
    [() => (running = false), 300],
    [() => view.glide(430, 700), 300],
    [() => (todos[2].done = true), 600],
    [() => typeInto((value) => (draft = value), "Water plants", 50), 300],
    [add, 400],
    [() => view.glide(800, 700), 200],
    [() => (answer = ask()), 1000],
    [() => { count = 0; seconds = 0; todos.pop(); todos[2].done = false; return view.glide(0, 800); }, 0],
  ], { hold: 800 });
</script>

<Page title="State and reactivity" scrollRef={view.ref} intro="There is no setState and no hook. A variable declared with $state is reactive: assign to it and every native view that reads it updates.">
  <Section title="$state and $derived" note="doubled is computed from count and recomputes by itself.">
    <Text style={[text.heading, { fontSize: 28 }]}>{count} doubled is {doubled}</Text>
    <View style={{ flexDirection: "row", gap: 8 }}>
      <View style={{ flex: 1 }}><Button label="Add one" onPress={() => count++} /></View>
      <View style={{ flex: 1 }}><Button label="Reset" variant="secondary" onPress={() => (count = 0)} /></View>
    </View>
  </Section>

  <Section title="$effect" note="The effect starts a timer while the switch is on, and its cleanup stops it when the switch goes off.">
    <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between" }}>
      <Text style={text.body}>Count seconds: {seconds}</Text>
      <Switch bind:value={running} accessibilityLabel="Count seconds" />
    </View>
  </Section>

  <Section title="A list in state" note="Each switch is bound to a field of an object in the array; nothing else is needed to keep it in sync.">
    {#each todos as todo, index (todo.id)}
      <View style={{ flexDirection: "row", alignItems: "center", gap: 12 }}>
        <Switch bind:value={todo.done} accessibilityLabel={`Done: ${todo.title}`} />
        <Text style={[text.body, { flex: 1 }, todo.done && { textDecorationLine: "line-through", color: theme.colors.muted }]}>{todo.title}</Text>
        <Pressable accessibilityRole="button" accessibilityLabel={`Remove ${todo.title}`} onPress={() => todos.splice(index, 1)} hitSlop={8}>
          <Text style={[text.heading, { color: theme.colors.muted }]}>✕</Text>
        </Pressable>
      </View>
    {/each}
    <Text style={text.caption}>{remaining} left</Text>
    <TextInput
      bind:value={draft}
      onSubmitEditing={add}
      returnKeyType="done"
      placeholder="Something to do"
      placeholderTextColor={theme.colors.muted}
      accessibilityLabel="New todo"
      style={{ minHeight: 48, paddingHorizontal: 12, borderRadius: 12, borderWidth: 1, borderColor: theme.colors.border, color: theme.colors.text, fontSize: 16 }}
    />
    <Button label="Add" onPress={add} />
  </Section>

  <Section title="Await blocks" note="A pending promise shows a spinner, and a new promise starts over.">
    {#await answer}
      <ActivityIndicator color={theme.colors.accent} accessibilityLabel="Waiting" />
    {:then value}
      <Text style={text.body}>The answer is {value}.</Text>
    {/await}
    <Button label="Ask again" variant="secondary" onPress={() => (answer = ask())} />
  </Section>
</Page>
