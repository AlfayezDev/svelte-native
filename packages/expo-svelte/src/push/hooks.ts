/**
 * The `push` export of `src/hooks.mobile.ts` (`MobileHooks.push`, `app-hooks.ts`): how the app answers the three things a push can do to it. They run where `init`
 * runs, in a launch without a screen too, and after `init` has settled; a hook that throws is reported with `console.error` and the default for it applies.
 */
import type { PushMessage } from "./types.ts";

/**
 * How a message that arrives in the foreground is shown (what the `foreground` hook returns). A member left out is `true`: the message is shown as it is
 * when the app is in the background (PUSH.md, "The default foreground presentation").
 */
export type PushPresentation = {
  /** Show the notification (Android: post it; iOS: present the banner). `false` shows nothing, for a message the app handles on its own screen. */
  banner?: boolean;
  /** Play the notification's sound. iOS plays it with the banner; Android's sound is the channel's, so there `false` shows the notification silently. */
  sound?: boolean;
  /** Apply the message's badge number (iOS; Android has none). */
  badge?: boolean;
};

export type PushHooks = {
  /**
   * A message arrived while the app is in the foreground: how to show it. Return nothing to show it by default. The answer has about a second: a hook that
   * takes longer, or throws, gets the default (and a later answer of it is ignored), so it should not wait for the network.
   */
  foreground?(message: PushMessage): PushPresentation | void | Promise<PushPresentation | void>;
  /**
   * A data message (`silent`) arrived with the app in the background or not running; no screen is mounted. Android lets the hook run for 18 s, iOS for 25 s, and iOS decides
   * itself how often it wakes an app for one: this keeps data fresh, and nothing that must happen belongs here. The native side is told the work is done when the hook
   * returns, resolves, or throws.
   */
  background?(message: PushMessage): void | Promise<void>;
  /**
   * A notification was tapped, from a killed app, a background one or a running one. Return `false` to stop its `url` from opening; the default opens it through the
   * router, as any link to the app is (`message.url`: a path such as `/orders/42`, or a full link). It runs before the link opens, and for the tap that launched
   * the app too, before the first screen is chosen.
   */
  opened?(message: PushMessage): boolean | void | Promise<boolean | void>;
};
