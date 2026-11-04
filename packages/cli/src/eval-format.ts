// How an eval report reads: the markdown next to the JSON, and what the commands
// print. Primary anchors come first, because they are the headline (ADR-0009). The
// markdown is checked for em dashes, so it holds question IDs, numbers and document
// paths, never chunk labels, pinned passages or anything else written by the docs or
// by Claude.
import {
  COMPARED_METRICS,
  HIT_CUTOFFS,
  type ComparedMetric,
  type EvalComparison,
  type EvalMetrics,
  type EvalReport,
  type EvalStrategyResult,
  type MetricDifference,
  type ScopeComparison,
} from '@docs-rag-lab/contracts'
import { CONTEXT_CUTOFF, type EvalVerification } from '@docs-rag-lab/core'

const mean = (value: number): string => value.toFixed(3)
const rank = (value: number | null): string => (value === null ? '-' : String(value))

function table(header: readonly string[], rows: readonly (readonly string[])[]): string {
  const cell = (text: string): string => text.replaceAll('|', '\\|')
  const line = (cells: readonly string[]): string => `| ${cells.map(cell).join(' | ')} |`
  return [line(header), line(header.map(() => '---')), ...rows.map(line)].join('\n')
}

function metricsRow(label: string, metrics: EvalMetrics): string[] {
  return [
    label,
    String(metrics.questions),
    ...HIT_CUTOFFS.map((k) => String(metrics.primary.hits[k])),
    mean(metrics.recallAt8),
    mean(metrics.primary.mrr),
  ]
}

function acceptableRow(label: string, metrics: EvalMetrics): string[] {
  return [
    label,
    String(metrics.questions),
    ...HIT_CUTOFFS.map((k) => String(metrics.withAcceptable.hits[k])),
    mean(metrics.withAcceptable.mrr),
  ]
}

const HITS_HEADER = HIT_CUTOFFS.map((k) => `hit@${String(k)}`)

function verdictLabel(difference: MetricDifference, comparison: EvalComparison): string {
  switch (difference.verdict) {
    case 'a':
      return `${comparison.a} better`
    case 'b':
      return `${comparison.b} better`
    case 'noise':
      return 'noise'
    case 'not-significant':
      return 'not significant'
    case 'mixed':
      return 'mixed: more wins, not a higher total'
    case 'too-few':
      return 'too few to say'
  }
}

function metricValue(metric: ComparedMetric, value: number): string {
  return metric === 'recall@8' || metric === 'mrr' ? mean(value) : String(value)
}

function differenceRow(difference: MetricDifference, comparison: EvalComparison): string[] {
  return [
    difference.metric,
    metricValue(difference.metric, difference.a),
    metricValue(difference.metric, difference.b),
    String(difference.aBetter),
    String(difference.bBetter),
    String(difference.tied),
    mean(difference.p),
    verdictLabel(difference, comparison),
  ]
}

function differenceHeader(comparison: EvalComparison): string[] {
  return [
    'Metric',
    comparison.a,
    comparison.b,
    `${comparison.a} better on`,
    `${comparison.b} better on`,
    'Tied',
    'p',
    'Verdict',
  ]
}

function scopeOf(comparison: EvalComparison, name: string): ScopeComparison | undefined {
  return comparison.scopes.find((scope) => scope.scope === name)
}

export const NOISE_NOTE =
  'Compared question by question with an exact sign test. A difference of one or two questions is noise. Above that, p >= 0.05 is not significant: the smallest splits that are significant are 6:0, 8:1, 10:2, 12:3, 13:4 and 15:5, so a gain of 5 questions with no losses does not reach it. Mixed means the side that won more questions does not have the higher total. A tag with 5 questions or fewer cannot reach significance. With this many tags and metrics, one low p is not proof on its own.'

function comparisonSection(comparison: EvalComparison): string[] {
  const overall = scopeOf(comparison, 'overall')
  if (overall === undefined) return []
  const tagged = comparison.scopes.filter((scope) => scope.scope !== 'overall')
  // Per tag, the three figures that say most about what reaches the answer.
  const perTag = tagged.flatMap((scope) =>
    (['hit@1', 'hit@8', 'mrr'] as const).flatMap((name) => {
      const difference = scope.primary.find(({ metric }) => metric === name)
      return difference === undefined
        ? []
        : [[scope.scope, String(scope.questions), ...differenceRow(difference, comparison)]]
    }),
  )
  return [
    `## ${comparison.a} against ${comparison.b}, primary anchors`,
    NOISE_NOTE,
    table(
      differenceHeader(comparison),
      COMPARED_METRICS.flatMap((name) => {
        const difference = overall.primary.find(({ metric }) => metric === name)
        return difference === undefined ? [] : [differenceRow(difference, comparison)]
      }),
    ),
    '### Per tag',
    table(['Tag', 'Questions', ...differenceHeader(comparison)], perTag),
    `## ${comparison.a} against ${comparison.b}, with acceptable anchors (secondary)`,
    table(
      differenceHeader(comparison),
      overall.withAcceptable.map((difference) => differenceRow(difference, comparison)),
    ),
  ]
}

function perQuestionTable(strategies: readonly EvalStrategyResult[]): string {
  const [first] = strategies
  if (first === undefined) return ''
  const score = (strategy: EvalStrategyResult, id: string) =>
    strategy.questions.find((question) => question.id === id)
  return table(
    [
      'Question',
      'Tags',
      ...strategies.map(({ strategy }) => `${strategy}, primary`),
      ...strategies.map(({ strategy }) => `${strategy}, with acceptable`),
      ...strategies.map(({ strategy }) => `${strategy}, recall@8`),
    ],
    first.questions.map(({ id, tags }) => [
      id,
      tags.join(', '),
      ...strategies.map((strategy) => rank(score(strategy, id)?.primaryRank ?? null)),
      ...strategies.map((strategy) => rank(score(strategy, id)?.acceptableRank ?? null)),
      ...strategies.map((strategy) => mean(score(strategy, id)?.recallAt8 ?? 0)),
    ]),
  )
}

/** An anchor without its pin: a pin is a passage of the docs, and this file quotes none. */
function withoutPin(anchor: string): string {
  return anchor.split(' contains ')[0] ?? anchor
}

function yesNo(met: boolean | null): string {
  if (met === null) return 'did not run'
  return met ? 'yes' : 'no'
}

/** The report as a reader wants it. The JSON next to it holds everything else. */
/** What the reranks took, for a report that has them. A run that survived 429s says so. */
function rerankUsage({ run }: EvalReport): string | undefined {
  if (run.rerank === undefined) return undefined
  const { calls, rateLimitRetries } = run.rerank
  return rateLimitRetries === 0
    ? `${String(calls)} calls, none retried after a 429`
    : `${String(calls)} calls, which survived ${String(rateLimitRetries)} 429s with one retry each`
}

export function formatEvalMarkdown(report: EvalReport): string {
  const { identity, result, run, vectors } = report
  const { strategies, comparison, targets } = result
  const names = strategies.map(({ strategy }) => strategy)
  const tags = [...new Set(strategies.flatMap(({ byTag }) => Object.keys(byTag)))].sort()
  const title = run.name ?? 'development run'
  const settings = Object.entries(identity.retrieval)
    .map(([key, value]) => `${key} ${String(value)}`)
    .join(', ')
  const sections = [
    `# Eval report: ${title}`,
    table(
      ['', ''],
      [
        ['Source', identity.sourceId],
        ['Docs', `${identity.docs.repo}, branch ${identity.docs.branch}, \`${identity.docs.sha}\``],
        ['Repository', `\`${run.repoSha}\`${run.repoDirty ? ', with uncommitted changes' : ''}`],
        ['Created', run.createdAt],
        [
          'Golden set',
          `version ${String(identity.goldenSet.version)}, \`${identity.goldenSet.hash.slice(0, 12)}\``,
        ],
        [
          'Questions',
          `${String(result.scored)} scored, ${String(result.unanswerable.length)} unanswerable left out, ${String(result.stale.length)} stale, ${String(result.review.length)} to review`,
        ],
        [
          'Index',
          `chunker ${String(identity.chunkerVersion)}, parser ${String(identity.parserVersion ?? 'none')}, schema ${String(identity.indexSchema)}, \`${identity.embedModel}\`, context \`${identity.contextModel ?? 'none'}\``,
        ],
        ['Retrieval', `version ${String(identity.retrievalVersion)}: ${settings}`],
        ...(identity.rerank === undefined
          ? []
          : [
              [
                'Rerank',
                `${identity.rerank.model}, depth ${String(identity.rerank.depth)}: ${rerankUsage(report) ?? ''}`,
              ],
            ]),
        [
          'Vectors',
          `queries \`${vectors.queryHash.slice(0, 12)}\`, corpus \`${vectors.corpusHash.slice(0, 12)}\``,
        ],
      ],
    ),
    'Retrieval only, with no Claude call. Primary anchors are the headline: acceptable anchors are secondary, because many were found by looking at what the current retrievers return (ADR-0009).',
    '## Primary anchors',
    table(
      ['Strategy', 'Questions', ...HITS_HEADER, 'recall@8', 'MRR'],
      strategies.map(({ strategy, overall }) => metricsRow(strategy, overall)),
    ),
    ...(comparison === null ? [] : comparisonSection(comparison)),
    ...(comparison === null
      ? [
          '## Per tag, primary anchors',
          table(
            ['Tag', 'Strategy', 'Questions', ...HITS_HEADER, 'recall@8', 'MRR'],
            tags.flatMap((tag) =>
              strategies.flatMap(({ strategy, byTag }) => {
                const metrics = byTag[tag]
                return metrics === undefined ? [] : [[tag, ...metricsRow(strategy, metrics)]]
              }),
            ),
          ),
        ]
      : []),
    '## With acceptable anchors (secondary)',
    table(
      ['Strategy', 'Questions', ...HITS_HEADER, 'MRR'],
      strategies.map(({ strategy, overall }) => acceptableRow(strategy, overall)),
    ),
  ]
  if (targets.length > 0) {
    sections.push(
      '## Targets from SPEC section 13',
      table(
        ['Question', 'Anchor', 'Target', ...names, 'Met'],
        targets.map((target) => [
          target.questionId,
          withoutPin(target.anchor),
          String(target.target),
          ...names.map((name) => rank(target.ranks[name] ?? null)),
          yesNo(target.met),
        ]),
      ),
    )
  }
  if (result.stale.length > 0) sections.push(`Stale, left out: ${result.stale.join(', ')}.`)
  if (result.review.length > 0) {
    sections.push(`To review, still scored: ${result.review.join(', ')}.`)
  }
  sections.push('## Per question', perQuestionTable(strategies))
  return `${sections.join('\n\n')}\n`
}

/** What a run prints: the headline, what it means, and what it missed. */
export function formatEvalSummary(report: EvalReport): string {
  const { result, identity } = report
  const lines = [
    `golden set v${String(identity.goldenSet.version)}, docs ${identity.docs.sha.slice(0, 8)}: ` +
      `${String(result.scored)} questions scored, ${String(result.unanswerable.length)} unanswerable left out, ` +
      `${String(result.stale.length)} stale`,
    '',
    `primary anchors   ${['questions', ...HITS_HEADER, 'recall@8', 'MRR'].map((h) => h.padStart(9)).join('')}`,
    ...result.strategies.map(({ strategy, overall }) => {
      const cells = metricsRow(strategy, overall).slice(1)
      return `  ${strategy.padEnd(16)}${cells.map((cell) => cell.padStart(9)).join('')}`
    }),
  ]
  const overall = result.comparison?.scopes.find((scope) => scope.scope === 'overall')
  const comparison = result.comparison
  const mrr = overall?.primary.find(({ metric }) => metric === 'mrr')
  if (comparison !== null && mrr !== undefined) {
    lines.push(
      '',
      `by MRR, ${comparison.a} better on ${String(mrr.aBetter)} questions, ${comparison.b} on ${String(mrr.bBetter)}, ` +
        `${String(mrr.tied)} tied: p = ${mean(mrr.p)}, ${verdictLabel(mrr, comparison)}`,
    )
  }
  for (const { strategy, questions } of result.strategies) {
    const missed = questions.filter(
      ({ primaryRank }) => primaryRank === null || primaryRank > CONTEXT_CUTOFF,
    )
    lines.push(
      `${strategy} misses the top ${String(CONTEXT_CUTOFF)} on: ${missed.map(({ id }) => id).join(', ') || 'none'}`,
    )
  }
  for (const target of result.targets) {
    const ranks = Object.entries(target.ranks)
      .map(([name, value]) => `${name} ${rank(value)}`)
      .join(', ')
    const met = target.met === null ? 'not run' : target.met ? 'met' : 'not met'
    lines.push(`target ${target.questionId} <= ${String(target.target)}: ${ranks}, ${met}`)
  }
  const reranks = rerankUsage(report)
  if (reranks !== undefined) lines.push(`rerank: ${reranks}`)
  return lines.join('\n')
}

/** Two reports side by side: overall, per tag, and which questions moved. */
export function formatEvalComparison(
  comparison: EvalComparison,
  strategy: string,
  moved: readonly string[],
): string {
  const overall = scopeOf(comparison, 'overall')
  if (overall === undefined) return ''
  const line = (scope: string, difference: MetricDifference): string =>
    `  ${scope.padEnd(20)}${difference.metric.padEnd(10)}` +
    `${metricValue(difference.metric, difference.a).padStart(8)} -> ${metricValue(difference.metric, difference.b).padEnd(8)}` +
    ` better on ${String(difference.aBetter)} / ${String(difference.bBetter)}, p = ${mean(difference.p)}: ${verdictLabel(difference, comparison)}`
  return [
    `${strategy}: ${comparison.a} -> ${comparison.b}, primary anchors, ${String(overall.questions)} questions`,
    ...overall.primary.map((difference) => line('overall', difference)),
    ...comparison.scopes
      .filter((scope) => scope.scope !== 'overall')
      .flatMap((scope) =>
        scope.primary
          .filter(({ metric }) => metric === 'hit@8' || metric === 'mrr')
          .map((difference) => line(`${scope.scope} (${String(scope.questions)})`, difference)),
      ),
    moved.length > 0 ? 'primary ranks that moved:' : 'no primary rank moved',
    ...moved.map((entry) => `  ${entry}`),
  ].join('\n')
}

/** What a re-run found, in the terms of ADR-0010. */
export function formatVerification(verification: EvalVerification): string {
  const indent = (lines: readonly string[]): string[] => lines.map((line) => `  ${line}`)
  const deep = (moved: readonly string[]): string[] =>
    moved.length > 0 ? [`  ranks below the context moved on: ${moved.join(', ')}`] : []
  switch (verification.status) {
    case 'identical':
      return [
        `reproduced: what was measured matches the report byte for byte, ${
          verification.changedVectors.length > 0
            ? `on other ${verification.changedVectors.join(' and ')} vectors`
            : 'on the same vectors'
        }`,
        ...indent(verification.notes),
      ].join('\n')
    case 'not-comparable':
      return [
        'not comparable: the re-run did not measure the same thing',
        ...indent(verification.differences),
      ].join('\n')
    case 'equivalent':
      return [
        `reproduced: other ${verification.changedVectors.join(' and ')} vectors, and every context, count, verdict and target came out the same`,
        ...deep(verification.moved),
        ...indent(verification.notes),
      ].join('\n')
    case 'inconclusive':
      return [
        `inconclusive: other ${verification.changedVectors.join(' and ')} vectors and other code came to the same conclusions, which cannot tell the two apart`,
        ...deep(verification.moved),
        ...indent(verification.notes),
      ].join('\n')
    case 'different':
      return [
        `not reproduced${verification.changedVectors.length > 0 ? `, with other ${verification.changedVectors.join(' and ')} vectors` : ''}:`,
        ...indent(verification.differences),
        ...deep(verification.moved),
      ].join('\n')
  }
}
