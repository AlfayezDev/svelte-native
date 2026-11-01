import { expect, mock, test } from "bun:test";

/**
 * React Native's `Keyboard` learns whether the keyboard is up from listeners it registers when it is first loaded, so a `Keyboard`
 * first loaded on a back press has seen no event and `isVisible()` is false with the keyboard up: the modal closes instead of
 * dismissing the keyboard. It is loaded once, after the first commit (it pulls in UIManager.js, which reads the constants of
 * every view manager: 21 ms of the JavaScript thread on the Galaxy A16, not wanted before the first frame).
 */
let loads = 0;
mock.module("react-native/Libraries/Components/Keyboard/Keyboard", () => {
  loads++;
  return { default: { isVisible: () => false, dismiss() {} } };
});

const { keyboard } = await import("../src/keyboard.ts");
const { runBootTasks } = await import("../src/boot-marks.ts");

test("importing the module does not load Keyboard", () => {
  expect(loads).toBe(0);
});

test("Keyboard loads once when the first commit is out, not on first use", () => {
  runBootTasks();
  expect(loads).toBe(1);
  runBootTasks();
  keyboard();
  keyboard();
  expect(loads).toBe(1);
});

test("a task registered after the first commit runs at once", async () => {
  const { whenBooted } = await import("../src/boot-marks.ts");
  let ran = 0;
  whenBooted(() => { ran++; });
  expect(ran).toBe(1);
});
