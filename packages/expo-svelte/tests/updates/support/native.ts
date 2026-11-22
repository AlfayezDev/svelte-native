import type { SvelteUpdatesNative } from "../../../src/updates/native.ts";

/**
 * A `SvelteUpdates` native module of a build with updates on, as the tests of the client (`updates/client.test.ts`), the launch hook (`updates/launch.test.ts`) and `updated`
 * (`kit/updated.test.ts`) all start from: Android, the embedded bundle launched, nothing stored, every operation a no-op, `downloadAsset` answering with the hash it was given and
 * `request` refusing (the protocol client goes through `fetch`). A test overrides what it records or answers.
 */
export const nativeUpdates = (overrides: Partial<SvelteUpdatesNative> = {}): SvelteUpdatesNative => ({
  isEnabled: true,
  platform: "android",
  updateId: null,
  runtimeVersion: "0.1.0",
  updateUrl: "https://u.expo.dev/p",
  requestHeaders: { "expo-channel-name": "production" },
  checkOnLaunch: "NEVER",
  hasEmbeddedUpdate: true,
  isEmbeddedLaunch: true,
  createdAt: 0,
  localAssets: {},
  clientId: "c",
  request: async () => { throw new Error("the protocol client goes through fetch"); },
  downloadAsset: async (download) => ({ key: download.key, hash: download.hash }),
  commitUpdate: async () => {},
  saveMetadata: async () => {},
  readStore: async () => JSON.stringify({ embeddedCreatedAt: 0, updates: {}, failedIds: [], metadata: { serverDefinedHeaders: null, manifestFilters: null } }),
  rollBackToEmbedded: async () => {},
  markLaunched: async () => {},
  reload: async () => {},
  ...overrides,
} as SvelteUpdatesNative);
