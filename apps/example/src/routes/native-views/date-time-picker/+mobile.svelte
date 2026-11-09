<script lang="ts">
  import { Text } from "@example/svelte-native";
  import { DateTimePicker, openDatePicker } from "@example/svelte-native/foreign";
  import Platform from "react-native/Libraries/Utilities/Platform";
  import Button from "#lib/components/Button.svelte";
  import Page from "#lib/components/Page.svelte";
  import Section from "#lib/components/Section.svelte";
  import { text } from "#lib/theme.svelte.ts";

  // The date and time picker of @react-native-community/datetimepicker. iOS has a native view, `DateTimePicker`: it is controlled, `value` is the
  // date it shows and `onValueChange` tells the date the user picked. Android has dialogs instead: `openDatePicker` opens one and answers with the
  // `Date`, or `null` when it is dismissed (`mode: "time"` opens the clock). One screen handles both by checking `Platform.OS`.
  let date = $state(new Date());
  async function pick(mode: "date" | "time") {
    date = (await openDatePicker({ value: date, mode })) ?? date;
  }
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
