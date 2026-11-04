/**
 * What a number field makes of the text typed into it. A browser's `<input type="number">` holds a number or nothing; a native `TextInput` holds
 * any text, in the digits of the keyboard's language, so the text is read strictly and in full: `"12abc"` is not 12.
 *
 * Read: Western, Arabic-Indic (U+0660-0669) and Extended Arabic-Indic (U+06F0-06F9) digits; the decimal marks `.` and U+066B; the minus signs `-` and U+2212 and
 * a leading `+`; bidirectional marks (an Arabic keyboard puts them around numbers) are ignored.
 *
 * The comma rule, for the app's locales (en, ar): `en` keyboards have a point on their decimal pad and `ar` ones a U+066B or a comma, and a comma is also
 * a thousands mark, so a comma (or the Arabic comma U+060C) that is the only mark of the number is a decimal mark (`"1,5"` is 1.5, `"1,234"` is 1.234) and
 * commas that group are dropped: more than one comma (`"1,234,567"`), or a comma and a point (`"1,234.5"`). Spaces (also no-break and narrow no-break) and
 * U+066C between groups of three digits are thousands marks.
 */

const BIDI = /[\u200e\u200f\u061c\u202a-\u202e\u2066-\u2069]/g;
const POINT = /[.\u066b]/g;
const COMMA = /[,\u060c]/g;
const GROUPED = /^\d{1,3}(?:[ \u00a0\u202f\u066c,\u060c]\d{3})+$/;

/** The number the text says, `undefined` when it is empty and `NaN` when it is anything but a number. */
export function parseLocalizedNumber(text: string): number | undefined {
  let rest = text.replace(BIDI, "").trim();
  if (rest === "") return undefined;
  rest = rest.replace(/[\u0660-\u0669]/g, (digit) => String(digit.charCodeAt(0) - 0x660)).replace(/[\u06f0-\u06f9]/g, (digit) => String(digit.charCodeAt(0) - 0x6f0)).replace(/\u2212/g, "-");
  let sign = 1;
  if (rest[0] === "-" || rest[0] === "+") {
    sign = rest[0] === "-" ? -1 : 1;
    rest = rest.slice(1);
  }
  const points = rest.match(POINT)?.length ?? 0;
  const commas = rest.match(COMMA)?.length ?? 0;
  let whole = rest;
  let fraction = "";
  if (points > 1) return Number.NaN;
  if (points === 1) {
    [whole, fraction] = rest.split(POINT);
  } else if (commas === 1 && !/[ \u00a0\u202f\u066c]/.test(rest.slice(rest.search(COMMA)))) {
    [whole, fraction] = rest.split(COMMA);
  }
  if (!/^\d*$/.test(fraction)) return Number.NaN;
  if (!/^\d*$/.test(whole) && !GROUPED.test(whole)) return Number.NaN;
  const digits = whole.replace(/\D/g, "");
  if (digits === "" && fraction === "") return Number.NaN;
  return sign * Number(`${digits === "" ? "0" : digits}${fraction === "" ? "" : `.${fraction}`}`);
}
