/**
 * The `remote` option of the Expo config plugin (`expo-svelte`, which is `app.plugin.js`): the SvelteKit server the app's remote functions call. It
 * validates the host at config time, writes it where the runtime reads it (`extra.expoSvelte.remote`, which `expo-constants` embeds in the
 * build), and, for an `http:` host (a development server), lets the app talk to it: Android blocks cleartext traffic and iOS App Transport
 * Security blocks `http:` to a named domain, unless the build says otherwise. An `https:` host changes nothing native.
 */
import { withAndroidManifest, withInfoPlist, type ConfigPlugin } from "expo/config-plugins";
import { EXTRA_KEY, normalizeAppDir, normalizeBase, normalizeOrigin, type RemoteHostConfig } from "./host.ts";

/** `extra` with the validated host under `expoSvelte.remote`; every other key stays. */
export function remoteExtra(extra: Record<string, unknown> | undefined, remote: RemoteHostConfig): Record<string, unknown> {
  const host = { origin: normalizeOrigin(remote.origin), base: normalizeBase(remote.base), appDir: normalizeAppDir(remote.appDir) };
  return { ...extra, [EXTRA_KEY]: { ...(extra?.[EXTRA_KEY] as Record<string, unknown> | undefined), remote: host } };
}

/** Whether talking to this origin needs the build to allow cleartext HTTP. */
export const isCleartext = (origin: string): boolean => new URL(origin).protocol === "http:";

/**
 * The domain App Transport Security has to be told about for an `http:` origin. ATS does not apply to IP addresses, unqualified host names
 * (`localhost`) or `.local` names, so those need no exception, and `undefined` is returned for them.
 */
export function atsExceptionDomain(origin: string): string | undefined {
  const { hostname } = new URL(origin);
  const address = /^\d{1,3}(\.\d{1,3}){3}$/.test(hostname) || hostname.startsWith("[");
  return address || !hostname.includes(".") || hostname.endsWith(".local") ? undefined : hostname;
}

/** `<application android:usesCleartextTraffic="true">`, added to the manifest's application element. */
export function allowAndroidCleartext(application: { $?: Record<string, string | undefined> }): void {
  application.$ = { ...application.$, "android:usesCleartextTraffic": "true" };
}

/** The domain's ATS exception for plain HTTP, merged into `Info.plist`'s `NSAppTransportSecurity`. */
export function allowIosCleartext(infoPlist: Record<string, unknown>, origin: string): void {
  const domain = atsExceptionDomain(origin);
  if (domain === undefined) return;
  const security = (infoPlist.NSAppTransportSecurity ?? {}) as { NSExceptionDomains?: Record<string, Record<string, unknown>> };
  security.NSExceptionDomains = { ...security.NSExceptionDomains, [domain]: { ...security.NSExceptionDomains?.[domain], NSExceptionAllowsInsecureHTTPLoads: true, NSIncludesSubdomains: false } };
  infoPlist.NSAppTransportSecurity = security;
}

export const withRemoteHost: ConfigPlugin<RemoteHostConfig> = (config, remote) => {
  config.extra = remoteExtra(config.extra, remote);
  const { origin } = (config.extra[EXTRA_KEY] as { remote: Required<RemoteHostConfig> }).remote;
  if (!isCleartext(origin)) return config;
  config = withAndroidManifest(config, (config) => {
    const application = config.modResults.manifest.application?.[0];
    if (!application) throw new Error("Svelte native could not find <application> in AndroidManifest.xml");
    allowAndroidCleartext(application);
    return config;
  });
  return withInfoPlist(config, (config) => {
    allowIosCleartext(config.modResults as Record<string, unknown>, origin);
    return config;
  });
};
