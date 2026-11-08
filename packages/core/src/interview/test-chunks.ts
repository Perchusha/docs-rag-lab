// Chunks for the bank's tests, built the way the chunker writes them: the heading path line, then
// each block after a blank line, with one span per block. Not used outside tests.
import { sha256Hex, type CompilerOutput } from '@docs-rag-lab/source-kit'

import type { BankChunk, BankDocument } from './documents.ts'

export function testChunk(
  id: string,
  blocks: readonly string[],
  options: { compiler?: CompilerOutput[]; anchor?: string; heading?: string } = {},
): BankChunk {
  let text = options.heading ?? 'Page > Section'
  const spans: [number, number][] = []
  for (const block of blocks) {
    text += '\n\n'
    spans.push([text.length, text.length + block.length])
    text += block
  }
  return {
    id,
    text,
    textHash: sha256Hex(text),
    anchor: options.anchor ?? '',
    sectionPath: ['Section'],
    spans,
    compiler: options.compiler ?? [],
  }
}

export function testDocument(path: string, chunks: BankChunk[], topic = 'topic'): BankDocument {
  return {
    path,
    url: `https://docs.example.com/${path.replace(/\.md$/, '')}`,
    title: `Title of ${path}`,
    docType: 'handbook',
    topic: { id: topic, title: 'A topic', group: 'Handbook' },
    chunks,
  }
}
