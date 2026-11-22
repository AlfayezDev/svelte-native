/**
 * Responses as an EAS Update server sends them for protocol version 1, built from the specification
 * (https://docs.expo.dev/technical-specs/expo-updates-1/): a `multipart/mixed` body with `manifest` and `extensions` parts, the
 * directive-only responses, and the headers `expo-protocol-version`, `expo-sfv-version`, `expo-manifest-filters` and
 * `expo-server-defined-headers`. Asset hashes are the real SHA-256 (base64url) of the fixture bytes, and keys the real MD5.
 */
import { createHash } from "node:crypto";

export const sha256 = (data: string): string => createHash("sha256").update(data).digest("base64url");
export const md5 = (data: string): string => createHash("md5").update(data).digest("hex");

export const PROJECT_ID = "bb048172-896f-48f1-97c0-c9ec765842c0";
export const UPDATE_ID = "5f3a6a58-0b1e-4c1a-9c1e-6a3c2a2e1b10";
export const CREATED_AT = "2026-10-20T12:00:00.000Z";
export const BOUNDARY = "formdata-6bd8f2c7ef0b1e3ad4f9b1f4b2c8d3e6";

export const bundleBytes = "hermes-bytecode-of-update-2";
export const imageBytes = "png-bytes-of-logo";
export const imageBytes2x = "png-bytes-of-logo-2x";

const assetUrl = (name: string) => `https://u.expo.dev/${PROJECT_ID}/assets?asset=${name}&runtimeVersion=0.1.0&platform=android`;

export const launchAsset = { hash: sha256(bundleBytes), key: md5(bundleBytes), contentType: "application/javascript", url: assetUrl("bundles/android-main.hbc") };
export const logo = { hash: sha256(imageBytes), key: md5(imageBytes), contentType: "image/png", fileExtension: ".png", url: assetUrl("assets/logo") };
export const logo2x = { hash: sha256(imageBytes2x), key: md5(imageBytes2x), contentType: "image/png", fileExtension: ".png", url: assetUrl("assets/logo2x") };

export const manifest = {
  id: UPDATE_ID,
  createdAt: CREATED_AT,
  runtimeVersion: "0.1.0",
  launchAsset,
  assets: [logo, logo2x],
  metadata: { branchName: "production" },
  extra: { expoClient: { name: "Example", slug: "example", version: "0.1.0" }, eas: { projectId: PROJECT_ID } },
};

export const extensions = { assetRequestHeaders: { [logo.key]: { authorization: "Bearer asset-token", "x-asset": 7 } } };

export const rollBackDirective = { type: "rollBackToEmbedded", parameters: { commitTime: "2026-10-22T08:30:00.000Z" }, extra: { scopeKey: "@alfayez/example" } };
export const noUpdateDirective = { type: "noUpdateAvailable" };

type PartOptions = { name: string; json: unknown; contentType?: string; extraHeaders?: string[] };
const part = ({ name, json, contentType = "application/json; charset=utf-8", extraHeaders = [] }: PartOptions) =>
  [`--${BOUNDARY}`, `content-disposition: form-data; name="${name}"`, `content-type: ${contentType}`, ...extraHeaders, "", typeof json === "string" ? json : JSON.stringify(json), ""].join("\r\n");

export const multipart = (parts: PartOptions[]): string => `${parts.map(part).join("\r\n")}${parts.length ? "\r\n" : ""}--${BOUNDARY}--\r\n`;

export const responseHeaders = {
  "content-type": `multipart/mixed; boundary=${BOUNDARY}`,
  "expo-protocol-version": "1",
  "expo-sfv-version": "0",
  "cache-control": "private, max-age=0",
  "expo-manifest-filters": 'branchname="production"',
  "expo-server-defined-headers": 'expo-channel-name="production", rollout=3',
};

export const manifestResponse = (body = manifest) => new Response(multipart([{ name: "manifest", json: body }, { name: "extensions", json: extensions }]), { status: 200, headers: responseHeaders });
export const directiveResponse = (directive: unknown) => new Response(multipart([{ name: "directive", json: directive }]), { status: 200, headers: responseHeaders });
export const emptyResponse = () => new Response(null, { status: 204, headers: { "expo-protocol-version": "1" } });
