"use client"

// A sortable, paged table for the admin page.
//
// Client-side sorting because the page caps at a few hundred rows per kind — a
// server round trip per column click would cost more than it saves, and the
// queries already run from the US to Singapore.

import { useMemo, useState, type ReactNode } from "react"
import { ChevronDown, ChevronUp } from "lucide-react"
import { cn } from "@/lib/utils"

export type Column<T> = {
  key: string
  header: string
  /** Value used for sorting. Absent means the column isn't sortable. */
  sort?: (row: T) => string | number
  cell: (row: T) => ReactNode
}

const PAGE = 25

export function DataTable<T>({
  rows,
  columns,
  empty,
  initialSort,
}: {
  rows: T[]
  columns: Column<T>[]
  empty: string
  initialSort?: { key: string; desc?: boolean }
}) {
  const [sort, setSort] = useState(initialSort ?? null)
  const [page, setPage] = useState(0)

  const sorted = useMemo(() => {
    if (!sort) return rows
    const col = columns.find((c) => c.key === sort.key)
    if (!col?.sort) return rows
    const get = col.sort
    return [...rows].sort((a, b) => {
      const [x, y] = [get(a), get(b)]
      const cmp =
        typeof x === "number" && typeof y === "number"
          ? x - y
          : String(x).localeCompare(String(y))
      return sort.desc ? -cmp : cmp
    })
  }, [rows, columns, sort])

  const pages = Math.ceil(sorted.length / PAGE)
  const visible = sorted.slice(page * PAGE, page * PAGE + PAGE)

  if (rows.length === 0)
    return <p className="mt-3 text-xs text-muted-foreground">{empty}</p>

  return (
    <>
      <div className="mt-3 overflow-x-auto">
        <table className="w-full min-w-max table-auto text-xs">
          <thead className="text-muted-foreground">
            <tr className="border-b border-white/10 text-left">
              {columns.map((c) => {
                const active = sort?.key === c.key
                return (
                  <th
                    key={c.key}
                    className="px-4 py-2 font-medium whitespace-nowrap"
                  >
                    {c.sort ? (
                      <button
                        onClick={() => {
                          // First click on a new column sorts descending: for counts,
                          // "most" is the question being asked.
                          setSort((s) =>
                            s?.key === c.key
                              ? { key: c.key, desc: !s.desc }
                              : { key: c.key, desc: true },
                          )
                          setPage(0)
                        }}
                        className={cn(
                          "inline-flex cursor-pointer items-center gap-1 transition-colors hover:text-foreground",
                          active && "text-foreground",
                        )}
                      >
                        {c.header}
                        {active &&
                          (sort.desc ? (
                            <ChevronDown className="size-3" />
                          ) : (
                            <ChevronUp className="size-3" />
                          ))}
                      </button>
                    ) : (
                      c.header
                    )}
                  </th>
                )
              })}
            </tr>
          </thead>
          <tbody>
            {visible.map((row, i) => (
              <tr key={i} className="border-b border-white/5">
                {columns.map((c) => (
                  <td
                    key={c.key}
                    className="px-4 py-2 align-top"
                  >
                    {c.cell(row)}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {pages > 1 && (
        <div className="mt-2 flex items-center gap-3 text-xs text-muted-foreground">
          <button
            disabled={page === 0}
            onClick={() => setPage((p) => p - 1)}
            className="cursor-pointer rounded px-1.5 py-0.5 hover:text-foreground disabled:opacity-30"
          >
            Previous
          </button>
          <span className="font-mono">
            {page + 1} / {pages}
          </span>
          <button
            disabled={page >= pages - 1}
            onClick={() => setPage((p) => p + 1)}
            className="cursor-pointer rounded px-1.5 py-0.5 hover:text-foreground disabled:opacity-30"
          >
            Next
          </button>
          <span className="ml-auto font-mono">{sorted.length} rows</span>
        </div>
      )}
    </>
  )
}
