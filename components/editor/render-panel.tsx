"use client"

// Right dock · Render tab — where a finished scene becomes an exported video.
// Placeholder for the WebCodecs export pillar: the controls are real UI, the
// Render action is stubbed until frame-accurate offscreen capture + encode land
// (see roadmap). Kept here (not the header) because it is output configuration,
// not a one-tap action.

import { useState } from "react"
import { Clapperboard } from "lucide-react"
import { Button } from "@/components/ui/button"
import { ScrollArea } from "@/components/ui/scroll-area"
import { Section } from "@/components/scene/scene-sidebar"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"

const RESOLUTIONS = ["720p", "1080p", "1440p", "2160p"]
const FPS = ["24", "30", "60"]
const FORMATS = ["mp4", "webm"]

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="mt-1.5 flex items-center justify-between first:mt-0">
      <span className="text-xs text-muted-foreground">{label}</span>
      {children}
    </div>
  )
}

const triggerCls =
  "h-6 w-24 border-white/10 bg-white/5 px-2 text-xs [&_svg]:size-3"

export function RenderPanel() {
  const [res, setRes] = useState("1080p")
  const [fps, setFps] = useState("30")
  const [fmt, setFmt] = useState("mp4")

  return (
    <ScrollArea className="min-h-0 flex-1">
      <div className="px-4 py-3.5">
        <Section title="Output">
          <Row label="Resolution">
            <Select value={res} onValueChange={setRes}>
              <SelectTrigger className={triggerCls}>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {RESOLUTIONS.map((r) => (
                  <SelectItem key={r} value={r} className="text-xs">
                    {r}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Row>
          <Row label="Frame rate">
            <Select value={fps} onValueChange={setFps}>
              <SelectTrigger className={triggerCls}>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {FPS.map((f) => (
                  <SelectItem key={f} value={f} className="text-xs">
                    {f} fps
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Row>
          <Row label="Format">
            <Select value={fmt} onValueChange={setFmt}>
              <SelectTrigger className={triggerCls}>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {FORMATS.map((f) => (
                  <SelectItem key={f} value={f} className="text-xs">
                    {f}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Row>
        </Section>

        <Section title="Export">
          <Button
            size="sm"
            disabled
            className="h-8 w-full gap-1.5 bg-blue-400 text-xs font-medium text-white hover:bg-blue-300"
          >
            <Clapperboard className="size-3.5" />
            Render video
          </Button>
          <div className="mt-1.5 text-xs text-muted-foreground">Frame-accurate capture + encode — coming soon.</div>
        </Section>
      </div>
    </ScrollArea>
  )
}
