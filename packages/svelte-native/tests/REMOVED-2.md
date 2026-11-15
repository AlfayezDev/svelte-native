# Removed and merged: group 2 (phase 2)

Every removal or merge of a test of group 2, one line each: `- <old file> "<old test name>": <merged into | duplicate of | removed because> <where>`.

## Merged and removed

- tests/navigation.test.ts "on Android a popped screen stays mounted with activityState 0 until the stack sends topExited": merged into tests/navigation/router-screens.test.ts "on %s a popped screen stays mounted with activityState 0 until the stack sends topExited; the stack the router works on drops it at once" (the android case; the scenario of the iOS test is a superset of this one's)

## Cross-group

Duplicates whose counterpart is in a file of another group; neither side was touched.

