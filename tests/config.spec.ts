import { describe, expect, it } from 'vitest'
import { resolveConfig } from '../src/config.js'

describe('resolveConfig', () => {
  it('strips a trailing slash from the base URL', () => {
    const config = resolveConfig({
      zoteroApiBaseUrl: 'http://127.0.0.1:23119/api/',
      requestTimeoutMs: 1,
      maxSearchResults: 1,
      maxPdfBytes: 1,
      probeDir: '',
      probeVerbose: false,
    })
    expect(config.zoteroApiBaseUrl).toBe('http://127.0.0.1:23119/api')
  })
})
