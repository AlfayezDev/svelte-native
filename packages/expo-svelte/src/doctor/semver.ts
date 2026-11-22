/**
 * The part of semver the doctor needs to compare an installed version with a `peerDependencies` range: exact versions, `^`, `~`,
 * comparison operators, `x` ranges, `||` and a space for "and". The package has no dependency to spare for it (an app installs the
 * library, and the doctor must run before anything else works), so it is written out here.
 */
export type Version = { major: number; minor: number; patch: number; prerelease: string[] };

const VERSION = /^v?(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?(?:\+[0-9A-Za-z.-]+)?$/;

export function parseVersion(text: string): Version | undefined {
  const match = VERSION.exec(text.trim());
  if (!match) return undefined;
  return { major: Number(match[1]), minor: Number(match[2]), patch: Number(match[3]), prerelease: match[4] ? match[4].split(".") : [] };
}

function compareIdentifiers(a: string, b: string): number {
  const numericA = /^\d+$/.test(a);
  const numericB = /^\d+$/.test(b);
  if (numericA && numericB) return Math.sign(Number(a) - Number(b));
  if (numericA) return -1;
  if (numericB) return 1;
  return a < b ? -1 : a > b ? 1 : 0;
}

/** Negative, zero or positive: a version with a prerelease sorts before the release, prerelease identifiers compare as semver says. */
export function compareVersions(a: Version, b: Version): number {
  for (const key of ["major", "minor", "patch"] as const) {
    if (a[key] !== b[key]) return Math.sign(a[key] - b[key]);
  }
  if (a.prerelease.length === 0 || b.prerelease.length === 0) return Math.sign(b.prerelease.length - a.prerelease.length);
  for (let index = 0; index < Math.max(a.prerelease.length, b.prerelease.length); index++) {
    const left = a.prerelease[index];
    const right = b.prerelease[index];
    if (left === undefined) return -1;
    if (right === undefined) return 1;
    const order = compareIdentifiers(left, right);
    if (order !== 0) return order;
  }
  return 0;
}

type Comparator = { operator: "<" | "<=" | ">" | ">=" | "="; version: Version };

const PARTIAL = /^v?(\d+|[xX*])(?:\.(\d+|[xX*]))?(?:\.(\d+|[xX*]))?(?:-([0-9A-Za-z.-]+))?(?:\+[0-9A-Za-z.-]+)?$/;

/** The comparators one range token stands for (`^1.2.3` is `>=1.2.3 <2.0.0-0`), or undefined when it is not a range this module reads. */
function comparatorsOf(token: string): Comparator[] | undefined {
  const operator = /^(\^|~|>=|<=|>|<|=)?\s*(.*)$/.exec(token);
  const match = PARTIAL.exec(operator?.[2] ?? "");
  if (!match) return undefined;
  const wildcard = (part: string | undefined) => part === undefined || /^[xX*]$/.test(part);
  const [, major, minor, patch, prerelease] = match;
  const make = (a: number, b: number, c: number, pre = ""): Version => ({ major: a, minor: b, patch: c, prerelease: pre ? pre.split(".") : [] });
  const lowest = make(wildcard(major) ? 0 : Number(major), wildcard(minor) ? 0 : Number(minor), wildcard(patch) ? 0 : Number(patch), prerelease);
  // `1.x`, `1.2` and `*` are ranges of their own: the first version they allow and the first one they do not.
  const lowestOfNext = (): Version | undefined => {
    if (wildcard(major)) return undefined;
    if (wildcard(minor)) return make(Number(major) + 1, 0, 0, "0");
    if (wildcard(patch)) return make(Number(major), Number(minor) + 1, 0, "0");
    return undefined;
  };
  const op = operator?.[1] ?? "";
  const partial = wildcard(major) || wildcard(minor) || wildcard(patch);
  if (op === "^") {
    const upper = lowest.major > 0 || wildcard(minor) ? make(lowest.major + 1, 0, 0, "0") : lowest.minor > 0 || wildcard(patch) ? make(0, lowest.minor + 1, 0, "0") : make(0, 0, lowest.patch + 1, "0");
    return [{ operator: ">=", version: lowest }, { operator: "<", version: upper }];
  }
  if (op === "~") {
    const upper = wildcard(minor) ? make(lowest.major + 1, 0, 0, "0") : make(lowest.major, lowest.minor + 1, 0, "0");
    return [{ operator: ">=", version: lowest }, { operator: "<", version: upper }];
  }
  if (op === "" || op === "=") {
    if (!partial) return [{ operator: "=", version: lowest }];
    const upper = lowestOfNext();
    return upper ? [{ operator: ">=", version: lowest }, { operator: "<", version: upper }] : [];
  }
  if (partial) {
    if (op === ">") return [{ operator: ">=", version: lowestOfNext() ?? lowest }];
    if (op === "<=") return lowestOfNext() ? [{ operator: "<", version: lowestOfNext() as Version }] : [];
  }
  return [{ operator: op as Comparator["operator"], version: lowest }];
}

function holds(version: Version, { operator, version: bound }: Comparator): boolean {
  const order = compareVersions(version, bound);
  return operator === "=" ? order === 0 : operator === ">=" ? order >= 0 : operator === ">" ? order > 0 : operator === "<=" ? order <= 0 : order < 0;
}

/**
 * Whether `version` is in `range`. Undefined when either is not something this module reads (`file:`, `workspace:`, a git URL, a hyphen
 * range): the caller says "could not compare" rather than guess. A prerelease version is in a range only when one of that range's
 * comparators names a prerelease of the same `major.minor.patch`, as semver has it.
 */
export function satisfies(version: string, range: string): boolean | undefined {
  const installed = parseVersion(version);
  if (!installed) return undefined;
  let readable = false;
  for (const alternative of range.split("||")) {
    // `>= 1.2.3` (an operator and its version apart) is one comparator.
    const tokens = alternative.trim().replace(/(\^|~|>=|<=|>|<|=)\s+/g, "$1").split(/\s+/).filter(Boolean);
    const sets = tokens.map(comparatorsOf);
    if (tokens.length === 0 || sets.some((set) => set === undefined)) return undefined;
    readable = true;
    const comparators = sets.flat() as Comparator[];
    const allowsPrerelease = installed.prerelease.length === 0 || comparators.some(({ version: bound }) => bound.prerelease.length > 0 && bound.major === installed.major && bound.minor === installed.minor && bound.patch === installed.patch);
    if (allowsPrerelease && comparators.every((comparator) => holds(installed, comparator))) return true;
  }
  return readable ? false : undefined;
}
