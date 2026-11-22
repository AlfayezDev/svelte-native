// What a number field makes of the text typed into it (src/remote/number.ts): the digits and marks of the app's locales (en, ar), strictly.
import { describe, expect, test } from "bun:test";
import { parseLocalizedNumber } from "../../src/remote/number.ts";

describe("parseLocalizedNumber", () => {
  test("empty is nothing, and text that is not a whole number is not a number", () => {
    expect(parseLocalizedNumber("")).toBeUndefined();
    expect(parseLocalizedNumber("   ")).toBeUndefined();
    for (const text of ["12abc", "abc", "-", "+", ".", "1e5", "1.2.3", "1..2", "--1", "1-", "0x10", "Infinity", "NaN", "1,2,3", "1,23,456", "1,000", "1,234", "0,250", "١،٠٠٠", "999,999", "1٫2٫3", "١٢abc", "1 2 3"]) expect([text, parseLocalizedNumber(text)]).toEqual([text, Number.NaN]);
  });
  test("ASCII, with a sign, a point, and a point that is still to be followed by digits", () => {
    const cases: [string, number][] = [["0", 0], ["12", 12], ["-5", -5], ["+3", 3], ["17.", 17], [".5", 0.5], ["-.5", -0.5], ["3.14", 3.14], [" 7 ", 7], ["007", 7]];
    for (const [text, value] of cases) expect([text, parseLocalizedNumber(text)]).toEqual([text, value]);
  });
  test("Arabic-Indic and Extended Arabic-Indic digits, and the Arabic decimal and minus marks", () => {
    const cases: [string, number][] = [["١٢", 12], ["٠", 0], ["١٢٫٥", 12.5], ["٣٫١٤", 3.14], ["۱۲۳", 123], ["۴۵٫۶", 45.6], ["−5", -5], ["‎-٥", -5], ["٫٥", 0.5], ["١٢٫", 12], ["1٫5", 1.5]];
    for (const [text, value] of cases) expect([text, parseLocalizedNumber(text)]).toEqual([text, value]);
  });
  test("a lone comma is a decimal mark; commas that group (more than one, or with a point) are dropped, as are Arabic and space separators", () => {
    const cases: [string, number][] = [["1,5", 1.5], ["0,25", 0.25], ["12,3456", 12.3456], ["1234,567", 1234.567], ["1,50", 1.5], ["١٫٥", 1.5], ["١٫٠٠٠", 1], ["1٫000", 1], ["١،٥", 1.5], ["1,234,567", 1234567], ["1,234.5", 1234.5], ["1٬234", 1234], ["١٬٢٣٤٫٥", 1234.5], ["1 234", 1234], ["1 234,5", 1234.5]];
    for (const [text, value] of cases) expect([text, parseLocalizedNumber(text)]).toEqual([text, value]);
  });
});
