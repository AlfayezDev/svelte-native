# Ordinary Svelte, explicit native boundaries

This draft adds portable interactions and native remote-file fields, and hardens
reduced-motion and prepared-navigation lifecycles. It is not a declaration of
Expo/React Native feature parity. Compiler work is deliberately out of scope.

## Drag a value, not a worklet

```svelte
<script lang="ts">
  import { drag } from '@alfayez/svelte-native/interactions';
  let offset = $state(0);
</script>

<div use:drag={{ axis: 'x', onmove: p => offset = p.x,
  oncancel: () => offset = 0 }}>
  Drag offset: {offset}
</div>
<button onclick={() => offset = 0}>Reset position</button>
```

Use the offset in the application's own layout or transform. `draggable(options)`
is the attachment form (`{@attach draggable(options)}`); `swipe` commits a
direction only after a successful drag reaches its configured distance.
Actions cancel on teardown or option replacement. Native interactions use a
single-pointer RNGH pan; web interactions use primary pointer capture. Axis
constraints leave the perpendicular scroll direction available. Do not put two
gesture-owning actions on the same native node; use the existing Gesture
composition API for simultaneous/race/exclusive recognizers.

These callbacks intentionally run on the JavaScript thread so ordinary `$state`
assignments work. They do not make arbitrary JavaScript into UI-thread worklets.
For continuously smooth transforms under JS load, retain the existing native
Gesture/Reanimated APIs. Cross-platform tests cover lifecycle contracts, not
hardware latency or every platform's scroll arbitration.

Every gesture-only operation must also have a labeled, focusable button or other
accessible alternative. A swipe is not automatically a screen-reader action.
Use existing accessibility props and reduced-motion support when animating the
result; a raw drag callback does not itself animate or announce anything.

## Remote data and files

The existing remote query/command/form machinery remains SvelteKit's machinery,
not a second RPC protocol. See [native uploads](remote/UPLOADS.md) for byte-backed
picker values. Client validation never replaces server authentication,
authorization, upload limits or content validation.

## Navigation and platform services

`router.prepare()` already integrates Svelte forks for forward navigation when
async compilation is enabled. The new lifecycle guards make prepared handles
inert after router disposal, including handles superseded by another prepare.
This is not Android predictive back: native progress, cancellation, history and
commit ownership still require a device-verified platform contract before adding
a speculative back API.

Existing transitions, focus handles, safe-area/keyboard primitives and back
handling are retained. This draft does not replace them, promise automatic
keyboard avoidance for every layout, or claim native device validation. A full
parity gate still needs iOS/Android QA for nested scroll gestures, screen readers,
keyboard focus, interrupted transitions and interactive system back.

## Follow-through and verification boundaries

This PR also normalizes ordinary HTML ARIA boolean/numeric literals for Fabric,
accepts whitespace-separated `aria-labelledby` IDs, and keeps explicit native
accessibility props when an alias is null. Keyboard avoidance now compares
window-space coordinates consistently for overlays below headers and clamps a
shrunk view to zero rather than producing negative height.

The remaining platform work is not hidden behind this API:

| Area | Current implementation | What still needs validation or design |
| --- | --- | --- |
| Basic drag/swipe | JS-state callbacks, axis arbitration, web pointer capture | Nested native scroll views, platform latency, physical-device cancellation |
| Gesture composition | Existing RNGH builders and relationships | No automatic inference of simultaneous/exclusive intent from arbitrary Svelte markup |
| Accessibility | HTML ARIA normalization and visible alternative controls | VoiceOver/TalkBack gestures, focus announcements, hardware keyboard ordering |
| Motion | Existing Svelte motion/transition bridges, reduced-motion race fix | Full transition fixture validation with a compiler build supporting custom-renderer transitions |
| Navigation | Existing forward forks and disposal guards | Interactive back progress/cancel/history contract and platform device QA |
| Keyboard/safe area | Existing components plus coordinate correction | Rotation, floating keyboards and keyboard animation on iOS/Android |
| Remote files | Explicit immutable bytes in Kit's binary form format | Streaming/resumable/background upload transport and server/device round trip |

A framework cannot safely infer destructive swipe intent, request filesystem
permissions, or turn arbitrary commands into speculative side effects. Those
remain explicit application decisions. Server commands must still enforce
identity and authorization; speculative UI preparation is not authorization to
execute writes.

For an existing native Gesture builder or composition, use
`{@attach gestureAttachment(pan)}` from `@alfayez/svelte-native` on a native host
(or a lowered primitive). Svelte reattaches when the gesture expression changes.
Teardown only removes the gesture that attachment still owns, so it cannot erase
a newer attachment's gesture. This native attachment is not a browser Gesture
builder; use the portable interaction subpath for basic web/native drags.
