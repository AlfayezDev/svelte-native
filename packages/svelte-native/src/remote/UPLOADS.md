# Native remote-form uploads

`NativeFile` carries bytes already read by a platform picker or filesystem API.
It does not request permissions or open files from URI strings. For example:

```ts
import { NativeFile, native } from '@alfayez/svelte-native/remote';

const form = native(saveProfile);
const photo = form.fields.photo.as('file');
// Ask your platform picker for a file, then read its bytes through its supported API.
photo.onValueChange(new NativeFile(bytes, 'photo.jpg', { type: 'image/jpeg' }));
await form.submit();
```

`as('file multiple')` accepts an array of `NativeFile`; pass an empty array to clear
it. A single file field accepts `undefined` to clear. Picker adapters have the
same `ref` and `onBlur` lifecycle as other native fields. Reset clears selections.

The existing SvelteKit binary-form serializer sends file metadata and exact bytes;
the server receives ordinary File values. Client preflight schemas must accept
NativeFile rather than checking the platform global `File`; server schemas can
continue validating ordinary `File` values. This is not multipart FormData and does
not install global File or Blob polyfills. Browser code continues using browser
file inputs. Image-submit coordinates are not supported.

Uploads are buffered in memory, not streamed. Each NativeFile defaults to a
16 MiB limit, adjustable with `maxBytes`; keep limits small because serialization
copies bytes and several files can multiply memory use. The constructor checks
this after the caller has read the bytes, so the picker/file reader should also
check size before reading. Configure a total request limit on the server. Client
limits, filenames, MIME types, and metadata are not security guarantees: validate
authorization, size, actual content, and storage names on the server. Never trust
the supplied filename as a storage path. Background transfer, upload progress,
resumable uploads, and direct filesystem streaming are not implemented here.

A failed submission now focuses the first mounted invalid field using the same
`ref` supplied by the field adapter; validation on blur does not move focus.
Keep the generated ref when composing picker/input props. Reset invalidates
pending client validation and preflight, but does not cancel a request already
sent to the server or undo its writes. Repeated mounts sharing a single field
adapter should not be used as a focus-management strategy.
