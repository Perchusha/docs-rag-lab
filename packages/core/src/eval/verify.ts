// Does a re-run reproduce a report? (SPEC section 13's M4 acceptance, ADR-0010.)
// Vectors are not reproducible across batches or builds, so there are two bars. With
// the same vectors, the result must match byte for byte. With other vectors, what
// reaches the answer must not move: every count at every cutoff stays the same, and
// the MRR may move only as deep ranks do.
import {
  HIT_CUTOFFS,
  type EvalMetrics,
  type EvalReport,
  type EvalStrategyResult,
} from '@docs-rag-lab/contracts'

/** How far the MRR may move when only deep ranks do: 1/9 against 1/10 over 40 questions is 0.0003. */
export const MRR_TOLERANCE = 0.005

export type EvalVerification =
  /** Nothing to compare: the corpus, the set or the settings are not the same. */
  | { status: 'not-comparable'; differences: string[] }
  /** The result matches byte for byte. */
  | { status: 'identical' }
  /** Other vectors, and every number that matters came out the same. */
  | { status: 'equivalent'; changedVectors: string[]; moved: string[]; mrr: string[] }
  /** The numbers moved, with the vectors the same or not. */
  | { status: 'different'; changedVectors: string[]; differences: string[] }

function fieldDifferences(path: string, a: unknown, b: unknown): string[] {
  if (typeof a === 'object' && a !== null && typeof b === 'object' && b !== null) {
    const keys = [...new Set([...Object.keys(a), ...Object.keys(b)])]
    return keys.flatMap((key) =>
      fieldDifferences(
        `${path}.${key}`,
        (a as Record<string, unknown>)[key],
        (b as Record<string, unknown>)[key],
      ),
    )
  }
  return a === b ? [] : [`${path}: report ${String(a)}, now ${String(b)}`]
}

function metricDifferences(
  scope: string,
  report: EvalMetrics,
  now: EvalMetrics,
): { counts: string[]; mrr: string[]; mrrBeyond: string[] } {
  const counts: string[] = []
  const mrr: string[] = []
  const mrrBeyond: string[] = []
  const number = (name: string, a: number, b: number): void => {
    if (a !== b) counts.push(`${scope} ${name}: report ${String(a)}, now ${String(b)}`)
  }
  number('questions', report.questions, now.questions)
  number('recall@8', report.recallAt8, now.recallAt8)
  for (const grade of ['primary', 'withAcceptable'] as const) {
    for (const k of HIT_CUTOFFS) {
      number(`${grade} hit@${String(k)}`, report[grade].hits[k], now[grade].hits[k])
    }
    const a = report[grade].mrr
    const b = now[grade].mrr
    if (a !== b) {
      const line = `${scope} ${grade} MRR: report ${String(a)}, now ${String(b)}`
      mrr.push(line)
      if (Math.abs(a - b) > MRR_TOLERANCE) mrrBeyond.push(line)
    }
  }
  return { counts, mrr, mrrBeyond }
}

function strategyDifferences(report: EvalStrategyResult, now: EvalStrategyResult) {
  const scopes: [string, EvalMetrics, EvalMetrics | undefined][] = [
    [`${report.strategy} overall`, report.overall, now.overall],
    ...Object.entries(report.byTag).map(
      ([tag, metrics]): [string, EvalMetrics, EvalMetrics | undefined] => [
        `${report.strategy} ${tag}`,
        metrics,
        now.byTag[tag],
      ],
    ),
  ]
  const counts: string[] = []
  const mrr: string[] = []
  const mrrBeyond: string[] = []
  for (const [scope, a, b] of scopes) {
    if (b === undefined) {
      counts.push(`${scope}: gone`)
      continue
    }
    const found = metricDifferences(scope, a, b)
    counts.push(...found.counts)
    mrr.push(...found.mrr)
    mrrBeyond.push(...found.mrrBeyond)
  }
  const nowById = new Map(now.questions.map((question) => [question.id, question]))
  const moved = report.questions.flatMap((question) => {
    const other = nowById.get(question.id)
    return JSON.stringify(question.anchors) === JSON.stringify(other?.anchors) &&
      JSON.stringify(question.context) === JSON.stringify(other?.context)
      ? []
      : [`${report.strategy} ${question.id}`]
  })
  return { counts, mrr, mrrBeyond, moved }
}

/** Compares a stored report with a fresh run of the same thing. */
export function verifyReport(report: EvalReport, now: EvalReport): EvalVerification {
  const identity = fieldDifferences('identity', report.identity, now.identity)
  if (identity.length > 0) return { status: 'not-comparable', differences: identity }
  if (JSON.stringify(report.result) === JSON.stringify(now.result)) return { status: 'identical' }

  const changedVectors = [
    ...(report.vectors.queryHash === now.vectors.queryHash ? [] : ['query']),
    ...(report.vectors.corpusHash === now.vectors.corpusHash ? [] : ['corpus']),
  ]
  // The same vectors and another result: the code changed, or it is not deterministic.
  if (changedVectors.length === 0) {
    return {
      status: 'different',
      changedVectors,
      differences: ['the vectors are the same and the result is not'],
    }
  }

  const differences: string[] = []
  const moved: string[] = []
  const mrr: string[] = []
  for (const strategy of report.result.strategies) {
    const other = now.result.strategies.find((s) => s.strategy === strategy.strategy)
    if (other === undefined) {
      differences.push(`${strategy.strategy}: did not run`)
      continue
    }
    const found = strategyDifferences(strategy, other)
    differences.push(...found.counts, ...found.mrrBeyond)
    moved.push(...found.moved)
    mrr.push(...found.mrr)
  }
  return differences.length > 0
    ? { status: 'different', changedVectors, differences }
    : { status: 'equivalent', changedVectors, moved, mrr }
}
