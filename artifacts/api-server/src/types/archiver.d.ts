declare module "archiver" {
  import { Transform, TransformOptions } from "stream";

  interface ZipOptions extends TransformOptions {
    zlib?: { level?: number };
  }

  class ZipArchive extends Transform {
    constructor(options?: ZipOptions);
    pipe<T extends NodeJS.WritableStream>(destination: T, options?: { end?: boolean }): T;
    append(
      source: string | Buffer | NodeJS.ReadableStream,
      data: { name: string; [key: string]: unknown }
    ): this;
    finalize(): Promise<void>;
  }

  export { ZipArchive };
}
