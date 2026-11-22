/**
 * Starts the registered app on a surface. In development a throw during mount or the first flush becomes the error screen; in release it propagates.
 * While the app's `init` is in flight the surface waits for it (the splash screen stays up); after a failed `init` development shows its error, and a
 * release build, where the failure is already a fatal error, starts nothing.
 */
export declare function launchSurface(rootTag: number, initialProps?: Record<string, unknown>): void;
/**
 * The host stopped a surface (a recreated Android Activity, a torn-down root). The last one to go leaves its router's navigation
 * state for the next surface to adopt, unless the app is closing for good (the user left; Android's `isFinishing`): the next
 * launch starts from its own first screen.
 */
export declare function stopApplication(rootTag: number): void;
/**
 * Unmounts every surface and starts it again with the latest registered app, keeping the navigation state (every stack and tabs selection).
 * While the app's `init` is in flight (a hot update that runs it: the file was added, or fixed after a failure) the screens stay as they are
 * and the remount waits for it.
 */
export declare function remountSurfaces(): void;
/** Replaces every running surface with the error screen. Returns false when nothing could be shown (no surface yet, or the host failed). */
export declare function showError(error: unknown, rootTags?: number[]): boolean;
