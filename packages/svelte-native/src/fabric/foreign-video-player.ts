/**
 * `createVideoPlayer` of `expo-video` (`VideoPlayer.tsx`, which has no React component in it): the player a `VideoView` shows. The library carries `expo-video` (`vendor/`, turned on with
 * `libraries: { "expo-video": true }`), so an app cannot import it by its own name where a type checker looks: this is the same function, reached through the library, and typed from the copy.
 *
 * The package is required by name when the function is called: Metro resolves the name to the copy when the app turned the library on, and to a stub that says how to turn it on when it
 * did not (`metro.ts`), so an app without `expo-video` carries a few lines for it and no more.
 */
import type { createVideoPlayer as ExpoCreateVideoPlayer } from "#vendor/expo-video/build/VideoPlayer";
import { assertLibrary } from "./foreign-libraries.ts";

/** A player for `source` (a URL, an imported file, `{ uri, headers, ... }`); give it to `VideoView` as `player` and control playback through it (`player.play()`, `player.pause()`, `player.currentTime`). */
export const createVideoPlayer: typeof ExpoCreateVideoPlayer = (source, playerBuilderOptions) => {
  assertLibrary("expo-video");
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  return (require("expo-video/build/VideoPlayer") as { createVideoPlayer: typeof ExpoCreateVideoPlayer }).createVideoPlayer(source, playerBuilderOptions);
};

export type { VideoPlayer, VideoSource } from "#vendor/expo-video/build/VideoPlayer.types";
