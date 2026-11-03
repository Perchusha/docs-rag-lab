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
  const { answers, judge } = estimate
  const lines = [
    'estimate, at list prices checked ' + estimate.pricesChecked + ':',
    `  answers: ${String(answers.calls)} (${String(answers.cached)} cached), ${count(answers.inputTokens)} in by count_tokens, about ${count(answers.outputTokens)} out, ${usd(answers.usd)}`,
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
  return [
    '### Correct and grounded (exploratory)',
    'Exploratory: this metric was defined after seeing the first results, and it is no target. An answer counts when it scores 2, every claim it cites is supported, and at least one cited chunk is a primary or acceptable anchor. Row 0 cannot score on it by design, so it shows what retrieval adds beyond memory.',
    table(
      ['Row', 'Questions', 'Correct and grounded'],
      rows.map((row) => [
        rowName(row),
        String(row.overall.questions),
        row.row === 0 ? '-' : String(row.overall.correctAndGrounded ?? 0),
      ]),
    ),
  ]
}

/** The answer sections of a report's markdown. */
export function answerSections(answers: EvalAnswers): string[] {
  const { rows } = answers
  const sections = [
    '## Answers',
    `Answered by \`${answers.models.answer}\`, judged by \`${answers.models.judge}\`, which does not know the row. This run paid ${usd(answers.paidUsd)} at list prices. The judge is not calibrated until a human has labelled a sample of these answers (\`drl eval label\`).`,
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
export function formatAnswersSummary(answers: EvalAnswers): string {
  return [
    `paid ${usd(answers.paidUsd)} at list prices`,
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
    '- **Refused, on a question the docs do answer:** it says the docs do not cover this, or declines to answer. That is a refusal the question did not call for, and it scores 0. Your count of these goes against the judge across all 15 answers.',
    '- **Supported:** a reader could confirm each cited claim from its passages alone.',
    ...items,
  ].join('\n\n')
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
        ? 'The judge is calibrated for this report.'
        : 'The judge did not reach the bar, so the answer metrics in this report are uncalibrated.',
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
