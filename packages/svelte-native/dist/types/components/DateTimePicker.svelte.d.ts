import type { ClassProps } from "../classes.js";
import { type DatePickerChange, type DatePickerProps } from "../fabric/foreign-datetime.js";
import type { ViewProps } from "react-native";
type $$ComponentProps = Omit<ViewProps, "children"> & DatePickerProps & {
    onValueChange?: (event: {
        nativeEvent: {
            timestamp: number;
            utcOffset: number;
        };
    }, date: Date) => void;
    onDismiss?: () => void;
    /** @deprecated Use `onValueChange` and `onDismiss`. */
    onChange?: (event: DatePickerChange, date?: Date) => void;
    /** Receives the host handle (`tag`, `measure`, ...), or null on unmount. */
    ref?: (handle: unknown) => void;
} & ClassProps;
declare const DateTimePicker: import("svelte").Component<$$ComponentProps, {}, "">;
type DateTimePicker = ReturnType<typeof DateTimePicker>;
export default DateTimePicker;
