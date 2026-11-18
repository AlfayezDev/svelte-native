/**
 * `node scripts/vendor.ts <name>@<version> [--license-url <url>] [--exclude <path>]...` copies the published npm tarball of a third-party native dependency into
 * `vendor/<name>/` of the package (VENDORING.md): the contents of `npm pack <name>@<version>`, unpacked as they are, plus the package's `LICENSE` and a `VENDOR.md`
 * that says where it came from (the tarball's integrity and sha256, what was left out, every local change). The directory is replaced as a whole, so running it again
 * with the same arguments writes the same bytes: nothing in it depends on the date, the machine or the order of the files.
 *
 * A package whose tarball has no license file (npm leaves out what `files` does not name, and a `LICENSE` that is not in a package's `files` of the repository root's is
 * not packed) gets the repository's, fetched from `raw.githubusercontent.com` at the tarball's own `gitHead`, or from `--license-url`; its source and sha256 are in `VENDOR.md`.
 *
 * Local changes are patch files, `vendor-patches/<name>/*.patch` (`patch -p1` format, applied in file name order after the unpack, so an upgrade replays them and a
 * conflict is found when it is made; a patch that does not apply stops the script and leaves the earlier copy as it was). Nothing is edited by hand in `vendor/`.
 */
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { cpSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";

export const packageRoot = resolve(import.meta.dirname, "..");
export const vendorDirectory = join(packageRoot, "vendor");
export const patchesDirectory = join(packageRoot, "vendor-patches");

/** `name@version` as `npm pack` takes it: a scoped name keeps its leading `@`, and the version is exact. */
export function parseSpec(spec: string): { name: string; version: string } {
  const at = spec.lastIndexOf("@");
  const name = spec.slice(0, at);
  const version = spec.slice(at + 1);
  if (at <= 0 || !/^(?:@[a-z0-9][\w.-]*\/)?[a-z0-9][\w.-]*$/.test(name) || !/^\d+\.\d+\.\d+(?:-[\w.]+)?$/.test(version)) {
    throw new Error(`"${spec}" is not <name>@<exact version> (a range or a tag does not say which tarball was copied)`);
  }
  return { name, version };
}

export type Vendored = {
  /** The package's directory, `vendor/<name>`. */
  directory: string;
  /** npm's `sha512-…` integrity of the tarball, and its sha256 and size. */
  integrity: string;
  sha256: string;
  bytes: number;
  /** The files the tarball holds (before the exclusions, the patches and the license that is not its own). */
  files: number;
  license: { file: string; source: string; sha256: string };
  excluded: string[];
  patches: { file: string; sha256: string }[];
};

export type VendorOptions = {
  /** The `.tgz` `npm pack` wrote. */
  tarball: string;
  name: string;
  version: string;
  /** The package's directory under `vendor/` is `<into>/<name>`. Default `vendor/`. */
  into?: string;
  /** Paths of the package (relative to its root) the copy leaves out. */
  exclude?: readonly string[];
  /** Patch files applied after the unpack (`patch -p1`), in the order given: absolute, or relative to the package's root (what `VENDOR.md` records, so it names no machine). */
  patches?: readonly string[];
  /** The `--license-url` the command line gave, which `VENDOR.md` repeats in the command that reproduces the copy. */
  licenseUrl?: string;
  /** The license text, for a tarball that has none; the second is where it came from (a URL), for `VENDOR.md`. */
  license?: { text: string; source: string };
};

const sha256Of = (data: Buffer | string): string => createHash("sha256").update(data).digest("hex");
const integrityOf = (data: Buffer): string => `sha512-${createHash("sha512").update(data).digest("base64")}`;

// The paths an `--exclude` names. A plain path is one file or a directory. A path with `*` is a pattern over the package's files: `*` is any characters but a slash, and a directory part
// written `**` followed by a slash is any number of directories (including none), so a pattern that ends in `lib`, `**`, slash and `*.map` is every source map under `lib/`. A pattern that
// matches no file is refused, as a path that is not there is.
export function excludedBy(pattern: string, files: readonly string[]): string[] {
  if (!pattern.includes("*")) return [pattern];
  const escaped = (text: string): string => text.replace(/[.+?^${}()|[\]\\]/g, "\\$&");
  const source = pattern.split("**/").map((part) => part.split("*").map(escaped).join("[^/]*")).join("(?:.*/)?");
  const matcher = new RegExp(`^${source}$`);
  return files.filter((file) => matcher.test(file));
}

/** Every file under `directory` (relative, forward slashes, sorted). */
export function filesUnder(directory: string): string[] {
  return readdirSync(directory, { recursive: true, withFileTypes: true })
    .filter((entry) => entry.isFile())
    .map((entry) => relative(directory, join(entry.parentPath, entry.name)).split(sep).join("/"))
    .sort();
}

/** The license file at a package's root, however it is spelled. */
const licenseFile = (files: readonly string[]): string | undefined => files.find((file) => /^(?:license|licence)(?:\.(?:md|txt))?$/i.test(file));

/**
 * Unpacks `options.tarball` into `<into>/<name>`, replacing what is there: the tarball's files, the license, the exclusions, the patches, and `VENDOR.md`.
 * The unpack goes through a scratch directory of its own, so a failure leaves the previous copy where it was.
 */
export function vendorTarball(options: VendorOptions): Vendored {
  const { tarball, name, version } = options;
  const target = join(options.into ?? vendorDirectory, name);
  const data = readFileSync(tarball);
  const scratch = mkdtempSync(join(tmpdir(), "svelte-native-vendor-"));
  try {
    const unpacked = join(scratch, "package");
    mkdirSync(unpacked);
    // npm's tarballs hold one directory, `package/`, whatever the package is called.
    execFileSync("tar", ["-xzf", tarball, "-C", unpacked, "--strip-components=1"], { stdio: ["ignore", "ignore", "inherit"] });
    const manifest = JSON.parse(readFileSync(join(unpacked, "package.json"), "utf8")) as { name?: string; version?: string; repository?: string | { url?: string } };
    if (manifest.name !== name || manifest.version !== version) throw new Error(`${tarball} is ${manifest.name}@${manifest.version}, not ${name}@${version}`);

    const inTarball = filesUnder(unpacked).length;
    const excluded: string[] = [];
    for (const path of options.exclude ?? []) {
      if (path.startsWith("/") || path.split("/").includes("..")) throw new Error(`--exclude ${path}: a path inside the package`);
      const found = excludedBy(path, filesUnder(unpacked));
      if (found.length === 0 || found.some((file) => !existsSync(join(unpacked, file)))) throw new Error(`--exclude ${path}: the tarball has no such path`);
      for (const file of found) rmSync(join(unpacked, file), { recursive: true });
      excluded.push(path);
    }

    const patches: Vendored["patches"] = [];
    for (const patch of options.patches ?? []) {
      const file = resolve(packageRoot, patch);
      execFileSync("patch", ["-p1", "--forward", "--no-backup-if-mismatch", "-d", unpacked, "-i", file], { stdio: ["ignore", "ignore", "inherit"] });
      // The notes name a patch by its place in the package (`vendor-patches/<name>/<file>`), not by the directory of this machine.
      const inPackage = relative(packageRoot, file);
      patches.push({ file: inPackage.startsWith("..") || isAbsolute(inPackage) ? patch : inPackage.split(sep).join("/"), sha256: sha256Of(readFileSync(file)) });
    }

    const own = licenseFile(readdirSync(unpacked));
    let license: Vendored["license"];
    if (own !== undefined) license = { file: own, source: "the tarball", sha256: sha256Of(readFileSync(join(unpacked, own))) };
    else if (options.license) {
      writeFileSync(join(unpacked, "LICENSE"), options.license.text);
      license = { file: "LICENSE", source: options.license.source, sha256: sha256Of(options.license.text) };
    } else throw new Error(`${name}@${version} has no license file in its tarball: pass --license-url <the repository's LICENSE>`);

    const result: Vendored = { directory: target, integrity: integrityOf(data), sha256: sha256Of(data), bytes: statSync(tarball).size, files: inTarball, license, excluded, patches };
    writeFileSync(join(unpacked, "VENDOR.md"), vendorNotes({ name, version, repository: repositoryUrl(manifest.repository), command: commandFor(name, version, excluded, options.licenseUrl) }, result));

    rmSync(target, { recursive: true, force: true });
    mkdirSync(dirname(target), { recursive: true });
    // A rename across file systems fails (the scratch directory is in the temp folder), so it is a copy.
    cpSync(unpacked, target, { recursive: true });
    return result;
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }
}

/** A manifest's `repository` as a browsable URL (`git+https://github.com/a/b.git` is `https://github.com/a/b`). */
export function repositoryUrl(repository: string | { url?: string } | undefined): string | undefined {
  const url = typeof repository === "string" ? repository : repository?.url;
  return url?.replace(/^git\+/, "").replace(/\.git$/, "").replace(/^git@github\.com:/, "https://github.com/");
}

/** The command line that writes a copy again, with the options that shaped it. */
export function commandFor(name: string, version: string, excluded: readonly string[], licenseUrl?: string): string {
  // A pattern is quoted: the shell would expand its `*` before the script saw it.
  return ["node scripts/vendor.ts", `${name}@${version}`, ...(licenseUrl ? ["--license-url", licenseUrl] : []), ...excluded.flatMap((path) => ["--exclude", path.includes("*") ? `'${path}'` : path])].join(" ");
}

/** The text of `VENDOR.md`: upstream, the tarball, what is not in the copy, the license, every local change. No date: the same copy is the same bytes. */
export function vendorNotes(upstream: { name: string; version: string; repository?: string; command: string }, result: Omit<Vendored, "directory">): string {
  const lines = [
    `# ${upstream.name} ${upstream.version} (vendored)`,
    "",
    `Third-party code, copied into this package (VENDORING.md). Nothing here is edited by hand: \`${upstream.command}\` (in packages/svelte-native) writes this directory again, byte for byte.`,
    "",
    `- Upstream: \`${upstream.name}\` ${upstream.version} on npm${upstream.repository ? `, repository ${upstream.repository}` : ""}`,
    `- Tarball: \`npm pack ${upstream.name}@${upstream.version}\`, ${result.bytes} bytes, ${result.files} files`,
    `- Integrity (npm's \`dist.integrity\`): \`${result.integrity}\``,
    `- sha256: \`${result.sha256}\``,
    `- License: \`${result.license.file}\` from ${result.license.source}, sha256 \`${result.license.sha256}\``,
    "",
    "## Left out",
    "",
    ...(result.excluded.length === 0 ? ["Nothing: the files here are the tarball's."] : result.excluded.map((path) => `- \`${path}\``)),
    "",
    "## Local changes",
    "",
    ...(result.patches.length === 0 ? ["None."] : result.patches.map((patch) => `- \`${patch.file}\` (sha256 \`${patch.sha256}\`), applied with \`patch -p1\` after the unpack`)),
    "",
  ];
  return lines.join("\n");
}

/** `npm pack <name>@<version>` into `directory`; the tarball's path, and the integrity npm printed for it (what the registry says it is). */
export function packFromRegistry(name: string, version: string, directory: string): { tarball: string; integrity: string } {
  const out = execFileSync("npm", ["pack", `${name}@${version}`, "--pack-destination", directory, "--json", "--silent"], { encoding: "utf8", stdio: ["ignore", "pipe", "inherit"] });
  const [packed] = JSON.parse(out) as { filename: string; integrity: string }[];
  if (!packed) throw new Error(`npm pack ${name}@${version} printed nothing`);
  return { tarball: join(directory, packed.filename), integrity: packed.integrity };
}

/** The repository's license for a package whose tarball has none: its `LICENSE` at the commit npm records for the version (`gitHead`). */
export async function repositoryLicense(name: string, version: string): Promise<{ text: string; source: string }> {
  const info = JSON.parse(execFileSync("npm", ["view", `${name}@${version}`, "gitHead", "repository.url", "--json"], { encoding: "utf8", stdio: ["ignore", "pipe", "inherit"] })) as { gitHead?: string; "repository.url"?: string };
  const match = /github\.com[/:]([^/]+\/[^/.]+?)(?:\.git)?$/.exec(info["repository.url"] ?? "");
  if (!match || !info.gitHead) throw new Error(`${name}@${version} has no GitHub repository and gitHead in the registry: pass --license-url`);
  const source = `https://raw.githubusercontent.com/${match[1]}/${info.gitHead}/LICENSE`;
  return { text: await fetchText(source), source };
}

async function fetchText(url: string): Promise<string> {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`${url}: ${response.status}`);
  return response.text();
}

if (import.meta.main) {
  const args = process.argv.slice(2);
  const take = (flag: string): string[] => args.flatMap((arg, index) => (arg === flag ? [args[index + 1] ?? ""] : []));
  const spec = args.find((arg, index) => !arg.startsWith("--") && !(args[index - 1] ?? "").startsWith("--"));
  if (spec === undefined) {
    console.error("Usage: node scripts/vendor.ts <name>@<version> [--license-url <url>] [--exclude <path>]...");
    process.exit(2);
  }
  const { name, version } = parseSpec(spec);
  const scratch = mkdtempSync(join(tmpdir(), "svelte-native-vendor-pack-"));
  try {
    const { tarball, integrity } = packFromRegistry(name, version, scratch);
    const licenseUrl = take("--license-url")[0];
    // The registry's tarball may hold a license of its own; the fetch is for the one that does not.
    const holdsLicense = execFileSync("tar", ["-tzf", tarball], { encoding: "utf8" }).split("\n").some((entry) => /^package\/(?:license|licence)(?:\.(?:md|txt))?$/i.test(entry));
    const license = holdsLicense ? undefined : licenseUrl ? { text: await fetchText(licenseUrl), source: licenseUrl } : await repositoryLicense(name, version);
    const patchDirectory = join(patchesDirectory, name);
    // Named from the package's root, as `VENDOR.md` records them: the same copy is the same bytes on every machine.
    const patches = existsSync(patchDirectory) ? readdirSync(patchDirectory).filter((file) => file.endsWith(".patch")).sort().map((file) => `vendor-patches/${name}/${file}`) : [];
    const vendored = vendorTarball({ tarball, name, version, exclude: take("--exclude"), patches, license, licenseUrl });
    if (vendored.integrity !== integrity) throw new Error(`the tarball's integrity ${vendored.integrity} is not the one npm reported, ${integrity}`);
    console.log(`vendor/${name}  ${vendored.files} files from ${name}@${version} (${vendored.integrity})`);
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }
}
