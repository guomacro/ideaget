#!/usr/bin/env node
/**
 * Build the browser client half into `lib/client.js` (lazy CommonJS, per the
 * dsh client module system). React, ReactDOM, cordis and every
 * `@deepseek-ai/*` module are platform/baseline supplies — never bundled.
 * @module ideaget/scripts/build-client
 */

import { build } from 'esbuild'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const here = dirname(fileURLToPath(import.meta.url))
const root = join(here, '..')

const result = await build({
  entryPoints: [join(root, 'src/client/index.ts')],
  outfile: join(root, 'lib/client.js'),
  bundle: true,
  format: 'cjs',
  platform: 'browser',
  target: 'es2020',
  jsx: 'automatic',
  logLevel: 'info',
  external: ['react', 'react-dom', '@deepseek-ai/*'],
})

if (result.errors.length > 0) process.exitCode = 1
