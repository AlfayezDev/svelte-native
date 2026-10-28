<script lang="ts">
  import type {} from "../elements.d.ts";
  import { createNativeProps } from "../native-props.ts";
  import { Platform } from "../fabric/deps-rn.ts";
  import { datePickerProps, type DatePickerChange, type DatePickerProps } from "../fabric/foreign-datetime.ts";
  import type { ViewProps } from "react-native";

  /**
   * The iOS date and time picker of `@react-native-community/datetimepicker` (`RNDateTimePicker`) as a controlled component:
   * `value` is the date shown, `onValueChange(event, date)` fires when the user picks one (the component does not change it
   * itself), `onDismiss()` when the picker closes without a pick (compact and inline pickers). `mode` is `date`, `time`,
   * `datetime` or `countdown`, `display` is `default`, `spinner`, `compact` or `inline`. `onChange(event, date)` is the
   * deprecated callback for both (`event.type` is `set` or `dismissed`).
   *
   * Android has no such view: it shows dialogs, opened with `openDatePicker` from the same entry. One pattern for both:
   *
   * ```svelte
   * {#if Platform.OS === "ios"}
   *   <DateTimePicker {value} mode="date" display="compact" onValueChange={(_, date) => (value = date)} />
   * {:else}
   *   <Pressable onPress={async () => { value = (await openDatePicker({ value, mode: "date" })) ?? value; }}><Text>{value.toDateString()}</Text></Pressable>
   * {/if}
   * ```
   */
  let { value, onChange, onValueChange, onDismiss, ...attributes }: Omit<ViewProps, "children"> & DatePickerProps & {
    onValueChange?: (event: { nativeEvent: { timestamp: number; utcOffset: number } }, date: Date) => void;
    onDismiss?: () => void;
    /** @deprecated Use `onValueChange` and `onDismiss`. */
    onChange?: (event: DatePickerChange, date?: Date) => void;
    /** Receives the host handle (`tag`, `measure`, ...), or null on unmount. */
    ref?: (handle: unknown) => void;
  } = $props();
  const resolveProps = createNativeProps();
  type Event = { nativeEvent: { timestamp?: number; utcOffset: number } };
  const changed = (event: Event) => {
    const timestamp = event.nativeEvent.timestamp;
    const date = timestamp !== undefined ? new Date(timestamp) : undefined;
    if (onValueChange && date) onValueChange(event as { nativeEvent: { timestamp: number; utcOffset: number } }, date);
    else onChange?.({ ...event, type: "set" } as DatePickerChange, date);
  };
  const dismissed = () => {
    if (onDismiss) onDismiss();
    else onChange?.({ type: "dismissed", nativeEvent: { timestamp: value.getTime(), utcOffset: 0 } }, value);
  };
  // Android has no native view for the picker (the library's codegen spec excludes it): mounting the name there would find no view manager.
  const ios = Platform.OS === "ios";
  if (!ios) console.warn("DateTimePicker is an iOS component; on Android open the dialog with openDatePicker().");
  const native = $derived(ios ? datePickerProps({ ...attributes, value }, Platform.Version) : {});
</script>
{#if ios}<native-foreign component="RNDateTimePicker" nativeProps={resolveProps({
  ...native, onChange: changed, onPickerDismiss: dismissed,
  // The picker takes its own gestures: it asks to be the responder and does not give the responder up.
  onStartShouldSetResponder: () => true, onResponderTerminationRequest: () => false,
})}></native-foreign>{/if}
