import { NextResponse } from "next/server"
import { toNextJsHandler } from "better-auth/next-js"
import { auth } from "@/lib/auth"
import { hasDatabase } from "@/lib/db"

// Accounts need a database. Without one, "who am I" has a real answer — nobody —
// and returning it beats a 500 the client has to guess at. See lib/db.
const handler = toNextJsHandler(auth)

export async function GET(request: Request) {
  if (!hasDatabase) return NextResponse.json(null)
  return handler.GET(request)
}

export async function POST(request: Request) {
  if (!hasDatabase) return NextResponse.json({ error: "no database on this deployment" }, { status: 503 })
  return handler.POST(request)
}
