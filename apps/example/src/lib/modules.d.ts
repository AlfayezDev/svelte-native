// Asset imports: Metro turns an imported image into a number the Image component understands.
declare module "*.png" {
  const asset: number;
  export default asset;
}
