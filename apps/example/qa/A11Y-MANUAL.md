# Screen reader checklists: TalkBack and VoiceOver

What a person must check with a screen reader running, and what the harness already checks without one. Two checklists, one per platform, each about 30 minutes once the device is set up. Tick a box when the behavior matches "Expect"; when it does not, leave the box empty and write one line under it (screen, what was said or done, what you expected). The results go to PLAN.md, step 7, and the final gates table.

The state of the code this was written against is `48d746e54`. Where reading the source shows that a behavior is missing, the step says "Known gap": check it anyway, because a gap that disappears is a fix to record, and one that was not a gap is a bug in this document.

## What the automated oracle covers

`pnpm native-qa a11y` opens every screen in four layouts (LTR and RTL at text size 1.0 and 2.0) and judges the accessibility tree a service walks. It never runs TalkBack or VoiceOver: on Android the oracle is `uiautomator dump --compressed` (the views a service visits, without the views marked not important and without anything under a `no-hide-descendants` view), on iOS it is the app's own dump of its accessibility elements, with UIKit's bars modelled from the controllers. The checks (`qa/lib/a11y.ts`, README "Accessibility" and "iOS"), each gated at 0 in `gates.json`:

| Check | Passes when | Gate |
|---|---|---|
| reachable | the element is in the tree, enabled, on screen with a real size, and focusable, actionable or labeled; a control the screen's source declares but the tree lacks is unreachable | `a11y.unreachable` |
| labeled | text, content description or hint on the node or a descendant | `a11y.unlabeled` |
| actionable | clickable, long-clickable, checkable or a text field (Android); button, link, adjustable or search trait (iOS) | `a11y.notActionable` |
| reading order | focus stops run top to bottom and, within a row, start to end (mirrored in RTL); a bottom toolbar is read after the content | `a11y.orderViolations` |
| title first | the title is a stop and the first after the back button and left slot | `a11y.titleNotFirst` |
| focus trap | while a sheet or modal is up, no label of the screen underneath is in the tree | `a11y.focusLeaks` |
| completeness | every screen of the matrix was dumped, signed-in screens included | `a11y.incomplete`, `a11y.signedIn.missing` |
| state (Android) | the accessibility lab's controls publish the state, value, hint, actions, live region and role React Native's views would, read from the dump and from the app's own node info | `a11y.stateMismatches` |
| touch targets | an enabled control under 48 dp (Android only) is counted | `a11y.smallTargets`, not gated |

Last results (pre-final, see PLAN.md): OVH emulator 100 screens, 460 interactive elements, 0 findings (`86a2de13e`, 27 Oct); iPhone SE 3 48 screens, 0 findings (`86a2de13e`). Related automation: the parity suite compares screenshots at font scale 2.0 and in Arabic with 0 differing pixels (it freezes what is drawn, it does not judge legibility), and the resilience suite changes font scale, locale and rotation under a running app and fails on a crash or ANR.

**What a person must check** (everything below): what is spoken and in what order when a real screen reader walks the screen; focus movement through sheets, modals and tabs; announcements on navigation; alternatives to swipes and drags; live regions; the largest text size where it is not automated; reading order in Arabic with an Arabic voice; the date picker; video; and the signed-in screens' flows (forms, errors, destructive confirmations).

## Known gaps to expect

Read from the source at `48d746e54`; the steps below test each one.

- **Android engine props (closed in code, to confirm with TalkBack).** The engine used to drop `accessibilityState`, `accessibilityValue`, `accessibilityHint`, `accessibilityActions`, `accessibilityLiveRegion`, `importantForAccessibility` and the `aria-*` aliases. It now publishes them the way React Native's Android views do (SPEC "Accessibility props"), and the `a11y` suite reads them back from the accessibility lab (`/__dev/a11y`, `qa/README.md` "Accessibility") on the emulator. What it cannot do is hear TalkBack, so the steps below that said "Known gap" now ask you to confirm: a disabled button is announced as disabled (dimmed), a checkbox as checked, unchecked or "mixed", a selected tab as selected, a slider with its value and "increment" and "decrement" in the actions menu, a hint after the label, custom actions in the actions menu, a live region when it changes, a `no-hide-descendants` view and what is in it skipped. `/__dev/a11y?mode=states` and `?mode=actions` have each of them. Native widgets (`Switch`, `TextInput`) speak their own state.
- **No announcement API.** The package exports nothing like `AccessibilityInfo.announceForAccessibility`. Error text uses `accessibilityRole="alert"`, which sets a role, not a live announcement; expect nothing to be spoken when an error appears until the user moves focus to it.
- **iOS.** React Native's iOS mounting handles `accessibilityState`, `accessibilityValue`, `accessibilityHint` and `accessibilityActions`, so these should work; `accessibilityLiveRegion` is Android-only in React Native and does nothing on iOS.
- **Selected state by color only (closed in code, to confirm).** In the account settings the section strip and the choices in Preferences (language, appearance) are `Button`s whose selected one is drawn as the primary variant. They now carry `accessibilityState.selected`, and a role: the strip's buttons are tabs, the choices radios (`Button.svelte`, `AccountSettings.svelte`). Expect both platforms to say which one is selected.
- **Device cards.** Every card's button read "Sign out device", and only the user-agent text above it named the device. The signed-in branch (`feat/svelte-native-signedin2`, commit "a screen reader can tell the repeated Sign out and Delete workspace buttons apart") labels each "Sign out device, <user agent>"; until that branch is merged this gap stays open.
- **Product screens have no swipe rows, carousels or date pickers.** Those exist in the lab (`/__dev/gestures`, `/__dev/foreign`); the checklist uses them to test the package, not the product.

## Setup (both platforms)

- Install the QA app (`io.example.svelteqa`, from `pnpm native-qa build`, or an EAS `qa` build). It holds the product screens and the lab. Use a dev backend; the development sign-in code is `000000`. Do not write the account's address into any file.
- Open a lab route by link: Android `adb shell am start -a android.intent.action.VIEW -d 'example-svelte:///__dev/screens'`; iPhone: type the link into Safari's address bar. Routes used: `/__dev/screens` (header, tabs, sheet, form sheet, modal, toolbar menu), `/__dev/tree` (file-routed tabs), `/__dev/gestures?mode=row|carousel|pushed-edge`, `/__dev/foreign?mode=libraries`, `/__dev` (checks panel). The product's screens are reached by signing in: `example-svelte:///workspaces`.
- Keep the phone awake and plugged in (screen timeout at its longest), the volume up, battery saver off.
- Set the device language to English first; the RTL step switches it.

## TalkBack (Android), about 30 minutes

Use Google TalkBack (on Samsung, Settings > Accessibility > Installed apps; Samsung's Voice Assistant has different gestures). Turn on TalkBack > Settings > Advanced > Developer settings > Display speech output to read what is said. Gestures: swipe right or left = next or previous; double-tap = activate; swipe down then left = back; swipe up then right = actions menu; two-finger swipe = scroll.

### T1. Signed-out screen: login (2 min)

Open the app signed out.

- [ ] Focus starts on the first element, not in the middle or on the status bar.
- [ ] Swipe right through the screen: every control is reached once, in visual order, nothing is skipped, nothing is read twice.
- [ ] The email field is announced with its label and as an edit box; typing announces characters; the keyboard does not trap focus.
- [ ] The primary button is announced as a button with its label.
- [ ] Submit an invalid email. Expect: the error is spoken when it appears or is the next stop (Known gap: probably silent until focused).
- [ ] After a valid email, the code step: the field is labeled; the focus lands somewhere sensible (record where).

### T2. Workspace list and create (3 min)

Sign in. On the workspace list:

- [ ] The title is a heading and the first stop; each workspace is one stop ("name, button"); "Create" is a button.
- [ ] Open "Create". The back arrow is "Navigate up" and the first stop before the title; after the transition TalkBack focus lands on the new screen's title (Expect: yes).
- [ ] Each field is labeled; submit an empty form: Known gap, the error is not announced on appearance.
- [ ] Double-tap "Navigate up": you return and focus lands on a sensible element of the list (record where).

### T3. Tabs and settings (5 min)

Open a workspace (home tab).

- [ ] The tab bar is read as tabs: "Home, tab 1 of 2, selected" (or equivalent), the other as not selected; it is the last stop after the content.
- [ ] Switch to Settings by double-tapping its tab: the selected state changes in speech; focus is on the new pane (record where). Switch back.
- [ ] Open `example-svelte:///__dev/screens?mode=tabs`: the tab items read "Home, new items" and "Inbox, 99+" (dot badge and number badge).
- [ ] In Settings open each of the five sections (profile, preferences, devices, workspaces, danger): the title is the first stop after "Navigate up"; the back arrow works; focus moves to the new title when the transition ends.
- [ ] Preferences: the current language and the current appearance are announced as selected, as radio buttons (the strip's buttons as tabs; they were drawn by color only). Choosing another one speaks the change or the new selection.
- [ ] Devices: with several devices listed, each "Sign out device" can be told apart by what is spoken before it (Known gap until the signed-in branch's labels are merged: the button label is the same on every card).

### T4. Account modal and confirmations (3 min)

From the workspace settings open the account (a modal that covers the tab bar).

- [ ] On open, TalkBack announces a dialog or moves focus into it; swipe right through it and past the last control: it never reaches the screen underneath, and swipe left from the first control does not either.
- [ ] Danger section: start a destructive action (the delete account or workspace flows end in a confirmation). The confirmation is a modal: its title is a heading, focus is trapped in it, Cancel and Confirm are labeled buttons.
- [ ] TalkBack back (swipe down then left) closes the confirmation, then the modal; focus returns to the control that opened it (record where).
- [ ] Change e-mail: the modal's fields are labeled and the close button reads "Close".

### T5. Sheets and modals in the lab (4 min)

Open `/__dev/screens`.

- [ ] "Sheet with two detents": on open, the sheet is announced or focus moves into it; only the sheet's content is reachable; the menu behind it is not.
- [ ] The sheet's grabber or handle: is it focusable? Can the detent be changed without dragging? Known gap: drag only.
- [ ] TalkBack back dismisses it (the sheet is dismissible); focus returns to "Sheet with two detents".
- [ ] "Form sheet": the field is labeled, the keyboard opens above the sheet, Save and Close are reachable; "Sheet that fits its content" reads title first.
- [ ] "Modal" (full-screen): title first, "Navigate up" absent or labeled, back closes it.
- [ ] "Translucent header over content": the title is still the first stop although content runs under the bar.
- [ ] Toolbar screens (`?mode=toolbar`): the toolbar items are read after the content, each with its label and a badge announced; disabled items sound disabled (the toolbar's items are native views of their own, untouched by the accessibility props).

### T6. Gesture alternatives (4 min)

- [ ] `/__dev/gestures?mode=row` (swipe-to-delete rows): with TalkBack, delete a row without a swipe. Expect "Archive" and "Delete" in the actions menu (swipe up then right) on `/__dev/a11y?mode=actions` (the swipe row), and "Last action: archive" on the screen after choosing Archive; `accessibilityActions` used to be dropped, so confirm it; record what TalkBack offers on the gesture lab's rows, which declare none. This is the test for every swipe action the app adds.
- [ ] `/__dev/gestures?mode=carousel`: reach every page of the pager without a swipe gesture (a button, or TalkBack scroll forward and backward: swipe up then right then "Scroll forward").
- [ ] `/__dev/gestures?mode=pushed-edge` (a pushed screen whose body is a horizontal pan): the header's "Navigate up" pops it; the system back gesture (swipe down then left) pops it; the edge swipe is not needed.
- [ ] Any sheet drag: dismiss with back or the scrim (double-tap the scrim if it is focusable) instead.

### T7. Live regions and announcements (2 min)

- [ ] `/__dev`: tap "Run all checks". The result line ("N functional checks passed") has `accessibilityLiveRegion="polite"`. Expect: spoken when it changes. The engine used to drop the prop; it now sends the content change from the live region when its text changes (`/__dev/a11y?mode=actions`: "Add one" changes "Count: N", which should be spoken without moving focus). Record whether it is.
- [ ] Push and pop a screen (`/__dev/screens` > "Push eight screens with headers"): on each transition TalkBack speaks the new screen's title; after a pop it speaks the previous screen's.
- [ ] Open and close a modal: the open is announced; the close is announced and the opener is focused.

### T8. Largest text (3 min)

Settings > Display > Font size, to the largest the slider offers; for the harness's own extreme set it over adb: `adb shell settings put system font_scale 2.0` (reset with `1.0`). Automated parity covers the rendering at 2.0; this step is about reading and operating.

- [ ] Login, workspace list, a settings section, the account modal, `/__dev/screens` menu: no text is clipped to nothing, nothing overlaps, every control is still reachable and activates with a double-tap.
- [ ] Headers keep a one-line title with an ellipsis; the tab bar labels stay readable; sheets still show their primary control without dragging.
- [ ] Bottom content (buttons below a form) is reachable by scrolling; TalkBack scroll forward moves the page.

### T9. Arabic and right-to-left (3 min)

Settings > Apps > the QA app > Language > Arabic (Samsung: Settings > General management > App languages; the whole device can be switched instead). An Arabic text-to-speech voice must be installed or TalkBack mispronounces everything.

- [ ] Login and workspace list: swipe right goes to the next stop in reading order, which in RTL is the next one to the left; the back arrow is at the right edge and is read first before the title.
- [ ] `/__dev/screens?mode=slots`: the header reads back, left slot (the start side, drawn at the right), title, right slot (the end side, at the left), search.
- [ ] Tabs: the first tab is at the right edge and is read first.
- [ ] Strings are spoken in Arabic where translated (a missing translation spoken in English is a finding, not a failure of the reader).
- [ ] Switch back to English.

### T10. Date picker and video (2 min)

- [ ] `/__dev/foreign?mode=libraries`, date picker section: on Android the button opens the system date dialog; TalkBack reads the dialog natively; select a day and OK: the chosen date is spoken and focus returns to the button.
- [ ] Video section (a muted, looping video with no controls): the video is either skipped or labeled as media; it does not trap focus or spam announcements. To check real controls, add `controls` to the `<Video>` in `apps/example/src/lib/native/dev/LibrarySet.svelte` in a Metro dev build (do not commit it): play or pause, the seek bar (adjustable, announces position) and full screen are labeled and operable by double-tap.

### T11. Accessibility lab: state, value, hint, actions (4 min)

Open `example-svelte:///__dev/a11y` (the states) and `example-svelte:///__dev/a11y?mode=actions`. The suite has already checked what the engine publishes for each control (`qa/README.md` "Accessibility"); this is what TalkBack says of it. Compare with any React Native app's controls with the same props if in doubt: the engine does what React Native's views do.

- [ ] "Accept terms": checkbox, checked; double-tap unchecks it and TalkBack says "not checked". "Select all, mixed": checkbox, and "mixed" is spoken.
- [ ] "Plan": a radio group of three radio buttons; the chosen one is selected. "Inbox" and "Archive": tabs, the current one selected.
- [ ] "Pay now": disabled (dimmed, not actionable). "Saving, busy": busy. "Details": expandable (the actions menu offers Expand; choosing it does nothing, as in React Native: it has no `expand` action of its own).
- [ ] "Hidden note" is skipped, "Visible note" is read.
- [ ] Actions: "Volume": a slider, "4 of 10"; swipe up and down adjusts it (the actions menu has Increase and Decrease) and the new value is spoken. "Archive thread": the hint is spoken after the button ("Moves the thread out of the inbox"), after TalkBack's usual delay. "Invoice 1042": the actions menu has Archive and Delete; choosing one sets "Last action: ..." on the screen.
- [ ] "Count: 0": double-tap "Add one" and the count is spoken without moving focus (a polite live region).

## VoiceOver (iOS), about 30 minutes

Settings > Accessibility > VoiceOver. Gestures: swipe right or left = next or previous; double-tap = activate; two-finger scrub (a Z) = escape; three-finger swipe = scroll; swipe up or down on an adjustable element changes its value; rotor (two-finger twist) > Headings, Actions. Settings > Accessibility > VoiceOver > Visual > Caption Panel shows what is spoken.

### V1. Signed-out screen: login (2 min)

- [ ] Focus starts at the top-left stop; swipe right visits every control once in visual order.
- [ ] The email field is announced as a text field with its label; the keyboard does not trap focus.
- [ ] The primary button reads as a button.
- [ ] Submit an invalid email. Expect: the error is spoken or is the next stop (Known gap: probably silent).
- [ ] Rotor > Headings finds the screen title.

### V2. Workspace list and create (3 min)

- [ ] The title is a heading and the first stop after the back button; workspaces are single stops; "Create" is a button.
- [ ] Open "Create": the bar's back button reads "Back" (or the previous title) and is the first stop; after the push VoiceOver lands on the new screen (UIKit posts the screen-changed notification: Expect the title or the first element).
- [ ] Fields are labeled; submit empty: record what is spoken.
- [ ] Back with the button, and with the escape gesture (two-finger scrub): both pop.

### V3. Tabs and settings (5 min)

- [ ] The tab bar reads "Home, tab, 1 of 2, selected"; double-tap the other tab switches; its selected state is spoken.
- [ ] Open `/__dev/screens?mode=tabs`: the items read with their badges ("Home, new items", "Inbox, 99+").
- [ ] Settings sections (profile, preferences, devices, workspaces, danger): the title is a heading, the large title (if shown) collapses without breaking focus, back works.
- [ ] Preferences: the current language and the current appearance are announced as selected (Known gap: color only). Choosing another one speaks the change or the new selection.
- [ ] Devices: each "Sign out device" can be told apart by what is spoken before it (Known gap: same label on every card).
- [ ] Rotor > Headings moves between the section headings.

### V4. Account modal and confirmations (3 min)

- [ ] On open VoiceOver lands inside the modal; swipe right past the last control and swipe left from the first: it never reaches the screen underneath (`accessibilityViewIsModal`).
- [ ] Danger section: the confirmation is modal, its title a heading, Cancel and Confirm are labeled buttons.
- [ ] Escape (two-finger scrub) dismisses the confirmation, then the modal; focus returns to the opener.
- [ ] Change e-mail: fields are labeled; Close is reachable.

### V5. Sheets and modals in the lab (4 min)

Open `/__dev/screens`.

- [ ] "Sheet with two detents": VoiceOver lands in the sheet; the menu behind it is unreachable; the grabber is an element (record its label and whether it is adjustable to change the detent).
- [ ] Escape dismisses the sheet; focus returns to its opener. Repeat for "Form sheet", "Sheet that fits its content" and "Modal".
- [ ] Large title: scroll the first list on a screen with a large title (`?mode=header`): the title collapses; VoiceOver's order is still back, title, right slot, content.
- [ ] Search (`?mode=slots`): the search field is a "search field"; typing announces; results below are reachable; cancel works.
- [ ] Toolbar (`?mode=toolbar`): items are read after the content with their labels and badges; a disabled item sounds dimmed.

### V6. Gesture alternatives (4 min)

- [ ] `/__dev/gestures?mode=row`: delete a row without a swipe. Expect: the Actions rotor offers "Delete" if the row declares `accessibilityActions` (the lab's row may not declare any; record). This is the test for every swipe action the app adds.
- [ ] `/__dev/gestures?mode=carousel`: reach every page without dragging (adjustable swipe up or down, or a control).
- [ ] `/__dev/gestures?mode=pushed-edge`: the back button pops; the escape gesture pops; the edge swipe is not required. With VoiceOver on, the system edge swipe still works (it is the system's, UIKit's).
- [ ] Sheet: dismiss with escape and by the scrim without dragging.

### V7. Live regions and announcements (2 min)

- [ ] `/__dev`: "Run all checks". Live regions do nothing on iOS (Known gap, React Native): record whether VoiceOver says anything, and whether the result line is at least reachable.
- [ ] Push and pop screens: on each transition VoiceOver speaks the new screen (title or first element); after a pop, the previous one.
- [ ] Open and close a modal: opening moves focus in; closing returns it to the opener.

### V8. Dynamic Type at the largest size (3 min)

No automated check exists on iOS (the iOS resilience runner that sets it by launch argument is not merged). Settings > Accessibility > Display & Text Size > Larger Text > Larger Accessibility Sizes, drag to the maximum.

- [ ] Login, workspace list, a settings section, the account modal, `/__dev/screens`: no text is clipped to nothing, nothing overlaps, every control is reachable and activates.
- [ ] Large titles wrap or truncate sanely; the tab bar and toolbar labels stay usable (tab items may switch to a vertical layout: record).
- [ ] Sheets keep their primary control visible; bottom buttons are reachable by scrolling.
- [ ] Return the setting to its normal size.

### V9. Arabic and right-to-left (3 min)

Settings > Apps > the QA app > Language > Arabic (or the device language). Install an Arabic VoiceOver voice if prompted.

- [ ] Login and workspace list: swipe right goes to the next stop in RTL reading order; the back button is at the right and is first.
- [ ] `/__dev/screens?mode=slots`: back, left slot (start, at the right), title, right slot (end, at the left), search.
- [ ] Tabs: the first tab is at the right and is read first; swiping through the bar goes right to left.
- [ ] Untranslated strings spoken in English are findings. Switch back to English.

### V10. Date picker and video (2 min)

- [ ] `/__dev/foreign?mode=libraries`, date picker section: the compact picker is an element with the date as its value; double-tap opens the calendar; the days are adjustable or individually reachable; choosing a date speaks it and the picker closes; VoiceOver returns to the picker.
- [ ] Video section: as on Android (the lab's video has no controls); with `controls` added in a dev build, the native controls are labeled (play, pause, seek bar adjustable with its position, full screen).

## Signed-in screens, both platforms

The oracle visits these in its signed-in phase (16 cases: workspace list, create, home, settings list, five settings sections as pages and as account-modal sections, change e-mail, delete confirmation) when a QA account is set up; the steps above (T2 to T4, V2 to V4) walk the same screens with a reader. After all of them, also check once per platform:

- [ ] Sign out: the control is labeled and a confirmation, if any, is modal.
- [ ] Every destructive action asks for confirmation in a modal whose focus is trapped.
- [ ] Every form error is reachable by swiping from the field that caused it.
- [ ] Photo upload (profile): the picker is the system's and is operable; the avatar has a label.

## Recording results

Copy this into PLAN.md, step 7, with the date and the build identity (APK digest or CDHash):

```
Screen reader pass, <platform>, <device>, <date>, build <identity>, reader <TalkBack version | iOS version>
Groups passed: T1 T2 ...     Groups with findings: T5 (grabber has no label), ...
Known gaps confirmed: <list>      Known gaps that turned out fixed: <list>
New findings: <screen>: <what was said or done>, expected <what>
```

A finding that the oracle could have caught belongs in `qa/lib/a11y.ts` or `qa/lib/screens.ts` as a new check or control, so the next pass finds it by itself.
