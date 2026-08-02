/**
 * Minimal ambient types for pica@9 (which ships no bundled .d.ts and has no
 * up-to-date @types package). Covers only the surface normalizePhoto.ts uses.
 */
declare module 'pica' {
  type PicaSource = HTMLCanvasElement | HTMLImageElement | ImageBitmap;

  interface PicaResizeOptions {
    quality?: 0 | 1 | 2 | 3;
    alpha?: boolean;
    unsharpAmount?: number;
    unsharpRadius?: number;
    unsharpThreshold?: number;
  }

  interface PicaInstance {
    resize(
      from: PicaSource,
      to: HTMLCanvasElement,
      options?: PicaResizeOptions,
    ): Promise<HTMLCanvasElement>;
    toBlob(
      canvas: HTMLCanvasElement,
      mimeType: string,
      quality?: number,
    ): Promise<Blob>;
  }

  interface PicaOptions {
    features?: string[];
    tile?: number;
    idle?: number;
    concurrency?: number;
  }

  function pica(options?: PicaOptions): PicaInstance;

  export default pica;
}
