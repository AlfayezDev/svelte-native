/** Byte helpers of the native module smoke test (smoke.ts); no React Native import, so the harness's tests load them. */

const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
/** Base64 to bytes, for a module that returns a string (`RNGetRandomValues.getRandomBase64`). */
export function decodeBase64(text: string): Uint8Array {
	const clean = text.replace(/=+$/, "");
	const bytes: number[] = [];
	let bits = 0;
	let value = 0;
	for (const char of clean) {
		const index = alphabet.indexOf(char);
		if (index < 0) throw new Error(`not base64: ${char}`);
		value = (value << 6) | index;
		bits += 6;
		if (bits >= 8) {
			bits -= 8;
			bytes.push((value >> bits) & 0xff);
		}
	}
	return Uint8Array.from(bytes);
}
export function encodeBase64(bytes: Uint8Array): string {
	let out = "";
	for (let index = 0; index < bytes.length; index += 3) {
		const chunk = ((bytes[index] ?? 0) << 16) | ((bytes[index + 1] ?? 0) << 8) | (bytes[index + 2] ?? 0);
		out += alphabet.charAt((chunk >> 18) & 63) + alphabet.charAt((chunk >> 12) & 63);
		out += index + 1 < bytes.length ? alphabet.charAt((chunk >> 6) & 63) : "=";
		out += index + 2 < bytes.length ? alphabet.charAt(chunk & 63) : "=";
	}
	return out;
}
export const ascii = (text: string): Uint8Array => Uint8Array.from(text, (char) => char.charCodeAt(0));
export const hex = (bytes: ArrayLike<number>): string => Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
/** Not all zero and not all equal: a fill that did something. */
export const looksRandom = (bytes: ArrayLike<number>): boolean => bytes.length > 0 && new Set(Array.from(bytes)).size > 1;

