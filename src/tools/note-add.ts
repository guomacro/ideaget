/**
 * `ideaget_zotero_note_add`: the first local WRITE tool (Zotero 10+ local
 * authorize). Adds a child note under one paper. Refused with a stable
 * `write-disabled` error unless `config.readOnly` is false; the desktop
 * shows a permission dialog for the write key.
 * @module ideaget/tools/note-add
 */

import type { Context } from '@deepseek-ai/cordis'
import {
  defineTool,
  type InferArgs,
  type InferValue,
} from '@deepseek-ai/dsh-tools'
import type { IdeagetService } from '../service.js'

const NOTE_ADD_PARAMETERS = {
  ref: {
    type: 'string',
    required: true,
    description: 'Parent paper ref (zotero://user/0/item/<KEY>) or bare 8-char key.',
  },
  text: { type: 'string', required: true, description: 'Plain-text note content.' },
} as const

type NoteAddArgs = InferArgs<typeof NOTE_ADD_PARAMETERS>

const NOTE_ADD_OUTPUT_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    noteRef: { type: 'string', required: true },
    remember: { type: 'boolean', required: true, description: 'true when the user chose "always allow" the local write key.' },
  },
} as const

type NoteAddOutput = InferValue<typeof NOTE_ADD_OUTPUT_SCHEMA>

export function registerNoteAddTool(ctx: Context, service: IdeagetService): void {
  ctx.tools.register(defineTool({
    name: 'ideaget_zotero_note_add',
    description: 'Write: add a child note under one Zotero paper (local API write, Zotero 10+; the desktop asks for permission). Disabled by default — set config.readOnly=false to use.',
    parameters: NOTE_ADD_PARAMETERS,
    output: {
      schema: NOTE_ADD_OUTPUT_SCHEMA,
      render: (_args, value) => [{
        type: 'text',
        text: `note created: ${value.noteRef}${value.remember ? ' (write key remembered)' : ''}`,
      }],
    },
    async execute(args, exec) {
      return service.addNoteToItem(args, exec.signal)
    },
  }))
}
