import { type FSWatcher, readdirSync, statSync, watch } from "node:fs";
import { dirname, join, resolve, sep } from "node:path";

/**
 * Watches a directory and every directory below it, calling `onChange` (debounced) when anything in them changes.
 *
 * Not `fs.watch(root, { recursive: true })`: on Linux Node builds that from a watch per file, and a file replaced by a rename (`sed -i`,
 * vim, JetBrains' safe write, many formatters) is never reported again, nor is any later change to it (Node 26.8, 11 Nov 2026: one event for the
 * first replacement, none for the next four, none for an append). A watch per directory reports every change of an entry whatever happened to
 * its inode, so this keeps one per directory, adds one for a directory that appears and drops the watch of one that goes.
 *
 * - A directory deleted and made again at once (`rm -rf x && cp -r template x`, or a swap by rename) is another directory under the same name: its old
 *   watch hears nothing more. Its inode number cannot tell (a file system may give the new one the number the old one freed), so a directory that the
 *   watch of its parent names is watched again from scratch: that happens when it is made, removed, renamed or its attributes change, which is seldom.
 * - `skip` names the directories not to watch, by name; give the ones the reader of the tree skips, so a file it reads is never unwatched.
 * - A root that does not exist yet is waited for from the nearest directory above it that does.
 * - A watch the system refuses for another reason than the directory being gone (the inotify limit, a permission) is reported once.
 */
export function watchTree(root: string, onChange: () => void, options: { debounceMs?: number; skip?: (name: string) => boolean } = {}): { close(): void } {
  const base = resolve(root);
  const debounceMs = options.debounceMs ?? 50;
  const skip = options.skip ?? ((name: string) => name === "node_modules" || name.startsWith("."));
  const watchers = new Map<string, FSWatcher>();
  let waiting: FSWatcher | null = null;
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
        if (name) seen(join(directory, name.toString()), name.toString());
        changed();
      });
    } catch (error) {
      refused(directory, error);
      return;
    }
    watcher.unref();
    watcher.on("error", (error) => {
      refused(directory, error);
      dropTree(directory);
    });
    watchers.set(directory, watcher);
  };

  // An entry of a watched directory changed: a directory it names is watched again from scratch (it may be new, gone, or another one under the same name).
  const seen = (path: string, name: string) => {
    if (watchers.has(path)) dropTree(path);
    if (!skip(name) && isDirectory(path)) addTree(path);
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

  // The root is not there yet: wait for it from the nearest directory above that is, and watch it (and report a change) once it appears.
  const waitForRoot = () => {
    let above = dirname(base);
    while (!isDirectory(above) && dirname(above) !== above) above = dirname(above);
    try {
      waiting = watch(above, () => {
        if (!isDirectory(base)) return;
        waiting?.close();
        waiting = null;
        addTree(base);
        changed();
      });
      waiting.unref();
    } catch (error) {
      refused(above, error);
    }
  };

  if (isDirectory(base)) addTree(base);
  else waitForRoot();
  return {
    close() {
      closed = true;
      clearTimeout(timer);
      waiting?.close();
      waiting = null;
      for (const watcher of watchers.values()) watcher.close();
      watchers.clear();
    },
  };
}

let warned = false;
/** A watch that failed for another reason than the directory being gone: said once, with what usually causes it. */
function refused(directory: string, error: unknown): void {
  const code = (error as { code?: string }).code;
  if (code === "ENOENT" || code === "ENOTDIR" || warned) return;
  warned = true;
  const hint = code === "ENOSPC" ? " The system's limit on watches is reached: raise fs.inotify.max_user_watches (sysctl)." : "";
  console.warn(`svelte-native: cannot watch ${directory} (${code ?? String(error)}); changes below it are not picked up until Metro restarts.${hint}`);
}

function isDirectory(path: string): boolean {
  try {
    return statSync(path).isDirectory();
  } catch {
    return false;
  }
}
