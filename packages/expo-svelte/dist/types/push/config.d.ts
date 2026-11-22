/**
 * The push libraries of other makers. Android delivers every message to one `FirebaseMessagingService` and iOS has one notification center delegate, so a second
 * library would take messages from the first, or the first would take them from it: an app has one push library.
 */
export declare const otherPushLibraries: readonly string[];
/** The iOS entitlement that says which APNs the app's tokens belong to (`development` or `production`), and the background mode that lets a silent push wake the app. */
export declare const apsEnvironmentEntitlement = "aps-environment";
export declare const remoteNotificationMode = "remote-notification";
/**
 * The first server secret in `value`, and where it is (`where` names the value): a service account (an object with `"type": "service_account"`, or any `private_key`
 * in it, or JSON text that has either), a PEM private key, or the path of a `.p8` file (the APNs key). Push needs the identifiers of the app in its build
 * (`google-services.json`, the `aps-environment` mode), and none of these: a key that can send to every user is the server's, never the app's.
 */
export declare function findPushSecret(value: unknown, where: string): {
    where: string;
    what: string;
} | undefined;
/** The package names of the Firebase clients in a `google-services.json`: `client[].client_info.android_client_info.package_name`. */
export declare function googleServicesPackages(parsed: unknown): string[];
/** The refusal of a secret in the config, as the plugin and the doctor both say it: `where` names the value and `what` the kind of key it is (`findPushSecret`). */
export declare const pushSecretMessage: ({ where, what }: {
    where: string;
    what: string;
}) => string;
/** What `capabilities.push` says once its shape has been checked: nothing is read from disk, so a file it names may still be missing, and the channel's defaults are not filled in. */
export type PushConfig = {
    android?: {
        googleServicesFile: string;
        icon?: string;
        color?: string;
        channel?: {
            id?: string;
            name: string;
            description?: string;
        };
    };
    ios?: {
        mode: "development" | "production";
    };
};
/**
 * Checks the shape of `capabilities.push` (the value of the config, whatever it is; the caller has found it not to be off, and to hold no secret) and returns what it says, or the
 * `problem` the plugin stops the prebuild with. It reads nothing: the files it names, the app's package and the installed libraries are for the plugin to check (`pushSettings`), and
 * the doctor says them in its own way. The plugin and the doctor both call this, so they refuse the same configs.
 */
export declare function checkPushConfig(push: unknown): {
    config: PushConfig;
} | {
    problem: string;
};
/** Whether `capabilities.push` of the config is on: anything but `false`, `null` and leaving it out (so a value that is not an object is on, and is refused by `checkPushConfig`). */
export declare const pushIsOn: (push: unknown) => boolean;
