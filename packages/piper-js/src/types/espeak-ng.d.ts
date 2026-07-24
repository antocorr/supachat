/**
 * Minimal type declarations for espeak-ng.
 * The espeak-ng package is an Emscripten WASM build of espeak-ng.
 */
declare module "espeak-ng" {
  interface ESpeakNgModule {
    FS: {
      readFile: (
        path: string,
        opts?: { encoding: string },
      ) => string;
      writeFile: (path: string, data: string) => void;
    };

    ready: Promise<void>;
  }

  interface ESpeakNgOptions {
    arguments: string[];
  }

  function ESpeakNg(options: ESpeakNgOptions): Promise<ESpeakNgModule>;

  export default ESpeakNg;
}
