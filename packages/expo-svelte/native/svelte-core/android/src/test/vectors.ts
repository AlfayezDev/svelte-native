// Test vectors for the UTF-8 code of the native module, made by the Encoding standard's own implementation (the runtime's TextDecoder and TextEncoder).
// Run by run.sh; prints one vector per line:
//   D <input bytes in hex, or -> <hex of the UTF-8 of what TextDecoder reads>
//   E <UTF-16 code units in hex, comma separated, or -> <hex of what TextEncoder writes>
const hex = (bytes: Uint8Array) => (bytes.length === 0 ? "-" : Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join(""));
const decoder = new TextDecoder("utf-8");
const encoder = new TextEncoder();

let seed = 0x2545f491;
const random = () => {
  seed ^= seed << 13;
  seed >>>= 0;
  seed ^= seed >>> 17;
  seed ^= seed << 5;
  seed >>>= 0;
  return seed;
};

function decode(bytes: Uint8Array) {
  console.log(`D ${hex(bytes)} ${hex(encoder.encode(decoder.decode(bytes)))}`);
}

// Every one-byte and two-byte input, so each lead byte meets each continuation byte.
for (let a = 0; a < 256; a++) {
  decode(Uint8Array.of(a));
  for (let b = 0; b < 256; b++) decode(Uint8Array.of(a, b));
}

// Random inputs, biased to the bytes where decoders differ (leads, the boundaries of the allowed continuation ranges) and mixed with valid text.
const interesting = [0x80, 0x8f, 0x90, 0x9f, 0xa0, 0xbf, 0xc0, 0xc1, 0xc2, 0xdf, 0xe0, 0xe1, 0xec, 0xed, 0xee, 0xef, 0xf0, 0xf1, 0xf3, 0xf4, 0xf5, 0xff, 0x00, 0x41, 0x7f];
const samples = ["a", "é", "€", "😀", "﻿", "\u{10ffff}", "퟿", ""];
for (let i = 0; i < 40000; i++) {
  const parts: number[] = [];
  const count = random() % 10;
  for (let j = 0; j < count; j++) {
    const roll = random() % 4;
    if (roll === 0) parts.push(random() & 0xff);
    else if (roll === 1) parts.push(...encoder.encode(samples[random() % samples.length]!));
    else parts.push(interesting[random() % interesting.length]!);
  }
  let bytes = Uint8Array.from(parts);
  // Truncate a quarter of them, so sequences end early.
  if (bytes.length > 0 && random() % 4 === 0) bytes = bytes.subarray(0, 1 + (random() % bytes.length));
  decode(bytes);
}

// The byte order mark: dropped at the start only, and only whole.
for (const bytes of [[0xef, 0xbb, 0xbf], [0xef, 0xbb, 0xbf, 0x61], [0x61, 0xef, 0xbb, 0xbf], [0xef, 0xbb], [0xef, 0xbb, 0xbf, 0xef, 0xbb, 0xbf], [0xef, 0xbb, 0xbf, 0xff]]) {
  decode(Uint8Array.from(bytes));
}

// Encoding: lone surrogates become U+FFFD, pairs stay pairs.
const unitsOf = (units: number[]) => (units.length === 0 ? "-" : units.map((u) => u.toString(16).padStart(4, "0")).join(","));
const encode = (units: number[]) => console.log(`E ${unitsOf(units)} ${hex(encoder.encode(String.fromCharCode(...units)))}`);
for (const units of [[], [0x61], [0xd800], [0xdc00], [0xd800, 0xdc00], [0xdc00, 0xd800], [0xd800, 0x61], [0x61, 0xdc00], [0xd83d, 0xde00, 0xd83d], [0xd83d, 0xd83d, 0xde00], [0x7ff, 0x800, 0xffff, 0xfffe]]) encode(units);
for (let i = 0; i < 20000; i++) {
  const units: number[] = [];
  const count = random() % 8;
  for (let j = 0; j < count; j++) {
    const roll = random() % 5;
    if (roll === 0) units.push(0xd800 + (random() % 0x400));
    else if (roll === 1) units.push(0xdc00 + (random() % 0x400));
    else if (roll === 2) units.push(random() % 0x80);
    else if (roll === 3) units.push(0x80 + (random() % 0x780));
    else units.push(random() & 0xffff);
  }
  encode(units);
}
