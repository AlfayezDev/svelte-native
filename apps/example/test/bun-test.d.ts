declare module "bun:test" {
	interface Matchers {
		not: Matchers;
		rejects: Matchers;
		toBe(expected: unknown): void;
		toEqual(expected: unknown): void;
		toMatchObject(expected: Record<string, unknown>): void;
		toBeNull(): void;
		toBeUndefined(): void;
		toMatch(pattern: RegExp): void;
		toBeCloseTo(expected: number, digits?: number): void;
		toBeGreaterThan(expected: number): void;
		toBeLessThan(expected: number): void;
		toContain(expected: unknown): void;
		toContainEqual(expected: unknown): void;
		toBeDefined(): void;
		toStartWith(expected: string): void;
		toHaveLength(expected: number): void;
		toThrow(expected?: string | RegExp | (new (...args: never[]) => Error)): void;
		toBeGreaterThanOrEqual(expected: number): void;
	}
	export const mock: { module(specifier: string, factory: () => Record<string, unknown>): void };
	/** The fake clock: it replaces `setTimeout` and `Date.now` (not `setImmediate`) until `useRealTimers()`; timers fire only when the test advances it. */
	export const jest: { useFakeTimers(): void; useRealTimers(): void; advanceTimersToNextTimer(): void; getTimerCount(): number };
	export function beforeAll(body: () => void | Promise<void>): void;
	export function afterAll(body: () => void | Promise<void>): void;
	export function afterEach(body: () => void | Promise<void>): void;
	export function describe(name: string, body: () => void): void;
	export function test(name: string, body: () => void | Promise<void>, timeoutMs?: number): void;
	export const expect: ((actual: unknown) => Matchers) & {
		objectContaining(fields: Record<string, unknown>): unknown;
		stringContaining(text: string): unknown;
	};
}
