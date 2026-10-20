// /gallery: the published scenes, as their own page (a streaming service's
// home: a billboard and shelves). The editor's Gallery word comes here, and
// the wordmark goes back.

import type { Metadata } from "next"
import { GalleryPage } from "@/components/editor/scene-gallery"

export const metadata: Metadata = {
  title: "Gallery · Reze Design",
  description: "Scenes made and published with Reze Design.",
}

export default async function Gallery({ searchParams }: { searchParams: Promise<{ facet?: string }> }) {
  const { facet } = await searchParams
  return <GalleryPage initialFacet={facet === "yours" || facet === "liked" ? facet : undefined} />
}
