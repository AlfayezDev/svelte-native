<script lang="ts">
  import { KeyboardAvoidingView, Screen, ScrollView, Switch, Text, TextInput, View, insets } from "@example/svelte-native";
  import Button from "#lib/components/Button.svelte";
  import Section from "#lib/components/Section.svelte";
  import { typeInto, useDemo } from "#lib/demo.ts";
  import { text, theme } from "#lib/theme.svelte.ts";

  // TextInput and Switch bind to state: `bind:value` keeps a variable and the native view in step, in both directions. The form below checks
  // its fields with `$derived` and shows the errors after the first submit. `returnKeyType` and `onSubmitEditing` move from field to field
  // (the input's `ref` callback gets a handle with `focus()`), and the KeyboardAvoidingView lifts the form above the keyboard.
  let echo = $state("");
  let notifications = $state(true);

  let email = $state("");
  let password = $state("");
  let agree = $state(false);
  let submitted = $state(false);
  let emailInput: { focus(): void; blur(): void } | null = null;
  let passwordInput: { focus(): void; blur(): void } | null = null;
  const errors = $derived({
    email: /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim()) ? "" : "Enter an address like name@example.com.",
    password: password.length >= 8 ? "" : "Use at least 8 characters.",
    agree: agree ? "" : "Agree to the terms to continue.",
  });
  const valid = $derived(errors.email === "" && errors.password === "" && errors.agree === "");
  const shown = $derived(submitted ? errors : { email: "", password: "", agree: "" });
  const input = $derived({ minHeight: 48, paddingHorizontal: 12, borderRadius: 12, borderWidth: 1, borderColor: theme.colors.border, color: theme.colors.text, fontSize: 16 });
  const error = $derived({ color: theme.colors.danger, fontSize: 14 });

  // `?demo`: type into the echo field and flip the switch, then fill in the form wrongly (the keyboard opens and the form rises above it),
  // submit it, correct it and submit again.
  let { url }: { url: URL } = $props();
  useDemo(() => url, [
    [() => typeInto((value) => (echo = value), "Hello Svelte", 70), 400],
    [() => (notifications = false), 800],
    [() => (notifications = true), 300],
    [() => emailInput?.focus(), 900],
    [() => typeInto((value) => (email = value), "sam@example", 50), 200],
    [() => passwordInput?.focus(), 500],
    [() => typeInto((value) => (password = value), "secret", 50), 200],
    [() => { submitted = true; passwordInput?.blur(); }, 1400],
    [async () => {
      await typeInto((value) => (email = `sam@example${value}`), ".com", 60);
      await typeInto((value) => (password = `secret${value}`), "-phrase", 50);
      agree = true;
    }, 1800],
    [() => { echo = email = password = ""; agree = submitted = false; }, 0],
  ], { hold: 800 });
</script>

<Screen title="Inputs and forms">
  <KeyboardAvoidingView behavior="padding" style={{ flex: 1 }}>
    <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={{ padding: 20, paddingBottom: 20 + insets.bottom, gap: 24 }}>
      <Text style={text.body}>TextInput and Switch are bound to variables. The form at the bottom validates as you type and tells you what is wrong once you submit.</Text>

      <Section title="TextInput" note="bind:value keeps the variable and the native input in step.">
        <TextInput bind:value={echo} placeholder="Type here" placeholderTextColor={theme.colors.muted} accessibilityLabel="Type here" style={input} />
        <Text style={text.body}>{echo === "" ? "Nothing typed yet." : `You typed: ${echo}`}</Text>
      </Section>

      <Section title="Switch">
        <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between" }}>
          <Text style={text.body}>Notifications are {notifications ? "on" : "off"}</Text>
          <Switch bind:value={notifications} accessibilityLabel="Notifications" />
        </View>
      </Section>

      <Section title="A small form">
        <TextInput
          bind:value={email}
          ref={(handle) => (emailInput = handle)}
          keyboardType="email-address"
          autoCapitalize="none"
          autoCorrect={false}
          returnKeyType="next"
          onSubmitEditing={() => passwordInput?.focus()}
          placeholder="Email"
          placeholderTextColor={theme.colors.muted}
          accessibilityLabel="Email"
          style={[input, shown.email !== "" && { borderColor: theme.colors.danger }]}
        />
        {#if shown.email}<Text style={error}>{shown.email}</Text>{/if}
        <TextInput
          bind:value={password}
          ref={(handle) => (passwordInput = handle)}
          secureTextEntry
          returnKeyType="done"
          onSubmitEditing={() => (submitted = true)}
          placeholder="Password"
          placeholderTextColor={theme.colors.muted}
          accessibilityLabel="Password"
          style={[input, shown.password !== "" && { borderColor: theme.colors.danger }]}
        />
        {#if shown.password}<Text style={error}>{shown.password}</Text>{/if}
        <View style={{ flexDirection: "row", alignItems: "center", gap: 12 }}>
          <Switch bind:value={agree} accessibilityLabel="Agree to the terms" />
          <Text style={[text.body, { flex: 1 }]}>I agree to the terms</Text>
        </View>
        {#if shown.agree}<Text style={error}>{shown.agree}</Text>{/if}
        <Button label="Create account" onPress={() => (submitted = true)} />
        {#if submitted && valid}<Text style={text.body} accessibilityLiveRegion="polite">Account created for {email.trim()}.</Text>{/if}
      </Section>
    </ScrollView>
  </KeyboardAvoidingView>
</Screen>
