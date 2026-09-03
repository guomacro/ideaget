import { mkdtempSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { ProbeLog } from '../src/probes.js'

describe('ProbeLog', () => {
  const dirs: string[] = []

  afterEach(() => {
    dirs.length = 0
  })

  it('writes one JSON line per event to a daily file', () => {
    const dir = mkdtempSync(join(tmpdir(), 'ideaget-probes-'))
    dirs.push(dir)
    const log = new ProbeLog(dir, false)
    log.record('stage.a', true, 12)
    log.record('stage.b', false, 3, { code: 'x' })
    const file = readdirSync(dir).find(name => name.startsWith('probes-'))
    expect(file).toBeDefined()
    const lines = readFileSync(join(dir, file!), 'utf8').trim().split('\n')
    expect(lines).toHaveLength(2)
    expect(JSON.parse(lines[0]!)).toMatchObject({ stage: 'stage.a', ok: true, ms: 12 })
    expect(JSON.parse(lines[1]!)).toMatchObject({ stage: 'stage.b', ok: false, ms: 3, detail: { code: 'x' } })
  })

  it('never breaks the pipeline on a missing directory', () => {
    const log = new ProbeLog('/dev/null/ideaget/nope', false)
    expect(() => log.record('x', true, 1)).not.toThrow()
  })

  it('trace records success and rethrows failures', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'ideaget-probes2-'))
    dirs.push(dir)
    const log = new ProbeLog(dir, false)
    await expect(log.trace('ok.stage', async () => 41)).resolves.toBe(41)
    await expect(log.trace('bad.stage', async () => {
      throw new Error('boom')
    })).rejects.toThrow('boom')
    const file = readdirSync(dir).find(name => name.startsWith('probes-'))
    const lines = readFileSync(join(dir, file!), 'utf8').trim().split('\n')
    expect(lines).toHaveLength(2)
    expect(JSON.parse(lines[1]!)).toMatchObject({ stage: 'bad.stage', ok: false })
  })

  it('appends safely when the dir becomes writable later', () => {
    const dir = mkdtempSync(join(tmpdir(), 'ideaget-probes3-'))
    writeFileSync(join(dir, 'seed'), 'x')
    const log = new ProbeLog(dir, false)
    expect(() => log.record('x', true, 1)).not.toThrow()
  })
})
