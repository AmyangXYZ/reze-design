import { NextResponse } from "next/server"

// Which sign-in methods are actually configured. The sign-in dialog asks so it
// can show only what works — a clone without the secrets shows no dead buttons.
// Not under /api/auth/* — better-auth's catch-all owns that prefix.
export function GET() {
  const configured: string[] = (["google", "github"] as const).filter(
    (id) => process.env[`${id.toUpperCase()}_CLIENT_ID`] && process.env[`${id.toUpperCase()}_CLIENT_SECRET`],
  )
  if (process.env.RESEND_API_KEY) configured.push("email")
  return NextResponse.json({ providers: configured })
}
