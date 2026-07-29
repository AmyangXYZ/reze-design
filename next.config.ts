import type { NextConfig } from "next"
// import { join } from "path"

const nextConfig: NextConfig = {
  // Shaders are authored as real .wgsl files in content/ and imported as source.
  turbopack: {
    rules: {
      "*.wgsl": { loaders: ["raw-loader"], as: "*.js" },
    },
  },
  // outputFileTracingRoot: join(__dirname, ".."),
  devIndicators: false,
}

export default nextConfig
