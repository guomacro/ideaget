#!/usr/bin/env node
/**
 * Align `@deepseek-ai/cordis` in this project's node_modules to the SAME
 * instance the official harness packages use (vendor/cordis), so the
 * mount-test boots one cordis. Run before `node scripts/mount-test.mjs`.
 * Restore afterwards with `pnpm install`.
 * @module ideaget/scripts/align-cordis
 */

import { existsSync, lstatSync, readlinkSync, rmSync, symlinkSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const target = join(here, '..', 'node_modules', '@deepseek-ai', 'cordis')
const vendor = '/home/macro/projects/agent/agent_code/deepseek-harness/vendor/cordis'

if (existsSync(target) || lstatSync(target).isSymbolicLink()) {
  rmSync(target, { recursive: true })
}
symlinkSync(vendor, target, 'junction')
console.log(`aligned @deepseek-ai/cordis -> ${vendor}`)
