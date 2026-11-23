// Run by worklet-state.test.ts under Node (the Babel transformer Metro's workers load cannot run under Bun): transforms the sources named on the command line with the
// package's transformer, as Metro would, and prints for each the names the worklets of the output capture (`__closure`, an array of the variables), or the error the transform threw.
import { isArrayExpression, isAssignmentExpression, isIdentifier, isMemberExpression, traverseFast, type Node } from "@babel/types";
import { transform } from "../../../src/transformer.ts";

type Case = { filename: string; src: string; root: string };
const cases = JSON.parse(process.argv[2]) as Case[];
const result = cases.map(({ filename, src, root }) => {
  try {
    const output = transform({
      filename, src,
      options: { dev: false, projectRoot: root, platform: "android", hot: false, inlineRequires: false, minify: false, type: "module", unstable_transformProfile: "default", publicPath: "/assets", customTransformOptions: {} },
      plugins: [],
    } as never) as { ast: object };
    const closures: string[][] = [];
    traverseFast(output.ast as Node, (node) => {
      // Worklets 0.13 writes the closure as an array of the variables, in the order of the function's `const [a, b] = this.__closure`.
      if (!isAssignmentExpression(node) || !isMemberExpression(node.left) || !isIdentifier(node.left.property, { name: "__closure" }) || !isArrayExpression(node.right)) return;
      closures.push(node.right.elements.flatMap((element) => (isIdentifier(element) ? [element.name] : [])));
    });
    return { filename, closures };
  } catch (error) {
    return { filename, error: (error as Error).message };
  }
});
console.log(JSON.stringify(result));
