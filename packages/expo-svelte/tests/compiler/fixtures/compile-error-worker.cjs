/* eslint-disable @typescript-eslint/no-require-imports -- CommonJS is the point: jest-worker requires the worker the way Metro's workers are */
// The worker of compile-error-probe.ts: what one of Metro's transform workers does with a file here, the package's transformer alone. It runs in a process of its own, under jest-worker as Metro's
// are, so that what it throws goes through the same serialization before the probe sees it.
const { join } = require("node:path");
const { pathToFileURL } = require("node:url");

exports.transform = async (filename, src, projectRoot) => {
  const { transform } = await import(pathToFileURL(join(__dirname, "../../../src/transformer.ts")).href);
  transform({
    filename, src,
    options: { dev: false, projectRoot, platform: "android", hot: false, inlineRequires: false, minify: false, type: "module", unstable_transformProfile: "default", publicPath: "/assets", customTransformOptions: {} },
    plugins: [],
  });
  return "transformed";
};
