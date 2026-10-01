import type { NextConfig } from "next"
import { realpathSync } from "fs"
import { join, relative } from "path"
import { version } from "./package.json"

function engineOutsideProject(): boolean {
  try {
    const real = realpathSync(join(__dirname, "node_modules", "reze-engine"))
    return relative(__dirname, real).startsWith("..")
  } catch {
    return false
  }
}

const nextConfig: NextConfig = {
  ...(engineOutsideProject() ? { outputFileTracingRoot: join(__dirname, "..") } : {}),
  devIndicators: false,
  reactStrictMode: false,
  env: { NEXT_PUBLIC_APP_VERSION: version },
}

export default nextConfig
