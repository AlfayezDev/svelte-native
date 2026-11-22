export type PickerMode = "date" | "time";
export type IosPickerMode = "date" | "time" | "datetime" | "countdown";
export type IosDisplay = "default" | "spinner" | "compact" | "inline";
type Button = {
    label?: string;
    textColor?: string;
};
export type DatePickerOptions = {
    /** The date or time the dialog starts on. */
    value: Date;
    /** `date` (default) or `time`. */
    mode?: PickerMode;
    minimumDate?: Date;
    maximumDate?: Date;
    /** Time only: 24-hour clock or AM/PM (the locale's choice when not set). */
    is24Hour?: boolean;
    /** Time only: 1, 5, 10, 15, 20 or 30. */
    minuteInterval?: number;
    /** `spinner` or the platform's default. */
    display?: "default" | "spinner";
    timeZoneName?: string;
    timeZoneOffsetInMinutes?: number;
    firstDayOfWeek?: number;
    testID?: string;
    positiveButton?: Button;
    negativeButton?: Button;
    neutralButton?: Button;
    /** `material` opens the Material 3 dialogs (`title`, `initialInputMode`, `fullscreen` apply to those only). */
    design?: "default" | "material";
    title?: string;
    initialInputMode?: "keyboard" | "default";
    fullscreen?: boolean;
    startOnYearSelection?: boolean;
};
/** The parameters the dialog takes: the library's `getOpenPicker` sends each mode only the fields its dialog reads. */
export declare function pickerParameters(options: DatePickerOptions): Record<string, unknown>;
/**
 * Opens Android's date or time dialog and resolves with the chosen date (the time of day for `mode: "time"`, on the date of `value`),
 * or null when the dialog was dismissed or its neutral button pressed. Android only; iOS has the `DateTimePicker` component.
 * Rejects when the app has no activity to show the dialog on.
 */
export declare function openDatePicker(options: DatePickerOptions): Promise<Date | null>;
/** Closes the dialog `openDatePicker` opened; resolves with whether there was one. */
export declare function dismissDatePicker(mode?: PickerMode, design?: "default" | "material"): Promise<boolean>;
/** iOS before 14 has only the wheels; `inline` and `compact` arrived with 14. */
export declare function iosDisplay(display: IosDisplay, version: string | number): IosDisplay;
export type DatePickerChange = {
    type: "set" | "dismissed";
    nativeEvent: {
        timestamp: number;
        utcOffset: number;
    };
};
export type DatePickerProps = {
    value: Date;
    mode?: IosPickerMode;
    display?: IosDisplay;
    minimumDate?: Date;
    maximumDate?: Date;
    minuteInterval?: number;
    locale?: string | null;
    timeZoneName?: string;
    timeZoneOffsetInMinutes?: number;
    textColor?: string;
    accentColor?: string;
    themeVariant?: "dark" | "light" | "unspecified";
    disabled?: boolean;
    [prop: string]: unknown;
};
/**
 * The native props of the iOS picker for the component's: dates as milliseconds, `display` as `displayIOS` (limited by the iOS
 * version), `disabled` as `enabled`, an empty locale left out. The change handlers are the component's (they depend on its callbacks).
 */
export declare function datePickerProps(props: DatePickerProps, platformVersion: string | number): Record<string, unknown>;
export {};
