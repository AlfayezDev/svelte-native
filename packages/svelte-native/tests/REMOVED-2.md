# Removed and merged: group 2 (phase 2)

Every removal or merge of a test of group 2, one line each: `- <old file> "<old test name>": <merged into | duplicate of | removed because> <where>`.

## Merged and removed

- tests/navigation.test.ts "on Android a popped screen stays mounted with activityState 0 until the stack sends topExited": merged into tests/navigation/router-screens.test.ts "on %s a popped screen stays mounted with activityState 0 until the stack sends topExited; the stack the router works on drops it at once" (the android case; the scenario of the iOS test is a superset of this one's)

- tests/app-tree.test.ts "replaceBase on the root router replaces the first screen with a root page and keeps the screens above it": merged into tests/navigation/router-tree.test.ts "links open through the root and select the pane; a link no route matches is ignored; replaceBase swaps the root's first screen" (which now also checks that the base entry is a new one, that the entry above it is the same one and the back arrows, which were the unique assertions here; the `throw` for a navigator's screen was already there)

- tests/prepare-lifecycle.test.ts "disposing discards a ready fork and repeated commits remain inert": merged into tests/navigation/prepare-lifecycle.test.ts "disposing makes every prepare handle inert: the current one, a superseded one, and a ready fork that is committed twice" (with "disposing makes both current and superseded prepare handles inert": two cuts of one scenario, both kept as the two halves of the one test)

- tests/transitions-html.test.ts "animate:flip on the first render of a page in a screen of its own plays: the screen's native-stack is not a <svelte:element>" and "animate:flip on the first render of a page in the router's stack plays: the router's native-stack is not a <svelte:element>": merged into tests/animation/transitions-html.test.ts "animate:flip on %s moves each item from where it was: ..." (one parametrized test over the three fixtures, with "animate:flip on <li> in a keyed each moves each item from where it was: ...")

- tests/transitions.test.ts "the ancestors' transforms take a child where it is drawn, scale included, and a scroll view's offset moves its direct children": merged into tests/animation/transitions.test.ts "getBoundingClientRect counts the ancestors' transforms, scale included and a scroll view's offset for what is directly in it, and the node's own once ..." (one behaviour in two tests; the body is the second half of the merged one)

## Cross-group

Duplicates whose counterpart is in a file of another group; neither side was touched.

