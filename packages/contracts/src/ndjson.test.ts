import { describe, expect, it } from 'vitest'

import type { AnswerEvent } from './answer.ts'
import { encodeEvent, EventDecoder, parseEvent, StreamFormatError } from './ndjson.ts'

const multiline: AnswerEvent = { type: 'text', text: 'Use `satisfies`\nwhen' }

const events: AnswerEvent[] = [
  multiline,
  {
    type: 'citations',
    numbers: [1],
    citations: [
      {
        number: 1,
        source: 'https://www.typescriptlang.org/docs/x.html#a',
        title: 'TypeScript 4.9 > The satisfies Operator',
        citedText: 'The new satisfies operator',
        chunkId: 'release-notes/TypeScript 4.9.md#the-satisfies-operator:0',
        contextRank: 1,
      },
    ],
  },
  { type: 'error', message: 'connection reset' },
]

describe('encodeEvent', () => {
  it('writes one line per event, so a newline in the text stays escaped', () => {
    const line = encodeEvent(multiline)
    expect(line.endsWith('\n')).toBe(true)
    expect(line.slice(0, -1)).not.toContain('\n')
    expect(parseEvent(line)).toEqual(multiline)
  })
})

describe('EventDecoder', () => {
  it('decodes text cut at arbitrary points, Cyrillic included', () => {
    const wire = events.map(encodeEvent).join('') + encodeEvent({ type: 'text', text: 'в чём' })
    for (const size of [1, 3, 7, 64]) {
      const decoder = new EventDecoder()
      const decoded: AnswerEvent[] = []
      for (let i = 0; i < wire.length; i += size)
        decoded.push(...decoder.push(wire.slice(i, i + size)))
      decoded.push(...decoder.end())
      expect(decoded).toHaveLength(4)
      expect(decoded.at(-1)).toEqual({ type: 'text', text: 'в чём' })
    }
  })

  it('returns an event only once its newline arrives', () => {
    const decoder = new EventDecoder()
    const line = encodeEvent({ type: 'text', text: 'hi' })
    expect(decoder.push(line.slice(0, -1))).toEqual([])
    expect(decoder.push('\n')).toEqual([{ type: 'text', text: 'hi' }])
  })

  it('accepts a last line without its newline and skips blank lines', () => {
    const decoder = new EventDecoder()
    expect(decoder.push('\n\n{"type":"text","text":"a"}')).toEqual([])
    expect(decoder.end()).toEqual([{ type: 'text', text: 'a' }])
    expect(decoder.end()).toEqual([])
  })

  it('refuses a line that is not an answer event', () => {
    expect(() => new EventDecoder().push('<html>\n')).toThrow(StreamFormatError)
    expect(() => parseEvent('{"type":"usage"}')).toThrow('not an answer event')
    expect(() => parseEvent('[1]')).toThrow(StreamFormatError)
    expect(() => parseEvent('null')).toThrow(StreamFormatError)
  })

  it('refuses a stream that ends in the middle of an event', () => {
    const decoder = new EventDecoder()
    decoder.push('{"type":"te')
    expect(() => decoder.end()).toThrow(StreamFormatError)
  })
})
