// Tests for a scene's video link: only the allowed sites, read out of whatever
// a share button copied, stored as https.
//
//   npx esbuild lib/video-link.test.mts --bundle --platform=node --format=esm --tsconfig=tsconfig.json --outfile=/tmp/vl.mjs && node /tmp/vl.mjs

import assert from "node:assert/strict"
import { parseVideoLink } from "@/lib/video-link"

let failed = 0
function test(name: string, fn: () => void) {
  try {
    fn()
    console.log(`ok   ${name}`)
  } catch (e) {
    failed++
    console.log(`FAIL ${name}\n     ${e instanceof Error ? e.message : e}`)
  }
}

test("each site, on its own hosts and subdomains", () => {
  const cases: [string, string][] = [
    ["https://www.bilibili.com/video/BV1xx411c7mD", "bilibili"],
    ["https://m.bilibili.com/video/BV1xx411c7mD", "bilibili"],
    ["https://b23.tv/abc123", "bilibili"],
    ["https://www.youtube.com/watch?v=dQw4w9WgXcQ", "youtube"],
    ["https://youtu.be/dQw4w9WgXcQ", "youtube"],
    ["https://www.tiktok.com/@maker/video/123", "tiktok"],
    ["https://vm.tiktok.com/ZM123/", "tiktok"],
    ["https://v.douyin.com/abc/", "douyin"],
    ["https://x.com/maker/status/123", "x"],
    ["https://twitter.com/maker/status/123", "x"],
    ["https://mobile.twitter.com/maker/status/123", "x"],
  ]
  for (const [url, platform] of cases) assert.equal(parseVideoLink(url)?.platform, platform, url)
})

test("anywhere else, or a lookalike, is refused", () => {
  for (const url of [
    "https://example.com/video",
    "https://bilibili.com.evil.example/video",
    "https://notyoutube.com/watch",
    "https://evilbilibili.com/x",
    "javascript:alert(1)",
    "https://user:pass@www.youtube.com/watch?v=x",
    "https://www.youtube.com:8443/watch?v=x",
    "https://www.nicovideo.jp/watch/sm9",
    "not a link",
    "",
  ]) {
    assert.equal(parseVideoLink(url), null, url)
  }
})

test("a share button's caption around the link is read past, and http becomes https", () => {
  const b = parseVideoLink("【MMD】Reze 跳舞 https://b23.tv/abc123 复制此链接打开")
  assert.equal(b?.url, "https://b23.tv/abc123")
  assert.equal(parseVideoLink("http://youtu.be/x")?.url, "https://youtu.be/x")
  assert.equal(parseVideoLink("www.bilibili.com/video/BV1")?.url, "https://www.bilibili.com/video/BV1")
})

console.log(failed ? `\n${failed} failed` : "\nall passed")
process.exit(failed ? 1 : 0)
