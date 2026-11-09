// A video file bundled with `require` or `import` is an asset number, like the images in `modules.d.ts`; the video screen hands it to `Video`.
declare module "*.mp4" {
  const asset: number;
  export default asset;
}
