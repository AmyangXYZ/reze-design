// The stock, for scripts: the public, undeleted grades, graphs and effects
// the stock account owns (the first of ADMIN_EMAILS, as lib/admin says).
//
// A script that writes one should then clear the server's cached copy:
// POST /api/admin/refresh, or `npm run db:refresh`.

export const STOCK_EMAIL = (process.env.ADMIN_EMAILS ?? "").split(",")[0]?.trim().toLowerCase() ?? ""

/** Rows of `kind` (or every kind when omitted), oldest first. */
export async function stockRows(pool, kind) {
  const { rows } = await pool.query(
    `select i.id, i.kind, i.name, i.author, i.description, i.tags, i.payload
       from library_items i join "user" u on u.id = i.owner_id
      where lower(u.email) = $1 and i.kind <> 'scene' and i.visibility = 'public' and i.deleted_at is null
        and ($2::text is null or i.kind = $2)
      order by i.created_at`,
    [STOCK_EMAIL, kind ?? null],
  )
  return rows
}
