/**
 * Stable error vocabulary. Codes are part of the public surface so tools,
 * the future client, and probes can route on typed failures without parsing
 * prose.
 * @module ideaget/errors
 */

export type IdeagetErrorCode =
  | 'zotero-unreachable'
  | 'local-api-disabled'
  | 'request-timeout'
  | 'item-not-found'
  | 'malformed-ref'
  | 'no-text-attachment'
  | 'attachment-not-readable'
  | 'pdf-budget-exceeded'
  | 'pdf-parse-failed'
  | 'write-disabled'

export class IdeagetError extends Error {
  readonly code: IdeagetErrorCode

  constructor(code: IdeagetErrorCode, message: string, options?: ErrorOptions) {
    super(message, options)
    this.name = 'IdeagetError'
    this.code = code
  }
}
