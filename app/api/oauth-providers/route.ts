import { NextResponse } from "next/server"

// Which social providers are actually configured. The sign-in dialog asks so it
// can show only buttons that work — a clone without OAuth secrets should offer
// email and password rather than two buttons that 404.
// Not under /api/auth/* — better-auth's catch-all owns that prefix.
export function GET() {
  const configured = (["google", "github"] as const).filter(
    (id) => process.env[`${id.toUpperCase()}_CLIENT_ID`] && process.env[`${id.toUpperCase()}_CLIENT_SECRET`],
  )
  return NextResponse.json({ providers: configured })
}
