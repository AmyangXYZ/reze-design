// What every model is told: the instructions and the tools. One module for
// both places a turn can run — this server, for Premium, and the person's own
// browser, for their own key — so the two can never drift apart.

import { AGENT_SYSTEM_PROMPT } from "@/lib/ai/agent-prompt"
import { SCENE_TOOLS } from "@/lib/ai/scene-tools"
import { describeSettings } from "@/lib/ai/settings-schema"

export const AGENT_TOOLS = SCENE_TOOLS.map((t) => ({ name: t.name, description: t.description, parameters: t.parameters }))

/** The instructions, with the look settings' reference built in: it never
 *  changes, so it belongs in the cached prefix rather than costing a round at
 *  the start of every conversation. */
export const AGENT_SYSTEM = `${AGENT_SYSTEM_PROMPT}

The look settings you can change (set_settings), what each does and its range:
${describeSettings()}`

/** Added for a model that reads text only. */
export const TEXT_ONLY_NOTE = `

You cannot see images in this conversation: captures and reference images reach you only as the numbers and notes the tools report. Judge the scene from those measurements, and say plainly when only looking at it would settle something.`
