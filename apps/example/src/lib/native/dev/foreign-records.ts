/**
 * What the library lab records of its checks, apart from React Native, so that the harness's tests load it (`qa/test/foreign.test.ts`). The skip a check reports is the
 * line Android's harness reads from logcat; the lists in a scenario's `detail` are what the iPhone's harness reads from `Documents/lab-results.json`.
 */

/**
 * One skip as the lab records it and logs it. An Android-only check carries `androidOnly: true`; every other skip is exactly the four fields Android's lines have always had.
 */
export function skipEntry<Library extends string, Place extends string>(library: Library, where: Place, name: string, why: string, androidOnly: boolean): { library: Library; where: Place; name: string; why: string; androidOnly?: true } {
  return { library, where, name, why, ...(androidOnly ? { androidOnly: true as const } : {}) };
}

/**
 * Every check and every skip, for the harness that cannot follow a log. The iPhone's harness reads `Documents/lab-results.json` (a log line of the device is not
 * available to it), which holds this scenario's `detail`; Android's reads one logcat line per check, and its lab-results line would grow by the whole list for nothing,
 * so on Android the detail holds nothing of the two lists.
 */
export function detailRecords<Check, Skip>(android: boolean, checks: readonly Check[], skips: readonly Skip[]): { checks?: readonly Check[]; skips?: readonly Skip[] } {
  return android ? {} : { checks, skips };
}
