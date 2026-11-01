import Linking from "react-native/Libraries/Linking/Linking";

/**
 * Whether the app was launched by a lab link (`rasheed-svelte://__dev/…`). The lab needs no account, so the session mounts the router
 * before it has loaded (or when the backend is unavailable) for such a launch. Asked by the session behind `nativeLabEnabled` only.
 */
export async function launchedIntoLab(): Promise<boolean> {
  const url = await Linking.getInitialURL();
  return !!url && /\/__dev(?:[/?#]|$)/.test(url.replace(/^[a-z-]+:\/\/+/, "/"));
}
