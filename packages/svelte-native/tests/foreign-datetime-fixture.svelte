<script>
  import DateTimePicker from "../src/components/DateTimePicker.svelte";
  import View from "../src/components/View.svelte";
  let value = $state(new Date(Date.UTC(2026, 9, 28, 12, 0, 0)));
  const log = [];
  let handle = null;
  export function setValue(next) { value = next; }
  export function eventLog() { return log; }
  export function pickerHandle() { return handle; }
</script>
<View>
  <DateTimePicker {value} mode="datetime" display="inline" minimumDate={new Date(Date.UTC(2026, 0, 1))} maximumDate={new Date(Date.UTC(2027, 0, 1))}
    minuteInterval={5} locale="" textColor="#ff0000" accentColor="blue" themeVariant="dark" disabled style={{ height: 300 }} ref={(h) => { handle = h; }}
    onValueChange={(event, date) => log.push(["value", event.nativeEvent.timestamp, date.toISOString()])}
    onDismiss={() => log.push(["dismiss"])} />
  <DateTimePicker {value} onChange={(event, date) => log.push(["change", event.type, date?.toISOString()])} />
</View>
