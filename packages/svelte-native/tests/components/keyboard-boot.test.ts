import { expect, test } from "bun:test";
import { load, src } from "../support/bundle.ts";

/**
 * React Native's `Keyboard` learns whether the keyboard is up from listeners it registers when it is first loaded, so a `Keyboard`
 * first loaded on a back press has seen no event and `isVisible()` is false with the keyboard up: the modal closes instead of
 * dismissing the keyboard. It is loaded once, after the first commit (it pulls in UIManager.js, which reads the constants of
 * every view manager: 21 ms of the JavaScript thread on the Galaxy A16, not wanted before the first frame).
 *
 * The modules are bundled with a stand-in `Keyboard` that counts its loads, so each test has its own copy of the boot state (`boot-marks.ts` remembers that the first commit
 * happened) and nothing is mocked for the other files of the run.
 */
type Loaded = {
  keyboard: () => unknown;
  runBootTasks: () => void;
  whenBooted: (task: () => void) => void;
  loads: { count: number };
};

const loadModules = () => load<Loaded>({
  entry: `export { keyboard } from ${JSON.stringify(src("keyboard.ts"))};
    export { runBootTasks, whenBooted } from ${JSON.stringify(src("boot-marks.ts"))};
    export { loads } from "keyboard-test-state";`,
  stubs: {
    "keyboard-test-state": "export const loads = { count: 0 };",
    "react-native/Libraries/Components/Keyboard/Keyboard": `import { loads } from "keyboard-test-state"; loads.count++; export default { isVisible: () => false, dismiss() {} };`,
  },
  converters: false,
});

test("importing the module does not load Keyboard", async () => {
  const { loads } = await loadModules();
  expect(loads.count).toBe(0);
});

test("Keyboard loads once when the first commit is out, not on first use", async () => {
  const { runBootTasks, keyboard, loads } = await loadModules();
  runBootTasks();
  expect(loads.count).toBe(1);
  runBootTasks();
  keyboard();
  keyboard();
  expect(loads.count).toBe(1);
});

test("a task registered after the first commit runs at once", async () => {
  const { runBootTasks, whenBooted } = await loadModules();
  runBootTasks();
  let ran = 0;
  whenBooted(() => { ran++; });
  expect(ran).toBe(1);
});
