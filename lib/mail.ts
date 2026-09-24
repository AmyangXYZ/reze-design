import "server-only"

// Transactional mail through Resend's REST API. The sign-in code is the only
// thing we send.
//
// auth.reze.one is verified on Resend (Tokyo) with DKIM, SPF and DMARC — QQ Mail
// files unauthenticated mail as spam. The message is one language, the one the
// site was showing, and reads like any login mail: it names the site, says why
// it arrived, and carries no images or tracked links.

import type { Locale } from "@/lib/i18n"

const FROM = "Reze Design <login@auth.reze.one>"

const COPY: Record<Locale, (code: string) => { subject: string; lines: string[] }> = {
  en: (code) => ({
    subject: `Your Reze Design sign-in code is ${code}`,
    lines: [
      "Hi,",
      `Use this code to sign in to Reze Design (reze.design). It expires in 10 minutes.`,
      code,
      "If you didn't try to sign in, you can ignore this email — nobody can get into your account without the code.",
      "— Reze Design",
    ],
  }),
  zh: (code) => ({
    subject: `你的 Reze Design 登录验证码是 ${code}`,
    lines: [
      "你好，",
      "请使用以下验证码登录 Reze Design（reze.design），10 分钟内有效。",
      code,
      "如果这不是你本人的操作，请忽略此邮件——没有验证码，任何人都无法登录你的账户。",
      "—— Reze Design",
    ],
  }),
}

export async function sendSignInCode(to: string, code: string, locale: Locale): Promise<void> {
  const { subject, lines } = COPY[locale](code)
  const text = lines.join("\n\n")
  const html = `<div style="font-family:system-ui,sans-serif;font-size:14px;line-height:1.6;color:#111">${lines
    .map((l) =>
      l === code
        ? `<p style="font-size:28px;font-weight:600;letter-spacing:4px;margin:16px 0">${code}</p>`
        : `<p style="margin:0 0 12px">${l}</p>`,
    )
    .join("")}</div>`

  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${process.env.RESEND_API_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({ from: FROM, to, subject, text, html }),
  })
  if (!res.ok) throw new Error(`Resend ${res.status}: ${await res.text()}`)
}
