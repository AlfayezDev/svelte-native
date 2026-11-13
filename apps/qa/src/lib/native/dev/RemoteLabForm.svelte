<script lang="ts">
  import { Switch, Text, TextInput, View } from "@alfayez/svelte-native";
  import { native } from "@alfayez/svelte-native/remote";
  import { theme } from "#lib/native/state.svelte.ts";
  import Button from "#lib/native/components/Button.svelte";
  import { labSignup } from "#lib/native/dev/remote-lab.remote.ts";
  import { field } from "#lib/native/dev/remote-lab-style.ts";

  /**
   * The form a person fills in on the remote functions lab page: SvelteKit's `form` with TextInput and Switch. A component of its own, shown once the app
   * has a host: making the form calls a remote function, which says "no host" when there is none, and the page has to stay up to take one.
   */
  const signup = native(labSignup);
  let outcome = $state("");
  async function submit() {
    outcome = "";
    try { outcome = (await signup.submit()) ? "sent" : "not accepted"; }
    catch (error) { outcome = `error: ${error instanceof Error ? error.message : String(error)}`; }
  }
</script>

<View style={{ gap: 8 }}>
  <Text accessibilityRole="header" style={{ color: theme.foreground, fontSize: 20, fontWeight: "600" }}>Form</Text>
  <TextInput {...signup.fields.name.as("text")} accessibilityLabel="Name" placeholder="Name" placeholderTextColor={theme.muted} style={field} />
  {#each signup.fields.name.issues() ?? [] as issue (issue.message)}<Text accessibilityRole="alert" style={{ color: theme.danger, fontSize: 14 }}>{issue.message}</Text>{/each}
  <TextInput {...signup.fields.age.as("number")} accessibilityLabel="Age" placeholder="Age" placeholderTextColor={theme.muted} style={field} />
  {#each signup.fields.age.issues() ?? [] as issue (issue.message)}<Text accessibilityRole="alert" style={{ color: theme.danger, fontSize: 14 }}>{issue.message}</Text>{/each}
  <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between" }}>
    <Text style={{ color: theme.foreground, fontSize: 16 }}>Subscribe</Text>
    <Switch {...signup.fields.subscribe.as("checkbox")} accessibilityLabel="Subscribe" />
  </View>
  <Button label="Sign up" onPress={submit} busy={signup.pending > 0} />
  <Text testID="remote.form.outcome" style={{ color: theme.muted, fontSize: 13 }}>{outcome}{signup.error ? ` error ${signup.error.status}: ${signup.error.message}` : ""}{signup.result ? ` ${JSON.stringify(signup.result)}` : ""}</Text>
</View>
