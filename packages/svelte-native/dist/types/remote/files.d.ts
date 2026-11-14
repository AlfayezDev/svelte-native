/** In-memory upload. Read bytes using your platform's picker/file API; a URI is not file content. */
export declare class NativeFile {
    #private;
    readonly name: string;
    readonly type: string;
    readonly lastModified: number;
    constructor(bytes: Uint8Array, name: string, options?: {
        type?: string;
        lastModified?: number;
        maxBytes?: number;
    });
    /** Explicitly buffer a platform File for the synchronous SvelteKit form serializer. This is not a streaming upload. */
    static from(file: Pick<File, "name" | "type" | "size" | "lastModified" | "arrayBuffer">, options?: {
        maxBytes?: number;
    }): Promise<NativeFile>;
    get size(): number;
    bytes(): Uint8Array;
}
/** Private SvelteKit binary-form Blob adapter, not a global Blob replacement. */
export declare class BinaryFormBlob {
    #private;
    constructor(parts?: ReadonlyArray<Uint8Array | string | NativeFile>);
    get size(): number;
    bytes(): Uint8Array;
}
