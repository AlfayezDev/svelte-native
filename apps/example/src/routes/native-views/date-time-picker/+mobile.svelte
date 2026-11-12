<script lang="ts">
  import { Text } from "@rasheed/svelte-native";
  import { DateTimePicker, openDatePicker } from "@rasheed/svelte-native/foreign";
  import Platform from "react-native/Libraries/Utilities/Platform";
  import Button from "#lib/components/Button.svelte";
  import Page from "#lib/components/Page.svelte";
  import Section from "#lib/components/Section.svelte";
  import { useDemo } from "#lib/demo.ts";
  import { text } from "#lib/theme.svelte.ts";

  // The date and time picker of @react-native-community/datetimepicker. iOS has a native view, `DateTimePicker`: it is controlled, `value` is the
  // date it shows and `onValueChange` tells the date the user picked. Android has dialogs instead: `openDatePicker` opens one and answers with the
  // `Date`, or `null` when it is dismissed (`mode: "time"` opens the clock). One screen handles both by checking `Platform.OS`.
  let date = $state(new Date());
  async function pick(mode: "date" | "time") {
    date = (await openDatePicker({ value: date, mode })) ?? date;
  }

  // `?demo`: the picker itself is the platform's (a dialog on Android, a popover on iOS) and needs a finger. What the script can do is set the value the
  // screen holds, so the picked date changes the way it does after a choice. The hold at the end leaves room for the touches that open the
  // picker and choose a date (see features/demos.ts).
  let { url }: { url: URL } = $props();
  let before = new Date();
  useDemo(() => url, [
    [() => { before = date; date = new Date(2026, 11, 24, 9, 30); }, 1400],
    [() => (date = new Date(2027, 2, 8, 18, 15)), 1400],
    [() => (date = before), 0],
  ], { hold: 5000 });
</script>

<Page title="Date and time picker" intro="The platform's own date picker. On iOS it is a view you place on the screen; on Android it is a dialog you open from a button.">
  <Section title={Platform.OS === "ios" ? "DateTimePicker" : "openDatePicker"} note={`Picked: ${date.toLocaleString()}`}>
    {#if Platform.OS === "ios"}
      <DateTimePicker value={date} mode="datetime" display="compact" onValueChange={(_, picked) => { date = picked; }} />
    {:else}
      <Button label="Pick a date" onPress={() => pick("date")} />
      <Button label="Pick a time" variant="secondary" onPress={() => pick("time")} />
    {/if}
    <Text style={text.caption}>The value is a plain Date, so it can be stored or sent as it is.</Text>
  </Section>
</Page>
