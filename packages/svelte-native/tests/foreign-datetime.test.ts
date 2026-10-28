import { expect, test } from "bun:test";
import { createHarness, find, settle } from "./foreign-harness.ts";

/**
 * @react-native-community/datetimepicker (SPEC.md, "Foreign views"): iOS mounts the Fabric component `RNDateTimePicker` with
 * the props the library's iOS wrapper builds; Android has no view, so `openDatePicker` opens the dialog through the library's
 * TurboModules and answers with the chosen date.
 */
type App = { setValue(value: Date): void; eventLog(): unknown[][]; pickerHandle(): { tag: number } | null };
const noon = Date.UTC(2026, 9, 28, 12, 0, 0);

test("iOS: the component mounts RNDateTimePicker with dates as milliseconds, colours as integers and the library's own renames", async () => {
  const harness = createHarness("ios");
  const loaded = await harness.load("foreign-datetime-fixture.svelte");
  const app = loaded.startSurface(71, loaded.Fixture, {}) as App;
  const [picker, other] = find(harness.roots()[71], "RNDateTimePicker");
  expect(harness.calls.indexOf("engine.registerForeign RNDateTimePicker")).toBeGreaterThanOrEqual(0);
  expect(harness.calls.indexOf("engine.registerForeign RNDateTimePicker")).toBeLessThan(harness.calls.indexOf("create RNDateTimePicker"));
  expect(picker.props).toMatchObject({
    date: noon, mode: "datetime", displayIOS: "inline", minimumDate: Date.UTC(2026, 0, 1), maximumDate: Date.UTC(2027, 0, 1), minuteInterval: 5,
    themeVariant: "dark", enabled: false, height: 300, textColor: 0xffff0000, accentColor: 0xff0000ff,
  });
  // An empty locale is left out; the component's own names (`value`, `display`, `disabled`) are not the view's.
  for (const key of ["locale", "value", "display", "disabled", "onValueChange", "onDismiss", "ref", "nativeProps", "component"]) expect(key in picker.props, key).toBe(false);
  expect(other.props).toMatchObject({ date: noon, mode: "date", displayIOS: "default", enabled: true });
  expect(typeof app.pickerHandle()?.tag).toBe("number");

  // A pick reaches `onValueChange` with the date (the picker is controlled: the value changes only when the app sets it).
  harness.emit(picker.target, "topChange", { timestamp: noon + 3_600_000, utcOffset: 0 });
  harness.emit(picker.target, "topPickerDismiss", {});
  // Without `onValueChange`, `onChange` hears the same pick as a "set" and the dismissal as "dismissed" with the current value.
  harness.emit(other.target, "topChange", { timestamp: noon + 60_000, utcOffset: 0 });
  harness.emit(other.target, "topPickerDismiss", {});
  expect(app.eventLog()).toEqual([
    ["value", noon + 3_600_000, new Date(noon + 3_600_000).toISOString()], ["dismiss"],
    ["change", "set", new Date(noon + 60_000).toISOString()], ["change", "dismissed", new Date(noon).toISOString()],
  ]);
  expect(loaded.configs.viewConfigFor("RNDateTimePicker", "ios").events.get("topPickerDismiss")).toBe("onPickerDismiss");

  harness.calls.length = 0;
  app.setValue(new Date(noon + 86_400_000));
  await settle(loaded);
  expect(harness.calls.filter((call) => call.startsWith("create"))).toEqual([]);
  expect(find(harness.roots()[71], "RNDateTimePicker")[0].props.date).toBe(noon + 86_400_000);
});

test("Android: the component mounts nothing (the dialogs are opened with openDatePicker)", async () => {
  const warn = console.warn;
  console.warn = () => {};
  try {
    const harness = createHarness("android");
    const loaded = await harness.load("foreign-datetime-fixture.svelte");
    loaded.startSurface(72, loaded.Fixture, {});
    expect(find(harness.roots()[72], "RNDateTimePicker")).toEqual([]);
    expect(harness.calls.filter((call) => call.startsWith("engine.registerForeign"))).toEqual([]);
  } finally {
    console.warn = warn;
  }
});

test("openDatePicker opens the library's dialog for the mode and answers with the date, or null when dismissed", async () => {
  const opened: [string, Record<string, unknown>][] = [];
  const answer = { action: "dateSetAction", timestamp: noon + 1000, utcOffset: 120 };
  const dialog = (name: string) => ({
    open: async (params: Record<string, unknown>) => { opened.push([name, params]); return name.includes("Time") ? { ...answer, action: "timeSetAction" } : answer; },
    dismiss: async () => { opened.push([`${name}.dismiss`, {}]); return true; },
  });
  const harness = createHarness("android", { natives: { turbo: { RNCDatePicker: dialog("RNCDatePicker"), RNCTimePicker: dialog("RNCTimePicker"), RNCMaterialDatePicker: dialog("RNCMaterialDatePicker"), RNCMaterialTimePicker: dialog("RNCMaterialTimePicker") } } });
  const { datetime } = await harness.load("foreign-datetime-fixture.svelte");
  const value = new Date(noon);
  const minimumDate = new Date(noon - 86_400_000);
  const maximumDate = new Date(noon + 86_400_000);

  const picked = await datetime.openDatePicker({ value, mode: "date", minimumDate, maximumDate, firstDayOfWeek: 1, positiveButton: { label: "Pick", textColor: "#00ff00" } });
  expect(picked?.getTime()).toBe(noon + 1000);
  // Dates go as milliseconds; a time dialog does not get the date range, a date dialog does not get the time options; button colours are integers.
  expect(opened[0]).toEqual(["RNCDatePicker", {
    value: noon, display: "default", minimumDate: noon - 86_400_000, maximumDate: noon + 86_400_000, timeZoneOffsetInMinutes: undefined, timeZoneName: undefined,
    dialogButtons: { positive: { label: "Pick", textColor: -16711936 }, neutral: { textColor: undefined }, negative: { textColor: undefined } },
    testID: undefined, firstDayOfWeek: 1, title: undefined, initialInputMode: undefined, fullscreen: undefined, startOnYearSelection: undefined,
  }]);
  const time = await datetime.openDatePicker({ value, mode: "time", is24Hour: true, minuteInterval: 15, display: "spinner" });
  expect(time?.getTime()).toBe(noon + 1000);
  expect(opened[1][0]).toBe("RNCTimePicker");
  expect(opened[1][1]).toMatchObject({ value: noon, display: "spinner", is24Hour: true, minuteInterval: 15 });
  expect("minimumDate" in opened[1][1]).toBe(false);
  await datetime.openDatePicker({ value, design: "material", title: "Choose" });
  await datetime.openDatePicker({ value, mode: "time", design: "material" });
  expect(opened.slice(2).map(([name]) => name)).toEqual(["RNCMaterialDatePicker", "RNCMaterialTimePicker"]);
  expect(opened[2][1]).toMatchObject({ title: "Choose" });
  expect(await datetime.dismissDatePicker("time")).toBe(true);
  expect(opened.at(-1)?.[0]).toBe("RNCTimePicker.dismiss");

  // A dismissed or neutral answer is null.
  harness.natives.turbo.RNCDatePicker = { open: async () => ({ action: "dismissedAction", timestamp: 0, utcOffset: 0 }), dismiss: async () => false };
  expect(await datetime.openDatePicker({ value })).toBeNull();
  // Invalid options reject before the dialog is asked.
  await expect(datetime.openDatePicker({ value: "2026" as never })).rejects.toThrow("`value` must be an instance of Date");
  await expect(datetime.openDatePicker({ value, minimumDate: maximumDate, maximumDate: minimumDate })).rejects.toThrow("is after maximumDate");
});

test("the iOS display falls back to the wheels before iOS 14, and the zone options exclude each other", async () => {
  const harness = createHarness("ios");
  const { datetime } = await harness.load("foreign-datetime-fixture.svelte");
  expect(datetime.iosDisplay("inline", "13.4")).toBe("spinner");
  expect(datetime.iosDisplay("compact", 13)).toBe("spinner");
  expect(datetime.iosDisplay("inline", "17.0")).toBe("inline");
  const value = new Date(noon);
  expect(() => datetime.datePickerProps({ value, timeZoneName: "UTC", timeZoneOffsetInMinutes: 60 }, 17)).toThrow("cannot be specified at the same time");
  expect(datetime.datePickerProps({ value, locale: null }, 17).locale).toBeUndefined();
  expect(datetime.datePickerProps({ value, locale: "ar" }, 17).locale).toBe("ar");
});
