// How far a report's answer metrics can be trusted (ADR-0012, ADR-0013). This comes from the
// labels and never from the code: a changed prompt or judge shows as not calibrated by itself,
// and the bias counts every blind round of this judge, because the lean did not go away with
// the first prompt.
import type {
  AgreementResult,
  CalibrationDimension,
  DashboardAgreement,
  DashboardJudge,
  DashboardRound,
  DashboardSpotCheck,
  EvalAnswers,
  EvalCalibration,
  EvalSpotCheck,
  EvalVerifyRecord,
} from '@docs-rag-lab/contracts'

const DIMENSIONS: readonly CalibrationDimension[] = ['correctness', 'refusal', 'support']

const agreementOf = (result: AgreementResult): DashboardAgreement => ({
  dimension: result.dimension,
  agreed: result.agreed,
  compared: result.compared,
  kappa: result.kappa,
  low: result.interval[0],
  high: result.interval[1],
  passed: result.passed,
})

function roundName(calibration: EvalCalibration, earlier: readonly EvalCalibration[]): string {
  if (calibration.blind === false) return 'First round, graded again'
  if (calibration.agreement.length === 1) return 'Fresh round'
  const full = (round: EvalCalibration) => round.blind !== false && round.agreement.length > 1
  if (!earlier.some(full)) return 'First round'
  const { name, repoSha } = calibration.report
  return `Later round, ${name ?? repoSha.slice(0, 8)}`
}

const sourcesOf = (names: readonly (string | undefined)[]): string[] =>
  [...new Set(names.filter((name) => name !== undefined))].sort()

/** "typescript's answers", or "react's and typescript's answers". */
const answersOf = (sources: readonly string[]): string =>
  `${sources.map((source) => `${source}'s`).join(' and ')} answers`

const withSource = (name: string, source: string | undefined): string =>
  source === undefined ? name : `${name}, on ${source}`

function biasOn(
  words: Pick<DashboardJudge, 'bias' | 'note'>,
  sources: readonly string[],
): Pick<DashboardJudge, 'bias' | 'note'> {
  if (words.bias === null || sources.length === 0) return words
  return { ...words, bias: `${words.bias} That is on ${answersOf(sources)}.` }
}

function biasWords(higher: number, lower: number): Pick<DashboardJudge, 'bias' | 'note'> {
  const count = higher + lower
  if (count === 0) return { bias: null, note: null }
  const disagreements =
    count === 1 ? 'The 1 disagreement is' : `All ${String(count)} disagreements are`
  if (lower === 0) {
    return {
      bias: `${disagreements} the judge scoring higher than the human: correctness may be slightly inflated.`,
      note: 'may run high',
    }
  }
  if (higher === 0) {
    return {
      bias: `${disagreements} the judge scoring lower than the human: correctness may be slightly deflated.`,
      note: 'may run low',
    }
  }
  return {
    bias: `The judge scored higher than the human on ${String(higher)} answers and lower on ${String(lower)}.`,
    note: null,
  }
}

/**
 * What the labels say about the judge, for a report's judge and prompts. Rounds labelled on another
 * source count, since they are about the judge, and `sourceId`, the report's own, is what lets
 * this say so.
 */
export function judgeTrust(
  answers: Pick<EvalAnswers, 'prompts' | 'models'>,
  calibrations: readonly EvalCalibration[],
  unreadable: readonly string[] = [],
  sourceId?: string,
): DashboardJudge {
  const elsewhere = (round: EvalCalibration): string | undefined =>
    sourceId !== undefined && round.sourceId !== undefined && round.sourceId !== sourceId
      ? round.sourceId
      : undefined
  const blind = calibrations.filter(
    (round) => round.blind !== false && round.judgeModel === answers.models.judge,
  )
  const decided = DIMENSIONS.flatMap((dimension) => {
    // The latest blind round under the same prompt decides.
    const round = blind
      .filter((candidate) => candidate.prompts?.[dimension] === answers.prompts[dimension])
      .filter((candidate) => candidate.agreement.some((result) => result.dimension === dimension))
      .at(-1)
    const result = round?.agreement.find((candidate) => candidate.dimension === dimension)
    return round === undefined || result === undefined ? [] : [{ round, result }]
  })
  const agreement = decided.map(({ result }) => agreementOf(result))
  const calibratedOn = sourcesOf(decided.map(({ round }) => elsewhere(round)))
  const disagreements = blind.flatMap((round) => round.correctnessDisagreements ?? [])
  const leanOn = sourcesOf(
    blind
      .filter((round) => (round.correctnessDisagreements ?? []).length > 0)
      .map((round) => elsewhere(round)),
  )
  const judgeHigher = disagreements.filter(({ human, judge }) => judge > human).length
  const judgeLower = disagreements.filter(({ human, judge }) => judge < human).length
  const rounds: DashboardRound[] = calibrations.map((round, index) => ({
    name: withSource(roundName(round, calibrations.slice(0, index)), elsewhere(round)),
    blind: round.blind !== false,
    agreement: round.agreement.map(agreementOf),
  }))
  return {
    calibrated:
      unreadable.length === 0 &&
      agreement.length === DIMENSIONS.length &&
      agreement.every((result) => result.passed),
    agreement,
    ...(calibratedOn.length === 0 ? {} : { calibratedOn }),
    judgeHigher,
    judgeLower,
    ...biasOn(biasWords(judgeHigher, judgeLower), leanOn),
    rounds,
    unreadable: [...unreadable],
  }
}

/** The sentence a report's markdown and the CLI's summary use, the same as the dashboard's. */
export function judgeSentence(judge: DashboardJudge): string {
  const on = judge.calibratedOn === undefined ? '' : `, on ${answersOf(judge.calibratedOn)}`
  const status = judge.calibrated
    ? `The judge is calibrated for these prompts${on}.`
    : 'The judge is not calibrated for these prompts, so these answer metrics are not yet to be trusted.'
  const unread =
    judge.unreadable.length === 0 ? [] : [`Could not read ${judge.unreadable.join(', ')}.`]
  return [status, ...unread, ...(judge.bias === null ? [] : [judge.bias])].join(' ')
}

/** A spot check as the dashboard shows it (ADR-0016). */
export function spotCheckView(spot: EvalSpotCheck): DashboardSpotCheck {
  const higher = spot.correctnessDisagreements.filter(({ human, judge }) => judge > human).length
  const lower = spot.correctnessDisagreements.filter(({ human, judge }) => judge < human).length
  return {
    passed: spot.passed,
    labelled: spot.labelled,
    allowed: spot.allowed,
    agreement: spot.agreement.map(agreementOf),
    bias: biasWords(higher, lower).bias,
  }
}

/** The sentence a report's markdown and the CLI use for a spot check. */
export function spotCheckSentence(spot: EvalSpotCheck): string {
  const { passed, labelled, agreement, bias } = spotCheckView(spot)
  const counts = agreement
    .map(
      ({ dimension, agreed, compared }) => `${dimension} ${String(agreed)} of ${String(compared)}`,
    )
    .join(', ')
  return [
    `A spot check of ${String(labelled)} of these answers, labelled blind, ${passed ? 'passed' : 'missed'}: ${counts}.`,
    ...(bias === null ? [] : [bias]),
  ].join(' ')
}

/** What a recorded re-run found, in words. */
export function verifyWords(record: EvalVerifyRecord, hasAnswers: boolean): string {
  const at = record.rerun.repoSha.slice(0, 8)
  const answers = hasAnswers ? ' Answers do not repeat, so they are not part of this check.' : ''
  const dirty = record.rerun.repoDirty ? ', with uncommitted changes' : ''
  switch (record.status) {
    case 'identical':
      return `Retrieval reproduced byte for byte at ${at}${dirty}, on ${
        record.changedVectors.length === 0 ? 'the same vectors' : 'other vectors'
      }.${answers}`
    case 'equivalent':
      return `Retrieval reached the same conclusions at ${at}${dirty}, on other vectors.${answers}`
    case 'inconclusive':
      return `Inconclusive: other vectors and other code at ${at}, which this check cannot tell apart.${answers}`
    case 'different':
      return `Did not reproduce at ${at}${dirty}: a conclusion changed.`
    case 'not-comparable':
      return `Not checked: the run at ${at} measured something else.`
  }
}
