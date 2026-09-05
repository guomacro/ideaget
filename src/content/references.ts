/**
 * References extraction from pipeline Markdown: Zotero does not store a
 * structured reference list for papers, so the honest sources are (a) the
 * item's `relations` when a publisher/import filled them, and (b) a heuristic
 * scan of the trailing References/Bibliography section of the extracted body.
 * Heuristic output is flagged as such by callers.
 * @module ideaget/content/references
 */

const SECTION_HEADING = /^#{1,4}\s+(references|bibliography|works cited|literature cited)\s*$/i
const PLAIN_HEADING = /^(references|bibliography|works cited|literature cited)\s*$/i
const YEAR = /(?:19|20)\d{2}/
const NEXT_HEADING = /^#{1,4}\s+[A-Z]/
const LEADING_NUMBER = /^\[?\d{1,3}(?:[.\])]|[:.\s]*)\s*/

/**
 * Scan extracted body text for a trailing reference section and return the
 * citation-like lines within it (bounded). Empty when no section is found —
 * absence is honest, never fabricated.
 * @param markdown - pipeline Markdown body text.
 * @param max - upper bound of returned lines.
 * @returns candidate reference lines.
 */
export function extractReferences(markdown: string, max = 40): string[] {
  const lines = markdown.split('\n')
  let sectionStart = -1
  for (let index = 0; index < lines.length; index++) {
    const line = lines[index]!.trim()
    if (SECTION_HEADING.test(line) || (PLAIN_HEADING.test(line) && line.length < 40)) {
      sectionStart = index
    }
  }
  if (sectionStart === -1) return []
  const out: string[] = []
  for (let index = sectionStart + 1; index < lines.length; index++) {
    const line = lines[index]!.trim()
    if (line === '') continue
    if (NEXT_HEADING.test(line)) break
    if (!YEAR.test(line) || line.length < 20) continue
    out.push(line.replace(LEADING_NUMBER, '').replace(/\s+/g, ' ').trim())
    if (out.length >= max) break
  }
  return out.filter(line => line.length > 0)
}
