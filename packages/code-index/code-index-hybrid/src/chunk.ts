/**
 * Block-aware chunking for the hybrid code-index provider. A file splits into non-blank
 * line blocks, blocks are packed into chunks up to `chunkLines` lines, and a chunk
 * boundary never falls inside a block unless that block alone exceeds the budget — a
 * function or paragraph stays whole in one indexed chunk. When a chunk is emitted early,
 * the next chunk re-opens with the trailing `chunkOverlap` lines, so a symbol spanning a
 * boundary is indexed on both sides.
 * @module @deepseek-ai/dsh-code-index-hybrid/chunk
 */

/** One indexed chunk: reconstructed source text plus its one-based line range. */
export interface ChunkedBlock {
  /** Reconstructed chunk text, joined with `\n` exactly as the source lines appear. */
  readonly text: string
  /** One-based first source line of the chunk. */
  readonly startLine: number
  /** One-based last source line of the chunk. */
  readonly endLine: number
}

/**
 * Split one file's text into block-aware chunks.
 * @param text - the full file text.
 * @param chunkLines - target lines per chunk; a single block longer than this is hard-split at the budget.
 * @param overlapLines - trailing lines the next chunk re-opens; zero disables overlap.
 * @returns chunks in source order; an all-blank file produces no chunks.
 */
export function chunkFile(text: string, chunkLines: number, overlapLines: number): ChunkedBlock[] {
  const lines = text.split('\n')
  if (lines.length > 0 && lines[lines.length - 1] === '') lines.pop()
  const chunks: ChunkedBlock[] = []
  let start = 0
  let previousCut = 0
  while (start < lines.length) {
    const budgetEnd = Math.min(start + chunkLines, lines.length)
    const cut = Math.max(findBlockCut(lines, previousCut, budgetEnd), start + 1)
    const window = lines.slice(start, cut)
    if (window.some(line => line.trim().length > 0)) {
      chunks.push({ text: window.join('\n'), startLine: start + 1, endLine: cut })
    }
    if (cut >= lines.length) break
    previousCut = cut
    // Overlap re-opens the emitted chunk's tail, but never rewinds before `start`,
    // so the walk always makes progress even with a zero-budget overlap. The next
    // cut must pass the previous one, so an overlap that only re-slices an already
    // emitted block is folded into the next chunk instead of crawling.
    start = Math.max(cut - Math.max(0, overlapLines), start + 1)
  }
  return chunks
}

/**
 * Largest block boundary in `(minCut, budgetEnd]`, or `budgetEnd` itself when no block
 * ends inside that window — either one oversized block, or an overlap re-open whose
 * tail must fold into fresh content rather than re-emitting an old boundary.
 * @param lines - the file's lines.
 * @param minCut - exclusive lower bound: the previous chunk's cut line.
 * @param budgetEnd - exclusive line budget for this chunk.
 * @returns the exclusive cut line for the chunk.
 */
function findBlockCut(lines: readonly string[], minCut: number, budgetEnd: number): number {
  for (let cut = budgetEnd; cut > minCut; cut -= 1) {
    const previous = lines[cut - 1] as string
    const next = lines[cut]
    if (previous.trim().length > 0 && (next === undefined || next.trim().length === 0)) return cut
  }
  return budgetEnd
}
