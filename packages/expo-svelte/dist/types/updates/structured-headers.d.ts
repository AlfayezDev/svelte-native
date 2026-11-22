/**
 * The part of RFC 8941 (Structured Field Values) the Expo Updates protocol uses: the server sends `expo-manifest-filters` and
 * `expo-server-defined-headers` as dictionaries, the client sends `expo-recent-failed-update-ids` as a list of strings and
 * `expo-extra-params` as a dictionary of strings. Mirrors the reading rules of expo-updates' `ResponseHeaderData`: entries that
 * are not strings, numbers or booleans are dropped, and a header that does not parse yields `null`.
 */
export type HeaderValue = string | number | boolean;
/** Parses an sf-dictionary into the members whose values are strings, numbers or booleans. A member without `=` is boolean true. */
export declare function parseDictionary(header: string): Record<string, HeaderValue> | null;
/** An sf-list of strings: `"a", "b"`. */
export declare function serializeStringList(values: string[]): string;
/** An sf-dictionary of string members: `key="value", other="value"`. */
export declare function serializeStringDictionary(entries: Record<string, string>): string;
