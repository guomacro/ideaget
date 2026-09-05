#!/usr/bin/env node
/**
 * Build the browser client half into `lib/client.js` in the dsh client
 * bundle format: a registration script that calls
 * `window.__ModuleLoader__.load({ id, factory })` exactly like the official
 * tsdown `clientBundle` output — the module host treats each bundle as a
 * factory-registration script, NOT as a plain CommonJS module (a plain
 * module.exports bundle fails with "loaded without registering <id>").
 *
 * React, ReactDOM, cordis and every `@deepseek-ai/*` module are platform /
 * baseline supplies resolved through the factory's `require` — never bundled.
 * @module ideaget/scripts/build-client
 */

import { build } from 'esbuild'
import { writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import vm from 'node:vm'

const here = dirname(fileURLToPath(import.meta.url))
const root = join(here, '..')
const outfile = join(root, 'lib/client.js')
const BUNDLE_ID = 'ideaget'

const result = await build({
  entryPoints: [join(root, 'src/client/index.ts')],
  bundle: true,
  format: 'cjs',
  platform: 'browser',
  target: 'es2020',
  jsx: 'automatic',
  write: false,
  logLevel: 'silent',
  external: ['react', 'react-dom', '@deepseek-ai/*'],
})

const code = result.outputFiles[0]?.text
if (code === undefined) {
  throw new Error('build-client: esbuild produced no output')
}

const wrapped = `window.__ModuleLoader__.load({
\tid: ${JSON.stringify(BUNDLE_ID)},
\tfactory: (require) => {
\t\tvar module = { exports: {} };
\t\tvar exports = module.exports;
\t\tObject.defineProperty(exports, Symbol.toStringTag, { value: "Module" });
${code}
\t\treturn module.exports;
\t}
});
`

writeFileSync(outfile, wrapped)

// Dev-time guard: evaluate the bundle under a stub loader and assert the
// factory registers `apply`/`inject` (the host's arrival path).
const registrations = []
const stubWindow = {
  __ModuleLoader__: {
    load(registration) {
      registrations.push(registration)
    },
  },
}
const context = vm.createContext({
  window: stubWindow,
  require: () => ({}),
  console,
})
vm.runInContext(wrapped, context)
const registration = registrations[0]
if (registration?.id !== BUNDLE_ID || typeof registration.factory !== 'function') {
  throw new Error(`build-client: registration check failed (got ${JSON.stringify(registration?.id)})`)
}
const module = registration.factory(() => ({}))
const names = Object.keys(module)
if (!names.includes('apply') || !names.includes('inject')) {
  throw new Error(`build-client: factory exports missing apply/inject (got ${names.join(',')})`)
}
console.log(`client bundle OK: ${outfile} (${registration.id}, exports: ${names.join(', ')})`)
