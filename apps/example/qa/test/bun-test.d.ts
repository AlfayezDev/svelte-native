declare module "bun:test" {
	interface Matchers {
		not: Matchers;
		toBe(expected: unknown): void;
		toEqual(expected: unknown): void;
		toBeNull(): void;
		toBeUndefined(): void;
		toMatch(pattern: RegExp): void;
		toBeCloseTo(expected: number, digits?: number): void;
		toContain(expected: unknown): void;
		toHaveLength(expected: number): void;
		toThrow(message?: string | RegExp): void;
	}
	export function describe(name: string, body: () => void): void;
	export function test(name: string, body: () => void | Promise<void>): void;
	export const expect: ((actual: unknown) => Matchers) & {
		objectContaining(fields: Record<string, unknown>): unknown;
	};
}
