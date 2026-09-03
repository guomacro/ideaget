/**
 * ideaget configuration: deployment-varying choices only. Defaults live on the
 * schema fields; the composition entry or the future settings namespace
 * overrides them. No hardcoded tunables outside this file.
 * @module ideaget/config
 */

import Schema from '@deepseek-ai/schemastery'

export interface Config {
  /** Base URL of the Zotero desktop local API (no trailing slash). */
  zoteroApiBaseUrl: string
  /** Per-request timeout for Zotero API calls. */
  requestTimeoutMs: number
  /** Default page size for `ideaget_zotero_search`. */
  maxSearchResults: number
  /** Upper bound for one PDF attachment read by the markdown pipeline. */
  maxPdfBytes: number
  /**
   * Probe-log directory. Empty string selects the default
   * `<cwd>/.ideaget/probes`; probes never break the pipeline on failure.
   */
  probeDir: string
  /** Echo every probe event to stderr (debugging aid). */
  probeVerbose: boolean
}

export const Config: Schema<Config> = Schema.object({
  zoteroApiBaseUrl: Schema.string().default('http://127.0.0.1:23119/api'),
  requestTimeoutMs: Schema.number().default(15000),
  maxSearchResults: Schema.number().default(10),
  maxPdfBytes: Schema.number().default(8 * 1024 * 1024),
  probeDir: Schema.string().default(''),
  probeVerbose: Schema.boolean().default(false),
})

/** Config with every schema default materialized. */
export type ResolvedConfig = Required<Config>

/** Normalize raw config: strip a trailing slash from the base URL. */
export function resolveConfig(raw: Config): ResolvedConfig {
  const base = raw.zoteroApiBaseUrl.replace(/\/+$/, '')
  return { ...raw, zoteroApiBaseUrl: base }
}
