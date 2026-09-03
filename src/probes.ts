/**
 * Intermediate probes: structured, cheap, never-fatal instrumentation on key
 * pipeline stages (transport, search, PDF extraction, markdown assembly).
 * Every event is appended as one JSON line to a daily JSONL file and, when
 * verbose, echoed to stderr. Probes exist so early integration problems on
 * the read line surface with stage + timing + error code instead of a bare
 * failure.
 * @module ideaget/probes
 */

import { appendFileSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'

export interface ProbeEvent {
  ts: string
  stage: string
  ok: boolean
  ms: number
  detail?: unknown
}

function isoNow(): string {
  return new Date().toISOString()
}

function safeJson(value: unknown): string {
  try {
    return JSON.stringify(value)
  } catch {
    return JSON.stringify({ unserializable: true })
  }
}

export class ProbeLog {
  private dir: string | null
  private initialized = false

  constructor(probeDir: string, private readonly verbose: boolean) {
    this.dir = probeDir === '' ? null : probeDir
  }

  private fileFor(today: string): string {
    return join(this.dir!, `probes-${today}.jsonl`)
  }

  private ensureDir(): void {
    if (this.initialized || this.dir === null) return
    try {
      mkdirSync(this.dir, { recursive: true })
      this.initialized = true
    } catch {
      this.dir = null // probes never throw into the pipeline
    }
  }

  /** Record one finished probe event synchronously. */
  record(stage: string, ok: boolean, ms: number, detail?: unknown): void {
    this.ensureDir()
    if (this.dir === null) {
      if (this.verbose) process.stderr.write(`[ideaget probe] ${stage} ok=${ok} ms=${ms}\n`)
      return
    }
    const event: ProbeEvent = { ts: isoNow(), stage, ok, ms }
    if (detail !== undefined) event.detail = detail
    const line = safeJson(event) + '\n'
    try {
      appendFileSync(this.fileFor(event.ts.slice(0, 10)), line)
      if (this.verbose) process.stderr.write(line.trimEnd() + '\n')
    } catch {
      // Disk full / permissions: probes stay best-effort.
    }
  }

  /**
   * Time one async stage, record success or failure, rethrow on failure.
   * @param stage - stable stage name (e.g. `zotero.serverInfo`, `pipeline.pdf`).
   * @param fn - the stage work.
   * @returns the stage result.
   */
  async trace<T>(stage: string, fn: () => Promise<T>): Promise<T> {
    const started = performance.now()
    try {
      const value = await fn()
      this.record(stage, true, Math.round(performance.now() - started))
      return value
    } catch (error) {
      this.record(stage, false, Math.round(performance.now() - started), {
        code: error instanceof Error && 'code' in error ? (error as { code?: unknown }).code : undefined,
        message: error instanceof Error ? error.message : String(error),
      })
      throw error
    }
  }
}
