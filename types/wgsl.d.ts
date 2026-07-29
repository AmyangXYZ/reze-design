// WGSL files import as source text (see the raw-loader rule in next.config.ts).
declare module "*.wgsl" {
  const source: string
  export default source
}
