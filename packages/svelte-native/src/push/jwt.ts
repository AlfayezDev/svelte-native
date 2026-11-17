/**
 * The JSON Web Tokens of the two providers, signed with Node's `crypto` alone: FCM's OAuth server takes an RS256 assertion signed with the service account's key,
 * and APNs an ES256 provider token signed with the `.p8`.
 */
import { createPrivateKey, sign, type KeyObject } from "node:crypto";

export type Algorithm = "RS256" | "ES256";

/** The key type and, for an elliptic key, the curve each algorithm needs. */
const KEYS: Record<Algorithm, { type: string; curve?: string }> = {
  RS256: { type: "rsa" },
  ES256: { type: "ec", curve: "prime256v1" },
};

/**
 * A PEM that came through an environment variable often has its line breaks written as the two characters `\n`, which no PEM parser reads. A key that has real line
 * breaks is left alone.
 */
export const pemOf = (value: string): string => (value.includes("\n") ? value : value.replaceAll("\\n", "\n")).trim();

/**
 * The key of a PEM, checked to be what `algorithm` signs with, so that a wrong key (an RSA key where the `.p8` is expected, a P-384 key) fails when the sender is made and
 * with a message that names the option, not at the first send with the provider's answer. The message never quotes the key.
 */
export function privateKeyOf(pem: string, algorithm: Algorithm, name: string): KeyObject {
  let key: KeyObject;
  try {
    key = createPrivateKey(pemOf(pem));
  } catch (error) {
    throw new TypeError(`${name} is not a PEM private key (${error instanceof Error ? error.message : String(error)}).`, { cause: error });
  }
  const wanted = KEYS[algorithm];
  if (key.asymmetricKeyType !== wanted.type || (wanted.curve !== undefined && key.asymmetricKeyDetails?.namedCurve !== wanted.curve)) {
    throw new TypeError(`${name} must be ${wanted.curve === undefined ? "an RSA" : "a P-256 (prime256v1) elliptic-curve"} private key for ${algorithm}, not ${key.asymmetricKeyType ?? "another kind of key"}${key.asymmetricKeyDetails?.namedCurve ? ` on ${key.asymmetricKeyDetails.namedCurve}` : ""}.`);
  }
  return key;
}

const encode = (value: object): string => Buffer.from(JSON.stringify(value)).toString("base64url");

/** A compact JWS (RFC 7515): the header `{ alg, ...header }`, the claims and the signature, each base64url. */
export function signJwt(algorithm: Algorithm, header: Record<string, string>, claims: Record<string, string | number>, key: KeyObject): string {
  const input = `${encode({ alg: algorithm, ...header })}.${encode(claims)}`;
  // JOSE's ES256 signature is the raw r and s, 32 bytes each (RFC 7518, 3.4); Node signs in DER unless it is told otherwise.
  const signature = sign("sha256", Buffer.from(input), algorithm === "ES256" ? { key, dsaEncoding: "ieee-p1363" } : key);
  return `${input}.${signature.toString("base64url")}`;
}
