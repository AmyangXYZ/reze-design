import type { NextConfig } from "next"
// import { join } from "path"
import { version } from "./package.json"

const nextConfig: NextConfig = {
  // outputFileTracingRoot: join(__dirname, ".."),
  devIndicators: false,
  reactStrictMode: false,
  /** The version badge reads the manifest, so it cannot go stale. Baked in here
   *  rather than imported by the client, which would ship package.json with it. */
  env: { NEXT_PUBLIC_APP_VERSION: version },

  /**
   * Let browsers KEEP the demo assets.
   *
   * Next serves `public/` as `max-age=0, must-revalidate` — cache the bytes, then
   * ask about them anyway, ~15 round trips before the demo scene can start. These
   * three directories are versioned by PATH, so they can be immutable, with the
   * discipline that comes with it: rename, never overwrite in place.
   */
  async headers() {
    return [
      {
        source: "/:dir(models|animations|audios)/:path*",
        headers: [{ key: "Cache-Control", value: "public, max-age=31536000, immutable" }],
      },
    ]
  },
}

export default nextConfig
