/**
 * The host `ref` callback of a component whose own `ref` prop wants a richer handle than the host's (`ViewShot`'s `capture()`, a map's
 * commands, an svg element's `getBBox`).
 *
 * The prop's callback is taken when the wrapper is made, not when the host calls it: build the wrapper in a `$derived`. The host calls a ref
 * with `null` when the element is destroyed, after the component is, and a prop of a destroyed component can no longer be read (it is a
 * getter of the parent's state, which may be gone). A new `ref` prop is a new wrapper, which the host answers with its own rule: the old
 * callback hears `null`, then the new one gets the handle.
 *
 * `onHost` hears the host's handle first (or `null`), for a component that keeps it.
 */
export function forwardRef<Host, Handle>(
  user: ((handle: Handle | null) => void) | undefined,
  make: (host: Host) => Handle | null,
  onHost?: (host: Host | null) => void,
): (host: unknown) => void {
  return (given) => {
    const host = given as Host | null;
    onHost?.(host);
    user?.(host ? make(host) : null);
  };
}
