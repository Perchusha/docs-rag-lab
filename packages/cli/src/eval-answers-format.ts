// What answer metrics print, and the markdown of a report that has them. Like the rest of
// a report's markdown, this quotes neither the docs nor Claude (ADR-0010), except for the
// labelling sheet, which is the one file meant to be read with the answers in it, and which
// goes under dev/, where git does not see it.
import type {
  AnswerComparison,
  AnswerDifference,
  AnswerMetrics,
  AnswerRowResult,
  EvalAnswer,
  EvalAnswers,
  EvalCalibration,
  EvalSpotCheck,
} from '@docs-rag-lab/contracts'
import type { EvalCostEstimate, GoldenQuestion, JudgeCaseResult } from '@docs-rag-lab/core'

const mean = (value: number): string => value.toFixed(3)
const usd = (value: number): string => `$${value.toFixed(4)}`
const count = (value: number): string => Math.round(value).toLocaleString('en-US')

function table(header: readonly string[], rows: readonly (readonly string[])[]): string {
  const line = (cells: readonly string[]): string =>
    `| ${cells.map((text) => text.replaceAll('|', '\\|')).join(' | ')} |`
  return [line(header), line(header.map(() => '---')), ...rows.map(line)].join('\n')
}

export function formatCostEstimate(estimate: EvalCostEstimate, maxUsd: number): string {
  const { answers, judge, agent } = estimate
  const lines = [
    'estimate, at list prices checked ' + estimate.pricesChecked + ':',
    `  answers: ${String(answers.calls)} (${String(answers.cached)} cached), ${count(answers.inputTokens)} in by count_tokens, about ${count(answers.outputTokens)} out, ${usd(answers.usd)}`,
    ...(agent === undefined
      ? []
      : [
          `  row 6: ${String(agent.calls)} answers (${String(agent.cached)} cached), at ${agent.searchesPerAnswer.toFixed(2)} searches of its own an answer${agent.assumedSearches ? ', assumed until 5 first steps are cached' : ''}: about ${count(agent.inputTokens)} in, each part written to the cache once and read by the steps after it, and ${count(agent.outputTokens)} out, ${usd(agent.usd)}; ${usd(agent.upToUsd)} if every answer used every search`,
        ]),
    `  judge: ${String(judge.calls)} calls (${String(judge.cached)} cached), about ${count(judge.inputTokens)} in and ${count(judge.outputTokens)} out, ${usd(judge.usd)}`,
    `  total: about ${usd(estimate.usd)}, against a limit of $${maxUsd.toFixed(2)}`,
  ]
  if (estimate.assumed) {
    lines.push(
      '  output sizes are assumptions until 5 calls of a kind are cached: run a pilot first',
    )
  }
  return lines.join('\n')
}

const rowName = (row: AnswerRowResult): string =>
  `row ${String(row.row)}${row.sample > 1 ? ' again' : ''}`

function correctRow(label: string, metrics: AnswerMetrics): string[] {
  const { citationAccuracy: accuracy, support } = metrics
  return [
    label,
    String(metrics.questions),
    mean(metrics.correctness),
    metrics.scores.map(String).join(' / '),
    String(metrics.falseRefusals),
    accuracy.cited === 0 ? '-' : `${String(accuracy.hit)} of ${String(accuracy.cited)}`,
    support.claims === 0 ? '-' : `${String(support.supported)} of ${String(support.claims)}`,
  ]
}

const CORRECT_HEADER = [
  'Row',
  'Questions',
  'Correctness, 0-2',
  'Scored 0 / 1 / 2',
  'False refusals',
  'Cites an anchor',
  'Claims supported',
]

const VERDICT_TEXT: Record<AnswerDifference['verdict'], string> = {
  a: 'first better',
  b: 'second better',
  noise: 'noise',
  'not-significant': 'not significant',
  mixed: 'mixed',
  'too-few': 'too few to say',
}

function verdictText(difference: AnswerDifference, comparison: AnswerComparison): string {
  if (difference.verdict === 'a') return `${comparison.a} better`
  if (difference.verdict === 'b') return `${comparison.b} better`
  return VERDICT_TEXT[difference.verdict]
}

function comparisonSection(comparison: AnswerComparison): string[] {
  return [
    `### ${comparison.a} against ${comparison.b}`,
    table(
      [
        'Scope',
        'Questions',
        'Metric',
        comparison.a,
        comparison.b,
        `${comparison.a} better on`,
        `${comparison.b} better on`,
        'Tied',
        'p',
        'Verdict',
      ],
      comparison.scopes.flatMap((scope) =>
        scope.differences.map((difference) => [
          scope.scope,
          // Citation metrics compare only the questions where both sides cite something.
          String(difference.aBetter + difference.bBetter + difference.tied),
          difference.metric === 'correct-and-grounded'
            ? 'correct-and-grounded (exploratory)'
            : difference.metric,
          mean(difference.a),
          mean(difference.b),
          String(difference.aBetter),
          String(difference.bBetter),
          String(difference.tied),
          difference.p.toFixed(3),
          verdictText(difference, comparison),
        ]),
      ),
    ),
  ]
}

/** Defined after seeing the first results, so it says so wherever it appears (ADR-0012). */
function exploratorySection(rows: readonly AnswerRowResult[]): string[] {
  // A report from before the metric has no number for it, which is not a count of none.
  if (rows.every((row) => row.overall.correctAndGrounded === undefined)) return []
  return [
    '### Correct and grounded (exploratory)',
    'Exploratory: this metric was defined after seeing the first results, and it is no target. An answer counts when it scores 2, every claim it cites is supported, and at least one cited chunk is a primary or acceptable anchor. Row 0 cannot score on it by design, so it shows what retrieval adds beyond memory.',
    table(
      ['Row', 'Questions', 'Correct and grounded'],
      rows.map((row) => [
        rowName(row),
        String(row.overall.questions),
        row.row === 0 ? '-' : String(row.overall.correctAndGrounded ?? '-'),
      ]),
    ),
  ]
}

const yesNo = (value: boolean | null): string => (value === null ? '-' : value ? 'yes' : 'no')

/** Cyrillic letters in a query of Claude's own: counted, never quoted. */
const CYRILLIC = /[Ѐ-ӿ]/

/**
 * Row 6's searches, steps and caching (ADR-0019). It counts the queries in Cyrillic and does not
 * quote them: they are Claude's words, and the JSON keeps them.
 */
function agentSection(answers: EvalAnswers): string[] {
  const rows = answers.rows.flatMap((row) =>
    row.agent === undefined ? [] : [{ row, ...row.agent }],
  )
  if (rows.length === 0) return []
  const scoreOf = (questionId: string, row: number, sample: number): string => {
    const found = answers.verdicts.find(
      (verdict) =>
        verdict.questionId === questionId &&
        verdict.row === row &&
        verdict.sample === sample &&
        verdict.judgeSample === 1,
    )
    if (found?.status !== 'ok') return '-'
    return found.correctness === null ? (found.outcome ?? '-') : String(found.correctness)
  }
  const cyrillic = (row: AnswerRowResult): number =>
    answers.answers
      .filter((answer) => answer.row === row.row && answer.sample === row.sample)
      .flatMap((answer) => answer.searches ?? [])
      .filter((search) => CYRILLIC.test(search.query)).length
  const first = rows.find(({ row }) => row.sample === 1)
  return [
    '### Agentic mode, row 6',
    "Each step of row 6 resends the conversation so far, with automatic prompt caching (ADR-0019). Its input is counted three ways: neither written nor read, written to the cache, and read from it. Without caching prices the same tokens at the input price. A lapse is a step after the first that read nothing cached although the step before wrote. The queries are in the report's JSON, as Claude wrote them.",
    table(
      [
        'Row',
        'Answers',
        'Searched again',
        'Searches',
        'In Cyrillic',
        'Steps',
        'Input, not cached',
        'Cache writes',
        'Cache reads',
        'Output',
        'Cost',
        'Without caching',
        'Lapses',
        'First steps that read the cache',
      ],
      rows.map((item) => [
        rowName(item.row),
        String(item.answers),
        String(item.searchedAgain),
        String(item.searches),
        String(cyrillic(item.row)),
        String(item.steps),
        count(item.inputTokens),
        count(item.cacheWriteTokens),
        count(item.cacheReadTokens),
        count(item.outputTokens),
        usd(item.costUsd),
        usd(item.uncachedCostUsd),
        String(item.lapses),
        String(item.firstStepReads),
      ]),
    ),
    table(
      ['Row', 'Answerable', 'A primary anchor in the first search', 'A primary anchor reached'],
      rows.map((item) => [
        rowName(item.row),
        String(item.answerable),
        String(item.primaryInFirstSearch),
        String(item.primaryReached),
      ]),
    ),
    ...(first === undefined
      ? []
      : [
          '#### Row 6 by question, first answers',
          table(
            [
              'Question',
              'Steps',
              'Searches',
              'Primary anchor, first search',
              'Primary anchor, reached',
              'Row 3',
              'Row 6',
            ],
            first.questions.map((question) => [
              question.questionId,
              String(question.steps),
              String(question.searches),
              yesNo(question.primaryInFirstSearch),
              yesNo(question.primaryReached),
              scoreOf(question.questionId, 3, 1),
              scoreOf(question.questionId, 6, 1),
            ]),
          ),
        ]),
  ]
}

/** The answer sections of a report's markdown. */
export function answerSections(answers: EvalAnswers, judgeLine: string): string[] {
  const { rows } = answers
  const { contextualIndex, compiledIndex } = answers
  const sections = [
    '## Answers',
    `Answered by \`${answers.models.answer}\`, judged by \`${answers.models.judge}\`, which does not know the row. This run paid ${usd(answers.paidUsd)} at list prices. ${judgeLine}`,
    ...(contextualIndex === undefined
      ? []
      : [
          `The retrieval above is of the plain index. Row ${contextualIndex.rows.join(', ')} read the contextual index instead, with contexts from \`${contextualIndex.contextModel}\` and chunks \`${contextualIndex.chunksHash.slice(0, 12)}\`, and its retrieval has a report of its own.`,
        ]),
    ...(compiledIndex === undefined
      ? []
      : [
          `The retrieval above is of the plain index. Row ${compiledIndex.rows.join(', ')} read the compiled index instead, written by \`${compiledIndex.compiler}\`, with chunks \`${compiledIndex.chunksHash.slice(0, 12)}\` (ADR-0017).`,
        ]),
    table(
      CORRECT_HEADER,
      rows.map((row) => correctRow(rowName(row), row.overall)),
    ),
    '### The questions the docs do not answer',
    table(
      ['Row', 'Questions', 'Correct refusals', 'Hallucinations', 'Wrong'],
      rows.map((row) => [
        rowName(row),
        String(row.refusals.questions),
        String(row.refusals.correct),
        String(row.refusals.hallucinations),
        String(row.refusals.wrong),
      ]),
    ),
    ...exploratorySection(rows),
    '### Latency and cost per question',
    table(
      ['Row', 'Latency, mean', 'Input tokens', 'Output tokens', 'Cost'],
      rows.map((row) => [
        rowName(row),
        `${(row.overall.meanLatencyMs / 1000).toFixed(1)} s`,
        count(row.overall.meanInputTokens),
        count(row.overall.meanOutputTokens),
        usd(row.overall.meanCostUsd),
      ]),
    ),
    ...agentSection(answers),
    '### Per tag',
    table(
      ['Tag', ...CORRECT_HEADER],
      [...new Set(rows.flatMap((row) => Object.keys(row.byTag)))].sort().flatMap((tag) =>
        rows.flatMap((row) => {
          const metrics = row.byTag[tag]
          return metrics === undefined ? [] : [[tag, ...correctRow(rowName(row), metrics)]]
        }),
      ),
    ),
    ...answers.comparisons.flatMap(comparisonSection),
  ]
  if (answers.judgeRetest !== null) {
    const { agreed, compared } = answers.judgeRetest
    sections.push(
      `The judge, asked twice about the same answers, gave the same grade on ${String(agreed)} of ${String(compared)}.`,
    )
  }
  for (const row of rows) {
    const { truncated, refused, failed, unjudged } = row.excluded
    const parts = [
      ...(unjudged.length > 0 ? [`not judged: ${unjudged.join(', ')}`] : []),
      ...(truncated.length > 0 ? [`truncated: ${truncated.join(', ')}`] : []),
      ...(refused.length > 0 ? [`stopped by a classifier: ${refused.join(', ')}`] : []),
      ...(failed.length > 0 ? [`failed: ${failed.join(', ')}`] : []),
    ]
    if (parts.length > 0) sections.push(`Left out of ${rowName(row)}, ${parts.join('; ')}.`)
  }
  if (answers.candidates.length > 0) {
    sections.push(
      '### Cited chunks to review as anchors',
      'The judge found these cited chunks support a correct answer, and they are not anchors. None is added automatically (ADR-0009).',
      table(
        ['Question', 'Row', 'Chunk', 'Document'],
        answers.candidates.map((candidate) => [
          candidate.questionId,
          String(candidate.row),
          candidate.chunkId,
          candidate.docPath,
        ]),
      ),
    )
  }
  return sections
}

/** What a run prints. */
export function formatAnswersSummary(answers: EvalAnswers, judgeLine: string): string {
  return [
    `paid ${usd(answers.paidUsd)} at list prices`,
    judgeLine,
    ...answers.rows.map((row) => {
      const { questions, correctness, falseRefusals } = row.overall
      const { correct, hallucinations, wrong } = row.refusals
      return `${rowName(row)}: correctness ${mean(correctness)} over ${String(questions)}, ${String(falseRefusals)} false refusals; unanswerable: ${String(correct)} refused, ${String(hallucinations)} hallucinated, ${String(wrong)} wrong`
    }),
  ].join('\n')
}

/** The sheet a human labels from. It holds no verdicts, no scores and no row numbers. */
export function formatLabelSheet(
  sample: readonly EvalAnswer[],
  questions: ReadonlyMap<string, GoldenQuestion>,
  hash: string,
  options: { correctnessOnly?: boolean } = {},
): string {
  const correctnessOnly = options.correctnessOnly === true
  // The question ID stays out too: it says nothing to a human, and the labels use item numbers.
  const items = sample.map((answer, i) => {
    const question = questions.get(answer.questionId)
    if (question === undefined) throw new Error(`no question ${answer.questionId}`)
    const unanswerable = question.tags.includes('unanswerable')
    const claims = (correctnessOnly ? [] : answer.claims).flatMap((claim, claimIndex) => [
      `Claim ${String(claimIndex + 1)}: ${claim.text.trim()}`,
      ...claim.citations.map((citation) => `> ${citation.citedText.trim()}`),
      '',
    ])
    return [
      `## Item ${String(i + 1)}`,
      `**Question:** ${question.question}`,
      `**Expert answer:** ${question.answer}`,
      ...(question.note === undefined ? [] : [`**Note:** ${question.note}`]),
      `**The answer to grade:**\n\n${answer.text.trim() === '' ? '(empty)' : answer.text.trim()}`,
      ...(correctnessOnly
        ? []
        : claims.length === 0
          ? ['**Cites nothing.**']
          : ['**What it cites:**', '', ...claims]),
      unanswerable
        ? '**Label:** the docs do not answer this. correct-refusal, hallucination or wrong?'
        : correctnessOnly
          ? '**Label:** correctness 0, 1 or 2?'
          : '**Label:** correctness 0, 1 or 2? Add "refused" if it says the docs do not cover this, or declines to answer.',
      ...(claims.length === 0 ? [] : ['Is every cited claim supported by its passages? yes or no']),
    ].join('\n\n')
  })
  if (correctnessOnly) {
    return [
      '# Labels for the judge, a fresh round',
      `Sample \`${hash}\`. Grade each answer without looking at any report. Only correctness counts here, so the citations are left out.`,
      '- **Correctness, on what the question asks:** 2 is correct and gives everything asked. 1 has the main point right with any part of what is asked missing or wrong, however small. 0 has the main point wrong, or is empty or a refusal. Details the question did not ask for do not count either way.',
      ...items,
    ].join('\n\n')
  }
  return [
    '# Labels for the judge',
    `Sample \`${hash}\`. Grade each answer without looking at the report: the judge has graded these too, and this measures how often you agree. Reply with the item number and your labels.`,
    '- **Correctness, on what the question asks:** 2 is correct and gives everything asked. 1 has the main point right with any part of what is asked missing or wrong, however small. 0 has the main point wrong, or is empty or a refusal. Details the question did not ask for do not count either way.',
    '- **A question the docs do not answer:** correct-refusal says so, or rejects the false premise, and cites nothing for an answer. It may add general knowledge that it marks as not from the docs. hallucination names a version, describes a made-up option as real, or presents outside knowledge as from the docs. wrong is anything else.',
    `- **Refused, on a question the docs do answer:** it says the docs do not cover this, or declines to answer. That is a refusal the question did not call for, and it scores 0. Your count of these goes against the judge across all ${String(sample.length)} answers.`,
    '- **Supported:** a reader could confirm each cited claim from its passages alone.',
    ...items,
  ].join('\n\n')
}

/**
 * What a spot check found (ADR-0016). It decides nothing for any other report. A fresh one names
 * the report whose spot check it shows nothing of (ADR-0017).
 */
export function formatSpotCheck(spot: EvalSpotCheck, after?: string): string {
  const disagreements = spot.correctnessDisagreements.map(
    ({ questionId, row, human, judge }) =>
      `- ${questionId}, row ${String(row)}: human ${String(human)}, judge ${String(judge)}`,
  )
  return `${[
    `# Judge spot check: ${String(spot.labelled)} answers labelled`,
    `Report: \`${spot.report.repoSha.slice(0, 8)}\`, ${spot.report.name ?? 'development run'}, ${spot.report.createdAt}. It allows ${String(spot.allowed)} disagreement on each dimension it compares (ADR-0016), and it is no calibration round: it decides nothing for any other report.`,
    ...(after === undefined
      ? []
      : [
          `A fresh spot check, on answers that the spot check of \`${after}\` did not show, chosen without reading any of this report's verdicts (ADR-0017).`,
        ]),
    table(
      ['Dimension', 'Agreed', 'Compared', "Cohen's kappa", '95% interval', 'Passed'],
      spot.agreement.map((result) => [
        result.dimension,
        String(result.agreed),
        String(result.compared),
        result.kappa === null ? '-' : result.kappa.toFixed(2),
        `${(result.interval[0] * 100).toFixed(0)}% to ${(result.interval[1] * 100).toFixed(0)}%`,
        result.passed ? 'yes' : 'no',
      ]),
    ),
    ...(disagreements.length === 0
      ? []
      : ['Disagreements on correctness:', disagreements.join('\n')]),
    ...(spot.supportDisagreements.length === 0
      ? []
      : [
          'Disagreements on citations:',
          spot.supportDisagreements
            .map(
              ({ questionId, row, human, judge }) =>
                `- ${questionId}, row ${String(row)}: human ${human ? 'supported' : 'unsupported'}, judge ${judge ? 'supported' : 'unsupported'}`,
            )
            .join('\n'),
        ]),
    spot.passed
      ? 'This spot check passed.'
      : 'This spot check missed, so the work stops and the owner is asked (ADR-0016).',
  ].join('\n\n')}\n`
}

export function formatCalibration(calibration: EvalCalibration): string {
  return [
    `# Judge calibration: ${String(calibration.labelled)} answers labelled`,
    `Report: \`${calibration.report.repoSha.slice(0, 8)}\`, ${calibration.report.name ?? 'development run'}, ${calibration.report.createdAt}. The bar is 13 of 15 on each dimension (ADR-0012).`,
    ...(calibration.blind === false
      ? [
          '**Not blind.** The judge was graded again under a changed prompt after these labels were read, so this decides nothing about how far to trust it.',
        ]
      : []),
    ...(calibration.agreement.length === 1
      ? ['A fresh round: correctness alone, with at most 1 disagreement in 10.']
      : []),
    table(
      ['Dimension', 'Agreed', 'Compared', "Cohen's kappa", '95% interval', 'Passed'],
      calibration.agreement.map((result) => [
        result.dimension,
        String(result.agreed),
        String(result.compared),
        result.kappa === null ? '-' : result.kappa.toFixed(2),
        `${(result.interval[0] * 100).toFixed(0)}% to ${(result.interval[1] * 100).toFixed(0)}%`,
        result.passed ? 'yes' : 'no',
      ]),
    ),
    ...(calibration.agreement.some(({ dimension }) => dimension === 'refusal')
      ? [
          `Refusal covers every answer: whether it refused, and whether that was right. On the unanswerable questions alone, the three outcomes agree on ${String(calibration.unanswerableOnly.agreed)} of ${String(calibration.unanswerableOnly.compared)}. That is too little data, so it decides nothing.`,
        ]
      : []),
    calibration.blind === false
      ? 'Reported for comparison only.'
      : calibration.calibrated
        ? 'This round reached the bar on what it measured.'
        : 'This round did not reach the bar, so what it measured stays uncalibrated.',
  ]
    .join('\n\n')
    .concat('\n')
}

export function formatJudgeCheck(results: readonly JudgeCaseResult[]): string {
  const failed = results.filter((result) => !result.passed)
  return [
    ...results.map(
      (result) =>
        `${result.passed ? 'ok    ' : 'WRONG '} ${result.name}: ${result.got}${result.passed ? '' : `, expected ${result.expected}`}`,
    ),
    failed.length === 0
      ? `the judge got all ${String(results.length)} known cases right`
      : `the judge got ${String(failed.length)} of ${String(results.length)} known cases wrong`,
  ].join('\n')
}
