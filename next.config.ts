import type { NextConfig } from "next"
// import { join } from "path"

const nextConfig: NextConfig = {
  // outputFileTracingRoot: join(__dirname, ".."),
  devIndicators: false,

  /**
   * Let browsers KEEP the demo assets.
   *
   * Next serves everything in `public/` as `max-age=0, must-revalidate`, which
   * caches the bytes and then asks about them anyway — a conditional request per
   * file, every load. The demo model is 13 files; with the motion and the audio
   * that is ~15 round trips before the scene can start, and on a lossy link a
   * revalidation that hangs means the asset never arrives even though it is
   * already on disk. `/_next/static` does not have this problem because Next
   * hashes those filenames and marks them immutable; `public/` gets neither.
   *
   * These three directories are the boot payload and they are versioned by PATH:
   * a different demo model is a different file name. So they can be immutable —
   * with the discipline that comes with it, which is that REPLACING an asset in
   * place will leave anyone who has already loaded it on the old bytes for a
   * year. Rename instead of overwrite.
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
