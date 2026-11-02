import { expect, test } from "bun:test";
import { FRESH_MS, Pacer, paceAssignments } from "../src/fabric/pacer.ts";

function setup(batch = 4) {
  const frames: (() => void)[] = [];
  const pacer = new Pacer(batch, (callback) => frames.push(callback));
  const frame = () => frames.shift()?.();
  return { pacer, frames, frame };
}
const flush = () => new Promise<void>((resolve) => queueMicrotask(resolve));

test("the first batch of costly tasks of a JavaScript task runs at once, the rest follows one batch for each frame, in order", async () => {
  const { pacer, frames, frame } = setup();
  const ran: number[] = [];
  for (let index = 0; index < 10; index++) pacer.run({}, () => ran.push(index), true);
  expect(ran).toEqual([0, 1, 2, 3]);
  expect(frames).toHaveLength(1);
  frame();
  expect(ran).toEqual([0, 1, 2, 3, 4, 5, 6, 7]);
  expect(frames).toHaveLength(1);
  frame();
  expect(ran).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9]);
  expect(frames).toHaveLength(0);
  await flush();
});

test("the budget is renewed by the next JavaScript task", async () => {
  const { pacer, frames } = setup();
  const ran: number[] = [];
  for (let index = 0; index < 4; index++) pacer.run({}, () => ran.push(index), true);
  await flush();
  for (let index = 4; index < 8; index++) pacer.run({}, () => ran.push(index), true);
  expect(ran).toEqual([0, 1, 2, 3, 4, 5, 6, 7]);
  expect(frames).toHaveLength(0);
});

test("a task that is not costly runs at once, unless its key has work waiting", () => {
  const { pacer, frame } = setup(1);
  const ran: string[] = [];
  const a = {};
  const b = {};
  pacer.run({}, () => ran.push("first"), true);
  pacer.run(a, () => ran.push("a start"), true); // over the budget: waits
  pacer.run(b, () => ran.push("b plain"), false); // another key, nothing costly: now
  pacer.run(a, () => ran.push("a plain"), false); // behind a's start
  expect(ran).toEqual(["first", "b plain"]);
  expect(pacer.has(a)).toBe(true);
  expect(pacer.has(b)).toBe(false);
  frame();
  expect(ran).toEqual(["first", "b plain", "a start", "a plain"]);
  expect(pacer.has(a)).toBe(false);
});

test("a dropped key loses its queued costly work and keeps the cheap work behind it", () => {
  const { pacer, frames, frame } = setup(1);
  const ran: string[] = [];
  const a = {};
  const b = {};
  pacer.run({}, () => ran.push("first"), true);
  pacer.run(a, () => ran.push("a start"), true);
  pacer.run(a, () => ran.push("a plain"), false);
  pacer.run(b, () => ran.push("b start"), true);
  pacer.drop(a);
  expect(pacer.has(a)).toBe(true); // the plain assignment is still queued
  frame();
  expect(ran).toEqual(["first", "a plain", "b start"]);
  expect(pacer.has(a)).toBe(false);
  expect(frames).toHaveLength(0);
  pacer.drop(a); // nothing queued: nothing happens
  pacer.drop(b);
});

test("a task that queues work while a frame runs is picked up by the next frame", () => {
  const { pacer, frames, frame } = setup(1);
  const ran: string[] = [];
  pacer.run({}, () => ran.push("0"), true);
  pacer.run({}, () => { ran.push("1"); pacer.run({}, () => ran.push("3"), true); }, true);
  pacer.run({}, () => ran.push("2"), true);
  frame();
  expect(ran).toEqual(["0", "1"]);
  expect(frames).toHaveLength(1);
  frame();
  expect(ran).toEqual(["0", "1", "2"]);
  frame();
  expect(ran).toEqual(["0", "1", "2", "3"]);
  expect(frames).toHaveLength(0);
});

test("paceAssignments: the first animation of a new value is paced, plain values keep their order behind it, reads are untouched", () => {
  const { pacer, frame } = setup(1);
  const written: unknown[] = [];
  const clock = { now: 0 };
  const make = () => {
    const mutable = { _value: 0, get value() { return this._value; }, set value(next: unknown) { written.push(next); this._value = next as number; } };
    paceAssignments(mutable, pacer, (next) => typeof next === "function", () => clock.now);
    return mutable;
  };
  const first = make();
  const second = make();
  const animation = () => 1;
  first.value = animation as never;
  second.value = animation as never; // over the budget
  second.value = 5; // behind the animation of the same value
  first.value = 7; // nothing waits for first: now
  expect(written).toEqual([animation, 7]);
  expect(second.value).toBe(0);
  frame();
  expect(written).toEqual([animation, 7, animation, 5]);
  expect(second.value).toBe(5);
});

test("paceAssignments: an animation started on an older value is never delayed", () => {
  const { pacer, frames } = setup(1);
  const written: unknown[] = [];
  const clock = { now: 0 };
  const mutable = { _value: 0, get value() { return this._value; }, set value(next: unknown) { written.push(next); this._value = next as number; } };
  paceAssignments(mutable, pacer, (next) => typeof next === "function", () => clock.now);
  const animation = () => 1;
  clock.now = FRESH_MS + 1;
  for (let index = 0; index < 6; index++) mutable.value = animation as never;
  expect(written).toHaveLength(6);
  expect(frames).toHaveLength(0);
});

test("paceAssignments leaves a value without a configurable accessor alone", () => {
  const { pacer } = setup(1);
  const plain = { value: 1 };
  paceAssignments(plain, pacer, () => true);
  plain.value = 2;
  expect(plain.value).toBe(2);
  const frozen = {};
  Object.defineProperty(frozen, "value", { get: () => 1, set: () => undefined, configurable: false });
  paceAssignments(frozen, pacer, () => true);
});
