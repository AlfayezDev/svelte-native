/**
 * Image sources of an OTA update. The bundle's asset registry entries carry `fileHashes` (the MD5 of each scaled file, which is
 * the manifest asset `key`), and the native store holds the downloaded files under those keys. React Native resolves a
 * registered asset by name next to the bundle, which is wrong once the bundle lives in the update store, so this transformer
 * maps the picked scale's hash to its downloaded file. It is expo-asset's `Asset.fx` transformer without expo-asset.
 */
export type RegisteredAsset = { fileHashes?: string[]; scales: number[] };
export type SourceResolver<Resolved> = {
  asset: RegisteredAsset;
  fromSource(uri: string): Resolved;
  defaultAsset(): Resolved;
  resourceIdentifierWithoutScale(): Resolved;
};

export function createAssetTransformer<Resolved>(options: {
  localAssets: Record<string, string>;
  platform: "android" | "ios";
  pickScale: (scales: number[]) => number;
}): (resolver: SourceResolver<Resolved>) => Resolved {
  return (resolver) => {
    const { fileHashes, scales } = resolver.asset;
    if (!fileHashes || fileHashes.length === 0) return resolver.defaultAsset();
    const index = scales.indexOf(options.pickScale(scales));
    const uri = options.localAssets[fileHashes[index] ?? fileHashes[0] ?? ""];
    if (uri) return resolver.fromSource(uri);
    // An asset the update does not list is still in the app binary; on Android that is a drawable resource, not a file next to the bundle.
    return options.platform === "android" ? resolver.resourceIdentifierWithoutScale() : resolver.defaultAsset();
  };
}
