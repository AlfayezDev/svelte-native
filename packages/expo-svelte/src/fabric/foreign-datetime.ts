/**
 * `@react-native-community/datetimepicker` 9 without React. iOS has a Fabric component (`RNDateTimePicker`: inline, compact,
 * spinner); Android has no view, only dialogs that four TurboModules open (`RNCDatePicker`, `RNCTimePicker` and the
 * Material 3 `RNCMaterialDatePicker`, `RNCMaterialTimePicker`). `openDatePicker` opens the dialog and answers with the chosen
 * date, as `DateTimePickerAndroid.open` does through its callbacks; `datePickerProps` is what the iOS component's native
 * props are made of. Nothing here imports the library.
 */
import { assertLibrary } from "./foreign-libraries.ts";
import { processColorValue } from "./view-configs.ts";

export type PickerMode = "date" | "time";
export type IosPickerMode = "date" | "time" | "datetime" | "countdown";
export type IosDisplay = "default" | "spinner" | "compact" | "inline";
type Button = { label?: string; textColor?: string };

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

type PickerResult = { action: "dateSetAction" | "timeSetAction" | "dismissedAction"; timestamp: number; utcOffset: number };
type PickerModule = { open(options: Record<string, unknown>): Promise<PickerResult>; dismiss(): Promise<boolean> };

const moduleNames = { date: "RNCDatePicker", time: "RNCTimePicker", materialDate: "RNCMaterialDatePicker", materialTime: "RNCMaterialTimePicker" } as const;
function pickerModule(mode: PickerMode, design: "default" | "material" | undefined): PickerModule {
  assertLibrary("@react-native-community/datetimepicker");
  const name = design === "material" ? (mode === "time" ? moduleNames.materialTime : moduleNames.materialDate) : mode === "time" ? moduleNames.time : moduleNames.date;
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  return (require("react-native/Libraries/TurboModule/TurboModuleRegistry") as { getEnforcing<T>(name: string): T }).getEnforcing<PickerModule>(name);
}

const dialogButtons = (options: DatePickerOptions) => {
  const button = (value: Button | undefined) => ({ ...value, textColor: processColorValue(value?.textColor, "android") });
  return { positive: button(options.positiveButton), neutral: button(options.neutralButton), negative: button(options.negativeButton) };
};

/** The parameters the dialog takes: the library's `getOpenPicker` sends each mode only the fields its dialog reads. */
export function pickerParameters(options: DatePickerOptions): Record<string, unknown> {
  const { value, mode = "date", display, minimumDate, maximumDate, is24Hour, minuteInterval, timeZoneName, timeZoneOffsetInMinutes, firstDayOfWeek, testID, title, initialInputMode, fullscreen, startOnYearSelection } = options;
  if (!(value instanceof Date)) throw new Error("`value` must be an instance of Date");
  if (minimumDate && maximumDate && minimumDate > maximumDate) throw new Error(`minimumDate (${minimumDate.toISOString()}) is after maximumDate (${maximumDate.toISOString()})`);
  // 9.2 validates the dialog's options as the iOS component's: the two zone options exclude each other.
  if (timeZoneName != null && timeZoneOffsetInMinutes != null) throw new Error("`timeZoneName` and `timeZoneOffsetInMinutes` cannot be specified at the same time");
  // The native modules know two displays; the others the library accepts ("clock", "calendar") are "default" to them.
  const shown = display === "spinner" ? "spinner" : "default";
  const buttons = dialogButtons(options);
  if (mode === "time") return { value: value.getTime(), display: shown, minuteInterval, is24Hour, timeZoneOffsetInMinutes, timeZoneName, dialogButtons: buttons, title, initialInputMode };
  return {
    value: value.getTime(), display: shown, minimumDate: minimumDate?.getTime(), maximumDate: maximumDate?.getTime(), timeZoneOffsetInMinutes, timeZoneName, dialogButtons: buttons,
    testID, firstDayOfWeek, title, initialInputMode, fullscreen, startOnYearSelection,
  };
}

/**
 * Opens Android's date or time dialog and resolves with the chosen date (the time of day for `mode: "time"`, on the date of `value`),
 * or null when the dialog was dismissed or its neutral button pressed. Android only; iOS has the `DateTimePicker` component.
 * Rejects when the app has no activity to show the dialog on.
 */
export async function openDatePicker(options: DatePickerOptions): Promise<Date | null> {
  const mode = options.mode ?? "date";
  const result = await pickerModule(mode, options.design).open(pickerParameters(options));
  return result.action === "dateSetAction" || result.action === "timeSetAction" ? new Date(result.timestamp) : null;
}

/** Closes the dialog `openDatePicker` opened; resolves with whether there was one. */
export function dismissDatePicker(mode: PickerMode = "date", design?: "default" | "material"): Promise<boolean> {
  return pickerModule(mode, design).dismiss();
}

/** iOS before 14 has only the wheels; `inline` and `compact` arrived with 14. */
export function iosDisplay(display: IosDisplay, version: string | number): IosDisplay {
  return parseInt(String(version), 10) < 14 ? "spinner" : display;
}

export type DatePickerChange = { type: "set" | "dismissed"; nativeEvent: { timestamp: number; utcOffset: number } };
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
export function datePickerProps(props: DatePickerProps, platformVersion: string | number): Record<string, unknown> {
  const { value, mode = "date", display = "default", minimumDate, maximumDate, locale, disabled = false, ...rest } = props;
  if (!(value instanceof Date)) throw new Error("`value` must be an instance of Date");
  if (props.timeZoneName != null && props.timeZoneOffsetInMinutes != null) throw new Error("`timeZoneName` and `timeZoneOffsetInMinutes` cannot be specified at the same time");
  return {
    ...rest,
    date: value.getTime(),
    locale: locale !== null && locale !== "" ? locale : undefined,
    maximumDate: maximumDate?.getTime(),
    minimumDate: minimumDate?.getTime(),
    mode,
    displayIOS: iosDisplay(display, platformVersion),
    enabled: disabled !== true,
  };
}
