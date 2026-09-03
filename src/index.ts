/**
 * ideaget plugin entry: a Cordis Service plugin providing `ctx.ideaget`.
 * The loader mounts the default export (the service class) with the row's
 * validated config; the constructor registers the read-only Zotero routes,
 * the markdown pipeline, the model-facing tools, and `/ideaget status`.
 * @module ideaget
 */

export { IdeagetService } from './service.js'
export { default } from './service.js'
export type { Config, ResolvedConfig } from './config.js'
export * from './errors.js'
export type * from './types.js'
