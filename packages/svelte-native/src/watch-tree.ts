import { existsSync, type FSWatcher, readdirSync, statSync, watch } from "node:fs";
import { join, resolve, sep } from "node:path";

/**
 * Watches a directory and every directory below it, calling `onChange` (debounced) when anything in them changes.
 *
 * Not `fs.watch(root, { recursive: true })`: on Linux Node builds that from a watch per file, and a file replaced by a rename (`sed -i`,
 * vim, JetBrains' safe write, many formatters) is never reported again, nor is any later change to it (Node 26.8, 11 Nov 2026: one event for the
 * first replacement, none for the next four, none for an append). A watch per directory reports every change of an entry whatever happened to
 * its inode, so this keeps one per directory, adds one for a directory that appears and drops the watch of one that goes.
 */
export function watchTree(root: string, onChange: () => void, options: { debounceMs?: number; skip?: (name: string) => boolean } = {}): { close(): void } {
  const base = resolve(root);
  const debounceMs = options.debounceMs ?? 50;
  const skip = options.skip ?? ((name: string) => name === "node_modules" || name.startsWith("."));
  const watchers = new Map<string, FSWatcher>();
  let timer: ReturnType<typeof setTimeout> | undefined;
  let closed = false;

  const changed = () => {
    if (closed) return;
    clearTimeout(timer);
    timer = setTimeout(onChange, debounceMs);
    timer.unref?.();
  };

  const add = (directory: string) => {
    if (closed || watchers.has(directory)) return;
    let watcher: FSWatcher;
    try {
      watcher = watch(directory, (_event, name) => {
        // A new directory is watched as soon as it is seen; one that went is dropped with everything below it.
        if (name) {
          const path = join(directory, name.toString());
          if (!watchers.has(path) && isDirectory(path) && !skip(name.toString())) addTree(path);
          if (watchers.has(path) && !existsSync(path)) dropTree(path);
        }
        changed();
      });
    } catch {
      return; // gone between the listing and the watch
    }
    watcher.unref();
    watcher.on("error", () => dropTree(directory));
    watchers.set(directory, watcher);
  };

  const addTree = (directory: string) => {
    add(directory);
    let entries: { name: string; isDirectory(): boolean }[];
    try {
      entries = readdirSync(directory, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) if (entry.isDirectory() && !skip(entry.name)) addTree(join(directory, entry.name));
  };

  const dropTree = (directory: string) => {
    for (const [path, watcher] of watchers) {
      if (path === directory || path.startsWith(directory + sep)) {
        watcher.close();
        watchers.delete(path);
      }
    }
  };

  if (isDirectory(base)) addTree(base);
  return {
    close() {
      closed = true;
      clearTimeout(timer);
      for (const watcher of watchers.values()) watcher.close();
      watchers.clear();
    },
  };
}

function isDirectory(path: string): boolean {
  try {
    return statSync(path).isDirectory();
  } catch {
    return false;
  }
}
