import { expect, test } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";

/**
 * Modules whose evaluation is paid on the JavaScript thread before the first commit if anything in the entry's static import
 * graph reaches them, and what each costs on the Galaxy A16. They load on first use instead (`require` at the call site).
 */
const lazy: Record<string, string> = {
  // UIManager.js spreads the bridgeless UIManager into a new object, which reads the constants of every view manager:
  // 16 JNI calls, 21 ms of the JavaScript thread. Keyboard imports LayoutAnimation, which imports UIManager.
  "react-native/Libraries/Components/Keyboard/Keyboard": "Keyboard",
  "react-native/Libraries/LayoutAnimation/LayoutAnimation": "LayoutAnimation",
  "react-native/Libraries/ReactNative/UIManager": "UIManager",
};

const src = resolve(import.meta.dirname, "../src");

function files(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    return entry.isDirectory() ? files(path) : /\.(ts|svelte)$/.test(entry.name) ? [path] : [];
  });
}

test("nothing in the package imports Keyboard, LayoutAnimation or UIManager statically", () => {
  const offenders: string[] = [];
  for (const file of files(src)) {
    const text = readFileSync(file, "utf8");
    for (const [module, name] of Object.entries(lazy)) {
      const staticImport = new RegExp(`^\\s*(?:import|export)\\s[^;]*?from\\s+["']${module.replace(/[.*+?^${}()|[\]\\/]/g, "\\$&")}["']`, "m");
      if (staticImport.test(text)) offenders.push(`${file.slice(src.length + 1)} imports ${name}`);
    }
  }
  expect(offenders).toEqual([]);
});
