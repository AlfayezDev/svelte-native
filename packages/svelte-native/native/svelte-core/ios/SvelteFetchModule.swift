import ExpoModulesCore
import Foundation

/// The native half of `fetch` and `Blob` (`packages/svelte-native/src/fetch`): the Expo module `SvelteFetch` with the classes `NativeBlob` and `NativeRequest`
/// and the contract in `src/fetch/native.ts`, on URLSession. The Android module has the same names. Network, file and byte-copying work never runs on the
/// JavaScript thread: `FetchWork.queue` does it, and a promise settles from wherever its work ends.
public final class SvelteFetchModule: Module {
  private let client = FetchClient()
  /// Receives each call and passes it on, so a call never waits behind another module's work on Expo's shared queue.
  private let calls = DispatchQueue(label: "svelte.fetch.calls", qos: .userInitiated)

  private func work<Result: AnyArgument>(_ promise: Promise, _ job: @escaping () throws -> Result) {
    FetchWork.queue.async {
      do {
        promise.resolve(try job())
      } catch {
        promise.reject(FetchException.from(error))
      }
    }
  }

  public func definition() -> ModuleDefinition {
    Name("SvelteFetch")

    OnCreate {
      BlobFiles.sweepLeftovers(on: FetchWork.queue)
    }

    OnDestroy {
      self.client.shutdown()
    }

    Class(NativeBlob.self) {
      Constructor { (parts: [EitherOfThree<NativeBlob, Data, String>], type: String) in
        NativeBlob(parts: parts, type: type)
      }

      Property("size") { (blob: NativeBlob) in
        blob.size
      }

      Property("type") { (blob: NativeBlob) in
        blob.type
      }

      Function("slice") { (blob: NativeBlob, start: Int, end: Int, type: String) in
        blob.slice(from: start, to: end, type: type)
      }

      Function("objectURL") { (blob: NativeBlob) throws in
        try blob.objectURL()
      }

      AsyncFunction("bytes") { (blob: NativeBlob, promise: Promise) in
        self.work(promise) { try blob.read(from: 0, to: blob.size) }
      }.runOnQueue(calls)

      AsyncFunction("text") { (blob: NativeBlob, promise: Promise) in
        self.work(promise) { decodeUTF8(try blob.contiguousBytes()) }
      }.runOnQueue(calls)

      AsyncFunction("read") { (blob: NativeBlob, offset: Int, length: Int, promise: Promise) in
        self.work(promise) { try blob.read(from: offset, to: length > Int.max - offset ? Int.max : offset + length) }
      }.runOnQueue(calls)
    }

    Class(NativeRequest.self) {
      Constructor {
        NativeRequest()
      }

      AsyncFunction("start") { (request: NativeRequest, url: String, requestInit: NativeRequestInit, body: EitherOfThree<NativeBlob, Data, String>?, promise: Promise) in
        request.start(client: self.client, url: url, requestInit: requestInit, body: body, promise: promise)
      }.runOnQueue(calls)

      Function("cancel") { (request: NativeRequest) in
        request.transfer.abort()
      }

      AsyncFunction("read") { (request: NativeRequest, maxBytes: Int, promise: Promise) in
        request.transfer.read(maxBytes, promise)
      }.runOnQueue(calls)

      AsyncFunction("arrayBuffer") { (request: NativeRequest, promise: Promise) in
        request.transfer.take(.arrayBuffer, promise)
      }.runOnQueue(calls)

      AsyncFunction("text") { (request: NativeRequest, promise: Promise) in
        request.transfer.take(.text, promise)
      }.runOnQueue(calls)

      AsyncFunction("blob") { (request: NativeRequest, type: String, promise: Promise) in
        request.transfer.take(.blob(type: type), promise)
      }.runOnQueue(calls)
    }

    AsyncFunction("blobFromURI") { (uri: String, type: String, promise: Promise) in
      self.work(promise) { try NativeBlob.fromURI(uri, type: type) }
    }.runOnQueue(calls)

    Function("revokeObjectURL") { (url: String) in
      BlobFiles.revoke(url)
    }
  }
}
