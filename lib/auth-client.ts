"use client"

import { createAuthClient } from "better-auth/react"
import { inferAdditionalFields } from "better-auth/client/plugins"

export const authClient = createAuthClient({
  // Declared literally rather than inferred from the server config: importing
  // `typeof auth` would drag the server module into the client's graph.
  plugins: [
    inferAdditionalFields({
      user: {
        username: { type: "string", required: false },
        // Null until the user picks their own handle; set once, then permanent.
        usernameChangedAt: { type: "date", required: false },
      },
    }),
  ],
})

export const { signIn, signUp, signOut, useSession } = authClient
