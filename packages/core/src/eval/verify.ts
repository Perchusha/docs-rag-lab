// Does a re-run reproduce a report? (SPEC section 13's M4 acceptance, ADR-0010.)
// Vectors are not reproducible across batches or builds, so there are two bars. With
// the same vectors, what was measured must match byte for byte. With other vectors,
// the conclusions must: every context, every rank inside it, every count, verdict and
// target. Only ranks below the context may move, and the MRR with them.
import {
  HIT_CUTOFFS,
  type EvalComparison,
  type EvalMetrics,
  type EvalReport,
  type EvalResult,
  type EvalStrategyResult,
} from '@docs-rag-lab/contracts'

import { CONTEXT_CUTOFF } from './metrics.ts'

export type EvalVerification =
  /** Nothing to compare: the corpus, the set, the settings or the retrieval code differ. */
  | { status: 'not-comparable'; differences: string[] }
  /** What was measured matches byte for byte, on these vectors or on others. */
  | { status: 'identical'; changedVectors: string[]; notes: string[] }
  /** Other vectors, and every conclusion came out the same, at the report's own code. */
  | { status: 'equivalent'; changedVectors: string[]; moved: string[]; notes: string[] }
  /** Other vectors and other code came to the same conclusions, which proves neither. */
  | { status: 'inconclusive'; changedVectors: string[]; moved: string[]; notes: string[] }
  /** A conclusion changed. */
  | { status: 'different'; changedVectors: string[]; differences: string[]; moved: string[] }

/** Every field where two plain values differ, as `path: a, b`. */
export function fieldDifferences(
  path: string,
  a: unknown,
  b: unknown,
  labels: { a: string; b: string } = { a: 'report', b: 'now' },
): string[] {
  if (typeof a === 'object' && a !== null && typeof b === 'object' && b !== null) {
    const keys = [...new Set([...Object.keys(a), ...Object.keys(b)])]
    return keys.flatMap((key) =>
      fieldDifferences(
        `${path}.${key}`,
        (a as Record<string, unknown>)[key],
        (b as Record<string, unknown>)[key],
        labels,
      ),
    )
  }
  return a === b ? [] : [`${path}: ${labels.a} ${String(a)}, ${labels.b} ${String(b)}`]
}

/**
 * What a result says about retrieval. Targets and the review list are left out: both
 * can change without the search changing, since the targets file is not part of the
 * golden set and the review list follows the lock. Targets are compared on their own.
 */
function measuredOf(result: EvalResult): unknown {
  const { scored, stale, unanswerable, strategies, comparison, chunks } = result
  return { scored, stale, unanswerable, strategies, comparison, chunks }
}

function metricCounts(scope: string, report: EvalMetrics, now: EvalMetrics): string[] {
  const found: string[] = []
  const number = (name: string, a: number, b: number): void => {
    if (a !== b) found.push(`${scope} ${name}: report ${String(a)}, now ${String(b)}`)
  }
  number('questions', report.questions, now.questions)
  number('recall@8', report.recallAt8, now.recallAt8)
  for (const grade of ['primary', 'withAcceptable'] as const) {
    for (const k of HIT_CUTOFFS) {
      number(`${grade} hit@${String(k)}`, report[grade].hits[k], now[grade].hits[k])
    }
  }
  return found
}

const inContext = (rank: number | null): boolean => rank !== null && rank <= CONTEXT_CUTOFF

/** What reaches the answer on each question, and the deep ranks that only moved. */
function questionDifferences(report: EvalStrategyResult, now: EvalStrategyResult) {
  const differences: string[] = []
  const moved: string[] = []
  const after = new Map(now.questions.map((question) => [question.id, question]))
  for (const question of report.questions) {
    const label = `${report.strategy} ${question.id}`
    const other = after.get(question.id)
    if (other === undefined) {
      differences.push(`${label}: no longer scored`)
      continue
    }
    if (JSON.stringify(question.context) !== JSON.stringify(other.context)) {
      differences.push(`${label}: the context changed`)
    }
    const ranks = new Map(other.anchors.map(({ anchor, rank }) => [anchor, rank]))
    let deepMove = false
    for (const { anchor, rank } of question.anchors) {
      const then = ranks.get(anchor) ?? null
      if (then === rank) continue
      if (inContext(rank) || inContext(then)) {
        differences.push(`${label}: ${anchor} from rank ${String(rank)} to ${String(then)}`)
      } else deepMove = true
    }
    if (deepMove) moved.push(label)
  }
  return { differences, moved }
}

function strategyDifferences(report: EvalStrategyResult, now: EvalStrategyResult) {
  const differences = metricCounts(`${report.strategy} overall`, report.overall, now.overall)
  const tags = new Set([...Object.keys(report.byTag), ...Object.keys(now.byTag)])
  for (const tag of [...tags].sort()) {
    const a = report.byTag[tag]
    const b = now.byTag[tag]
    if (a === undefined || b === undefined) {
      differences.push(`${report.strategy} ${tag}: ${a === undefined ? 'new' : 'gone'}`)
    } else differences.push(...metricCounts(`${report.strategy} ${tag}`, a, b))
  }
  const questions = questionDifferences(report, now)
  return { differences: [...differences, ...questions.differences], moved: questions.moved }
}

function verdictDifferences(report: EvalComparison | null, now: EvalComparison | null): string[] {
  if (report === null || now === null) {
    return report === now ? [] : ['one of the runs has no comparison']
  }
  return report.scopes.flatMap((scope) => {
    const other = now.scopes.find(({ scope: name }) => name === scope.scope)
    if (other === undefined) return [`comparison ${scope.scope}: gone`]
    return (['primary', 'withAcceptable'] as const).flatMap((grade) =>
      scope[grade].flatMap((difference) => {
        const then = other[grade].find(({ metric }) => metric === difference.metric)
        return then?.verdict === difference.verdict
          ? []
          : [
              `comparison ${scope.scope} ${grade} ${difference.metric}: verdict ${difference.verdict}, now ${String(then?.verdict)}`,
            ]
      }),
    )
  })
}

const targetKey = (target: EvalResult['targets'][number]): string =>
  `${target.questionId} ${target.anchor} <= ${String(target.target)}`

function targetDifferences(report: EvalResult, now: EvalResult) {
  const after = new Map(now.targets.map((target) => [targetKey(target), target]))
  const differences: string[] = []
  const notes: string[] = []
  for (const target of report.targets) {
    const then = after.get(targetKey(target))
    if (then === undefined) notes.push(`the target ${targetKey(target)} is no longer in the file`)
    else if (then.met !== target.met) {
      differences.push(
        `target ${targetKey(target)}: met ${String(target.met)}, now ${String(then.met)}`,
      )
    }
  }
  const before = new Set(report.targets.map(targetKey))
  for (const target of now.targets) {
    if (!before.has(targetKey(target))) notes.push(`the target ${targetKey(target)} is new`)
  }
  return { differences, notes }
}

/** Compares a stored report with a fresh run of the same thing. */
export function verifyReport(report: EvalReport, now: EvalReport): EvalVerification {
  const identity = fieldDifferences('identity', report.identity, now.identity)
  if (identity.length > 0) return { status: 'not-comparable', differences: identity }

  const changedVectors = [
    ...(report.vectors.queryHash === now.vectors.queryHash ? [] : ['query']),
    ...(report.vectors.corpusHash === now.vectors.corpusHash ? [] : ['corpus']),
  ]
  const targets = targetDifferences(report.result, now.result)
  const sameMeasure =
    JSON.stringify(measuredOf(report.result)) === JSON.stringify(measuredOf(now.result))
  if (sameMeasure && targets.differences.length === 0) {
    return { status: 'identical', changedVectors, notes: targets.notes }
  }

  const sameCode =
    report.run.repoSha === now.run.repoSha && !report.run.repoDirty && !now.run.repoDirty

  const differences = [...targets.differences]
  const moved: string[] = []
  for (const strategy of report.result.strategies) {
    const other = now.result.strategies.find((s) => s.strategy === strategy.strategy)
    if (other === undefined) {
      differences.push(`${strategy.strategy}: did not run`)
      continue
    }
    const found = strategyDifferences(strategy, other)
    differences.push(...found.differences)
    moved.push(...found.moved)
  }
  differences.push(...verdictDifferences(report.result.comparison, now.result.comparison))

  // With the same vectors nothing may differ at all, not even a deep rank.
  if (changedVectors.length === 0) {
    return {
      status: 'different',
      changedVectors,
      differences: [
        sameCode
          ? 'the code and the vectors are the same, and the result is not: it is not deterministic'
          : 'the vectors are the same and the result is not: the code changed',
        ...differences,
      ],
      moved,
    }
  }
  if (differences.length > 0) return { status: 'different', changedVectors, differences, moved }
  return {
    status: sameCode ? 'equivalent' : 'inconclusive',
    changedVectors,
    moved,
    notes: targets.notes,
  }
}
