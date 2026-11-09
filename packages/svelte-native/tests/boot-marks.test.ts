import { test, expect } from "bun:test";
import { bootSummary, mark, resetMarks } from "../src/boot-marks.ts";

test("boot summary lists each phase from the previous mark and the total", () => {
  resetMarks();
  mark("init");
  mark("host");
  const summary = bootSummary();
  expect(summary).toMatch(/^init \d+ · host \d+ · total \d+ ms$/);
});

test("reset starts a fresh list", () => {
  mark("stale");
  resetMarks();
  expect(bootSummary()).toMatch(/^total \d+ ms$/);
});
