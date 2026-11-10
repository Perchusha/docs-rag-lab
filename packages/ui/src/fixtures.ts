// Typed access to the recorded fixtures in __fixtures__, for unit tests and
// stories. Not part of the public entry. The traces come from
// `drl search --json` over the real index; the answers are real `ask` streams.
// Every excerpt of the docs is cut to 300 characters (NOTICE).
import {
  EventDecoder,
  type AnswerEvent,
  type BankQuestion,
  type Citation,
  type DashboardDetails,
  type DashboardRun,
  type DashboardRunComparison,
  type DashboardRunEntry,
  type DocumentChunks,
  type QuestionPassage,
  type RetrievalTrace,
  type UsageSummary,
} from '@docs-rag-lab/contracts'

import evalCompare from './__fixtures__/eval-compare.json'
import evalDetailsRerank from './__fixtures__/eval-details-m5-answers.json'
import evalDetails from './__fixtures__/eval-details-final.json'
import evalBaseline from './__fixtures__/eval-run-baseline.json'
import evalFinal from './__fixtures__/eval-run-final.json'
import evalFirst from './__fixtures__/eval-run-first.json'
import evalRerank from './__fixtures__/eval-run-m5-answers.json'
import evalRuns from './__fixtures__/eval-runs.json'
import citationAfterCodeNdjson from './__fixtures__/answer-first-citation-moved-after-code.derived.ndjson?raw'
import satisfiesHowNdjson from './__fixtures__/answer-satisfies-how.ndjson?raw'
import answerNdjson from './__fixtures__/answer-satisfies.ndjson?raw'
import tableAnswerNdjson from './__fixtures__/answer-table.ndjson?raw'
import varianceNdjson from './__fixtures__/answer-variance.ndjson?raw'
import documentTs49 from './__fixtures__/document-ts-4-9.json'
import interviewCompiler from './__fixtures__/interview-compiler-questions.json'
import interviewPassages from './__fixtures__/interview-passage-cards.json'
import interviewWritten from './__fixtures__/interview-written-questions.json'
import satisfiesRerank from './__fixtures__/trace-satisfies-rerank.json'
import satisfiesVector from './__fixtures__/trace-satisfies-vector.json'
import satisfies from './__fixtures__/trace-satisfies.json'
import ts0004 from './__fixtures__/trace-ts-0004.json'
import ts2345 from './__fixtures__/trace-ts2345.json'
import { appendCitations, appendText, type AnswerPart } from './lib/answer.ts'

/** The dashboard's real data, from the committed reports. It holds no docs text. */
export const evalFixtures = {
  runs: evalRuns as DashboardRunEntry[],
  /** The final report: calibrated, with the known bias. */
  final: evalFinal as DashboardRun,
  /** The first report, under the old prompt: it missed the bar. */
  first: evalFirst as DashboardRun,
  /** A report with no answers. */
  baseline: evalBaseline as DashboardRun,
  /** The report with the reranker's rows, whose first screen shows three columns. */
  rerank: evalRerank as DashboardRun,
  details: evalDetails as DashboardDetails,
  detailsRerank: evalDetailsRerank as DashboardDetails,
  compare: evalCompare as DashboardRunComparison,
}

export const traces = {
  /** "In which version did `satisfies` appear?": BM25 counts `satisfies` twice. */
  satisfies: satisfies as RetrievalTrace,
  /** The same question with vector search only. */
  satisfiesVector: satisfiesVector as RetrievalTrace,
  /** The same question, hybrid and then the reranker, from the cache of a real run. */
  satisfiesRerank: satisfiesRerank as RetrievalTrace,
  /** "What does error TS2345 mean?": the exact list rescues the error code. */
  ts2345: ts2345 as RetrievalTrace,
  /** ts-0004, a Russian question about `unknown` and `any`. */
  ts0004: ts0004 as RetrievalTrace,
}

/** The chunks of TypeScript 4.9.md, where two `satisfies` candidates live. */
export const documentFixture = documentTs49 as DocumentChunks

function decode(ndjson: string): AnswerEvent[] {
  const decoder = new EventDecoder()
  return [...decoder.push(ndjson), ...decoder.end()]
}

function summarize(all: readonly AnswerEvent[]) {
  let parts: AnswerPart[] = []
  const citations: Citation[] = []
  let usage: UsageSummary | undefined
  for (const event of all) {
    if (event.type === 'text') parts = appendText(parts, event.text)
    else if (event.type === 'citations') {
      parts = appendCitations(parts, event.numbers)
      citations.push(...event.citations)
    } else if (event.type === 'done') usage = event.usage
  }
  if (usage === undefined) throw new Error('the answer fixture has no done event')
  return { parts, citations, usage }
}

function answer(ndjson: string) {
  const events = decode(ndjson)
  return { events, ...summarize(events) }
}

/** The recorded answer to the `satisfies` question: its events, and what they add up to. */
export const answerFixture = answer(answerNdjson)

/**
 * An agentic answer (ADR-0019), made up from recorded parts and not recorded itself: the
 * `satisfies` answer, with one search of Claude's own between its trace and its text. That search
 * waited for Voyage's rate limit and came back with the TS2345 trace, given the search's query
 * and doc types. Its chunks are that trace's, of every doc type, and none of them was in the first
 * search, so all 8 are new. A last sentence cites the first of them, so a citation can open the
 * inspector on the search it came from.
 */
export const agenticFixture = (() => {
  const [first, ...rest] = answerFixture.events
  const done = rest.at(-1)
  const own = traces.ts2345.context[0]
  const query = 'checkJs errors in JavaScript files'
  const docTypes = ['option']
  if (first?.type !== 'trace' || done?.type !== 'done' || own === undefined) {
    throw new Error('the agentic fixture needs a trace first, done last and a chunk to cite')
  }
  const number = answerFixture.citations.length + 1
  const events: AnswerEvent[] = [
    first,
    { type: 'search', query, docTypes },
    { type: 'wait', ms: 41_200 },
    {
      type: 'searched',
      found: traces.ts2345.context.length,
      alreadyShown: 0,
      trace: { ...traces.ts2345, question: query, filters: { docTypes } },
    },
    ...rest.slice(0, -1),
    { type: 'text', text: ' The option `checkJs` reports errors in JavaScript files.' },
    {
      type: 'citations',
      numbers: [number],
      citations: [
        {
          number,
          source: own.source,
          title: own.title,
          citedText: 'Enable error reporting in type-checked JavaScript files.',
          chunkId: own.chunkId,
          // After the first search's chunks: the conversation numbers its chunks in order.
          contextRank: first.trace.context.length + 1,
        },
      ],
    },
    done,
  ]
  return { events, ...summarize(events) }
})()

/** A recorded answer with a GFM table with cited cells, then two code blocks. */
export const tableAnswerFixture = answer(tableAnswerNdjson)

/** "How does the `satisfies` operator work?": two sources from one section, one a whole code fence. */
export const satisfiesHowFixture = answer(satisfiesHowNdjson)

/** On optional variance annotations: three chunks of one section, and emphasis in an excerpt. */
export const varianceFixture = answer(varianceNdjson)

/**
 * The one fixture whose events are not in the order Claude sent them. NDJSON has no
 * comments, so this says what changed: a real answer about `--strict`, with one event
 * moved. Like the others, it also has the current trace shape and cut excerpts.
 *
 * Which: its first `citations` event (source 1), from index 18, after the text
 * "...so you can still control them individually.", to index 8, right after the text
 * event that closes the code block. Nothing else differs.
 *
 * Why: the bug this reproduces needs a citation that ends on a closing fence. That
 * depends on how Claude splits citation blocks: it happened in a live run, but five
 * recording attempts did not reproduce it.
 */
export const citationAfterCodeFixture = answer(citationAfterCodeNdjson)

/**
 * The interview app's questions (ADR-0018). The compiler questions are real, from
 * interview/bank/typescript.jsonl: one on errors, one with a setup the site hides, and one on a
 * type. The theory and pitfall questions are written by hand until the bank's paid run: their
 * quotes, code and citations are real docs text, cut to 300 characters.
 */
function nth(list: unknown, index: number): BankQuestion {
  const question = (list as BankQuestion[])[index]
  if (question === undefined) throw new Error(`no interview fixture at ${String(index)}`)
  return question
}

export const interviewQuestions = {
  compilerError: nth(interviewCompiler, 0),
  withSetup: nth(interviewCompiler, 1),
  compilerType: nth(interviewCompiler, 2),
  theory: nth(interviewWritten, 0),
  pitfall: nth(interviewWritten, 1),
}

/**
 * Two generated questions from the bank, with the passage the app cuts for each from its index
 * (ADR-0018): the section of its chunk the quote is in. On strictNullChecks, the card the owner
 * found linked to the wrong section and backed by half a quote; on PureComponent, a passage of
 * three blocks with the quote in the middle one, and links relative to its page.
 */
export const interviewPassageCards = interviewPassages as unknown as {
  question: BankQuestion
  passage: QuestionPassage
}[]
