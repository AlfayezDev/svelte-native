/**
 * `hermes-intl` (part of the library: `vendor/hermes-intl`) adds the Intl constructors Hermes lacks (PluralRules, RelativeTimeFormat, ListFormat, Locale) from a
 * native ICU4X module. Its install costs 55–70 ms on a mid-range phone (a synchronous `I18nManager.getConstants` call
 * plus the ICU data), so it waits for the first access to one of those constructors: until then each name is a
 * configurable getter that performs the install and hands back the real constructor.
 */
import { mark } from "./boot-marks.ts";

const NAMES = ["PluralRules", "RelativeTimeFormat", "ListFormat", "Locale"] as const;
type IntlTable = Record<string, unknown>;

let installed = false;
function install(): void {
  if (installed) return;
  installed = true;
  const table = Intl as unknown as IntlTable;
  for (const name of NAMES) if (Object.getOwnPropertyDescriptor(table, name)?.get) delete table[name];
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  require("#vendor/hermes-intl");
  mark("intl");
}

if (typeof Intl === "object" && Intl !== null) {
  const table = Intl as unknown as IntlTable;
  for (const name of NAMES) {
    if (name in table) continue;
    Object.defineProperty(table, name, {
      configurable: true,
      enumerable: false,
      get() {
        install();
        // `hermes-intl` may replace the global `Intl` object; read the constructor from wherever it landed.
        return (globalThis.Intl as unknown as IntlTable)[name];
      },
    });
  }
}
