// biome-ignore-all lint/suspicious/noExplicitAny: a structural walk of the Babel AST
// Run by kit/remote-transformer.test.ts under Node (the Babel transformer Metro's workers load cannot run under Bun): transforms the files named on the command line
// with the package's transformer, as Metro would, and prints each one's dependencies as JSON.
import { readFileSync } from "node:fs";
import { traverseFast } from "@babel/types";
import { transform } from "../../../src/transformer.ts";

type Case = { filename: string; src?: string; root: string };
const cases = JSON.parse(process.argv[2]) as Case[];
const result = cases.map(({ filename, src, root }) => {
  const output = transform({
    filename, src: src ?? readFileSync(filename, "utf8"),
    options: { dev: false, projectRoot: root, platform: "android", hot: false, inlineRequires: false, minify: false, type: "module", unstable_transformProfile: "default", publicPath: "/assets", customTransformOptions: {} },
    plugins: [],
  } as never) as { ast: object };
  const dependencies: string[] = [];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  traverseFast(output.ast as never, (node: any) => {
    if (node.type === "CallExpression" && node.callee.name === "require" && node.arguments[0]?.type === "StringLiteral") dependencies.push(node.arguments[0].value);
    if (node.type === "ImportDeclaration") dependencies.push(node.source.value);
  });
  return { filename, dependencies };
});
console.log(JSON.stringify(result));
