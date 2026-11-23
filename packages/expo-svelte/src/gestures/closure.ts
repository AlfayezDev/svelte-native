/**
 * What a worklet captures, by the name it has in the function. Worklets 0.13's plugin writes `__closure` as an array of the values, in the order of the `const [a, b] = this.__closure`
 * the function starts with; the names are there, in the source of the worklet (`__initData.code`, which a development build has), and nowhere else. An older plugin wrote an object.
 */
export function closureEntries(callback: { __closure?: unknown; __initData?: { code?: string } }): [string, unknown][] {
  const closure = callback.__closure;
  if (Array.isArray(closure)) {
    const names = /const\s*\[([^\]]*)\]\s*=\s*this\.__closure/.exec(callback.__initData?.code ?? "")?.[1]?.split(",").map((name) => name.trim()) ?? [];
    return closure.map((value, index) => [names[index] || `#${index}`, value]);
  }
  return typeof closure === "object" && closure !== null ? Object.entries(closure) : [];
}
