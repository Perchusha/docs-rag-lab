// Code blocks and compiled examples of a chunk, read back from its text (ADR-0018). The chunker
// fences every code block (renderBlock) and renders each error and type query right after its
// block (ADR-0017), so the block that ends just before a `Compiler output:` line is the one that
// output belongs to. The chunk's metadata keeps the outputs in the same order, without their code.
import type { CompilerOutput } from './types.ts'

/** A fenced code block of a chunk's text. */
export interface CodeBlock {
  /** The fence's info string: a language, and for some docs a file name after it. */
  info: string
  code: string
  /** Offsets of the opening fence and just past the closing one. */
  start: number
  end: number
}

/** One example the compiler said something of: its code as the chunk holds it, and the output. */
export interface CompiledExample {
  /** The first word of the fence's info string. */
  lang: string
  code: string
  output: CompilerOutput
  /** Offset of the opening fence in the chunk's text, for the section the example is in. */
  start: number
}

const OPENING = /^(`{3,})([^`]*)$/
const OUTPUT_HEADING = '\n\nCompiler output:'

/** Every fenced code block of a chunk's text, in order, as the chunker writes them. */
export function codeBlocks(text: string): CodeBlock[] {
  const blocks: CodeBlock[] = []
  let offset = 0
  let open: { fence: string; info: string; start: number; lines: string[] } | undefined
  for (const line of text.split('\n')) {
    const end = offset + line.length
    if (open === undefined) {
      const match = OPENING.exec(line)
      if (match !== null) {
        open = { fence: match[1] ?? '```', info: (match[2] ?? '').trim(), start: offset, lines: [] }
      }
    } else if (line === open.fence) {
      blocks.push({ info: open.info, code: open.lines.join('\n'), start: open.start, end })
      open = undefined
    } else {
      open.lines.push(line)
    }
    offset = end + 1
  }
  return blocks
}

const hasLines = (output: CompilerOutput): boolean =>
  output.errors.length > 0 || output.queries.length > 0

/**
 * The examples whose output has errors or type queries, paired with their code. When the text
 * does not hold as many such outputs as the metadata, nothing can be paired safely, and the
 * answer is empty.
 */
export function compiledExamples(
  text: string,
  compiler: readonly CompilerOutput[],
): CompiledExample[] {
  const outputs = compiler.filter(hasLines)
  const blocks = codeBlocks(text).filter((block) => text.startsWith(OUTPUT_HEADING, block.end))
  if (blocks.length !== outputs.length) return []
  return blocks.flatMap((block, i) => {
    const output = outputs[i]
    const lang = block.info.split(/\s+/)[0] ?? ''
    return output === undefined ? [] : [{ lang, code: block.code, output, start: block.start }]
  })
}
