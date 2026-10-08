// What the agent may set on a scene, and how a patch from it is checked.
//
// One table, read three ways: the agent's description of each field (the
// meanings come from lib/scene-settings.ts, in its own words), validation of a
// patch it sends, and the clamping that keeps a value inside the range a person
// can reach with the slider. Ranges are the editor's sliders' — the agent gets
// no knob a person does not have.
//
// Stage-owned blocks (stageGrade, stageAmbient, stageFog) and the claims inside
// lights are not here: they belong to the stage that set them, not to an edit.

import type { SceneSettings } from "@/lib/scene-settings"
import { VIEW_TRANSFORMS } from "@/lib/scene-settings"
import { GRADE_PRESETS } from "@/lib/grade"
import { builtinName } from "@/lib/builtin-text"

export type FieldSpec =
  | { kind: "number"; min: number; max: number; about: string }
  | { kind: "boolean"; about: string }
  | { kind: "color"; about: string }
  | { kind: "enum"; values: readonly string[]; about: string }

/** Settings section → field → spec. Only these can be patched. */
export const SETTINGS_FIELDS: Record<string, { about: string; fields: Record<string, FieldSpec> }> = {
  sun: {
    about: "The one directional light, and the scene's only shadow caster.",
    fields: {
      color: { kind: "color", about: "Light colour." },
      strength: { kind: "number", min: 0, max: 2, about: "Brightness; 1 is a clear day." },
      azimuth: { kind: "number", min: 0, max: 360, about: "Compass direction the light comes from, degrees." },
      elevation: { kind: "number", min: 0, max: 90, about: "Height above the horizon, degrees; low is long shadows and warm rim light." },
      shadow: { kind: "boolean", about: "Cast shadows at all — on the ground and the cast alike." },
      softness: { kind: "number", min: 0, max: 1, about: "Shadow edge: 0 sharp (point sun), 1 overcast." },
    },
  },
  world: {
    about: "Sky light: one colour filling everything the sun misses (ambient).",
    fields: {
      color: { kind: "color", about: "Ambient colour; tints every shadow." },
      strength: { kind: "number", min: 0, max: 2, about: "Ambient amount; low is contrasty, high is flat." },
    },
  },
  fill: {
    about: "Extra light on the cast only (characters), not the stage — lifts faces.",
    fields: {
      color: { kind: "color", about: "Fill colour." },
      strength: { kind: "number", min: 0, max: 4, about: "Fill amount; 0 is off." },
    },
  },
  bloom: {
    about: "Glow around bright pixels (URP-style bloom).",
    fields: {
      enabled: { kind: "boolean", about: "Bloom on or off." },
      threshold: { kind: "number", min: 0, max: 2, about: "How bright a pixel must be to glow; lower glows more." },
      scatter: { kind: "number", min: 0, max: 1, about: "How far the glow spreads." },
      intensity: { kind: "number", min: 0, max: 3, about: "How strong the glow is; 1 is the game's." },
      color: { kind: "color", about: "Glow tint." },
    },
  },
  view: {
    about: "How the rendered image maps to the screen (tone mapping), before the grade.",
    fields: {
      transform: {
        kind: "enum",
        values: VIEW_TRANSFORMS,
        about: "soft = the game's curve (default); neutral/aces = Unity's; none = colours straight through (flat anime/NPR).",
      },
      exposure: { kind: "number", min: -2, max: 2, about: "Overall brightness in stops." },
    },
  },
  grade: {
    about: "Colour grade after tone mapping: a named preset at an intensity.",
    fields: {
      preset: {
        kind: "enum",
        values: GRADE_PRESETS.map((g) => g.name),
        about: `Built-in grade by name. As a Chinese-speaking user calls them: ${GRADE_PRESETS.map((g) => [g.name, builtinName("grade", g, "zh")] as const)
          .filter(([en, zh]) => zh !== en)
          .map(([en, zh]) => `${zh} = ${en}`)
          .join(", ")}.`,
      },
      intensity: { kind: "number", min: 0, max: 1, about: "How much of the grade applies." },
    },
  },
  grain: {
    about: "Film grain over the render.",
    fields: { amount: { kind: "number", min: 0, max: 1, about: "Grain amount; 0 is clean." } },
  },
  dof: {
    about: "Depth of field. Focus follows the character automatically.",
    fields: {
      enabled: { kind: "boolean", about: "Blur on or off." },
      aperture: { kind: "number", min: 0.2, max: 3, about: "How much the background blurs." },
    },
  },
  outline: {
    about: "Character outlines (inverted hull), scene-wide.",
    fields: {
      enabled: { kind: "boolean", about: "Outlines on or off." },
      width: { kind: "number", min: 0, max: 5, about: "Line width as a multiple of the model's own; 1 is as authored." },
      recolor: { kind: "boolean", about: "Use one colour for every line instead of each material's." },
      color: { kind: "color", about: "That one line colour (when recolor is on)." },
    },
  },
  background: {
    about: "What shows behind everything when there is no sky or backdrop.",
    fields: { color: { kind: "color", about: "Background colour." } },
  },
  ground: {
    about: "The floor plane under the cast.",
    fields: {
      enabled: { kind: "boolean", about: "Draw the floor at all." },
      color: { kind: "color", about: "Floor colour." },
      opacity: { kind: "number", min: 0, max: 1, about: "0 keeps only the shadow (shadow catcher); 1 is solid." },
      size: { kind: "number", min: 40, max: 800, about: "Side length; the character is about 18 units tall." },
      gridEnabled: { kind: "boolean", about: "Grid lines on the floor." },
      grid: { kind: "color", about: "Grid line colour." },
    },
  },
  eyes: {
    about: "Eyes follow the camera.",
    fields: { enabled: { kind: "boolean", about: "Characters look at the camera." } },
  },
}

export type SettingsPatch = Partial<Record<keyof SceneSettings, Record<string, unknown>>>

export type PatchCheck = {
  /** Per section, the fields to apply — clamped and normalised. */
  apply: Partial<Record<string, Record<string, unknown>>>
  /** Values moved into range, so the agent knows what actually landed. */
  clamped: string[]
  /** Fields refused, with why. */
  errors: string[]
}

const HEX = /^#[0-9a-f]{6}$/i

/** Check a patch against the table: unknown sections and fields are refused,
 *  numbers clamped to their slider range, colours must be #rrggbb. */
export function checkSettingsPatch(patch: unknown): PatchCheck {
  const out: PatchCheck = { apply: {}, clamped: [], errors: [] }
  if (!patch || typeof patch !== "object" || Array.isArray(patch)) {
    out.errors.push("patch must be an object of sections, e.g. { sun: { strength: 1.2 } }")
    return out
  }
  for (const [section, part] of Object.entries(patch as Record<string, unknown>)) {
    const spec = SETTINGS_FIELDS[section]
    if (!spec) {
      out.errors.push(`unknown section "${section}" — sections are ${Object.keys(SETTINGS_FIELDS).join(", ")}`)
      continue
    }
    if (!part || typeof part !== "object" || Array.isArray(part)) {
      out.errors.push(`${section} must be an object of fields`)
      continue
    }
    const fields: Record<string, unknown> = {}
    for (const [field, value] of Object.entries(part as Record<string, unknown>)) {
      const f = spec.fields[field]
      const path = `${section}.${field}`
      if (!f) {
        out.errors.push(`unknown field "${path}" — ${section} has ${Object.keys(spec.fields).join(", ")}`)
        continue
      }
      switch (f.kind) {
        case "number": {
          if (typeof value !== "number" || !Number.isFinite(value)) {
            out.errors.push(`${path} must be a number`)
            break
          }
          const v = Math.min(f.max, Math.max(f.min, value))
          if (v !== value) out.clamped.push(`${path} ${value} → ${v} (range ${f.min}–${f.max})`)
          fields[field] = v
          break
        }
        case "boolean":
          if (typeof value !== "boolean") out.errors.push(`${path} must be true or false`)
          else fields[field] = value
          break
        case "color":
          if (typeof value !== "string" || !HEX.test(value)) out.errors.push(`${path} must be a #rrggbb colour`)
          else fields[field] = value.toLowerCase()
          break
        case "enum":
          if (typeof value !== "string" || !f.values.includes(value)) out.errors.push(`${path} must be one of ${f.values.join(", ")}`)
          else fields[field] = value
          break
      }
    }
    if (Object.keys(fields).length) out.apply[section] = fields
  }
  return out
}

/** The table as compact text for the agent: one line per field, with its range. */
export function describeSettings(): string {
  const lines: string[] = []
  for (const [section, { about, fields }] of Object.entries(SETTINGS_FIELDS)) {
    lines.push(`${section} — ${about}`)
    for (const [name, f] of Object.entries(fields)) {
      const type =
        f.kind === "number" ? `${f.min}–${f.max}` : f.kind === "enum" ? f.values.join("|") : f.kind === "color" ? "#rrggbb" : "true|false"
      lines.push(`  ${name} (${type}): ${f.about}`)
    }
  }
  return lines.join("\n")
}

/** The settings as the agent reads them: only the fields it can set. */
export function readableSettings(settings: SceneSettings): Record<string, Record<string, unknown>> {
  const out: Record<string, Record<string, unknown>> = {}
  for (const [section, { fields }] of Object.entries(SETTINGS_FIELDS)) {
    const current = (settings as unknown as Record<string, Record<string, unknown> | undefined>)[section]
    if (!current) continue
    const picked: Record<string, unknown> = {}
    for (const name of Object.keys(fields)) if (current[name] !== undefined) picked[name] = current[name]
    out[section] = picked
  }
  return out
}
