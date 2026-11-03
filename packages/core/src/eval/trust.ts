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
  EvalAnswers,
  EvalCalibration,
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

function roundName(calibration: EvalCalibration): string {
  if (calibration.blind === false) return 'First round, graded again'
  return calibration.agreement.length === 1 ? 'Fresh round' : 'First round'
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

/** What the labels say about the judge, for a report's judge and prompts. */
export function judgeTrust(
  answers: Pick<EvalAnswers, 'prompts' | 'models'>,
  calibrations: readonly EvalCalibration[],
  unreadable: readonly string[] = [],
): DashboardJudge {
  const blind = calibrations.filter(
    (round) => round.blind !== false && round.judgeModel === answers.models.judge,
  )
  const agreement = DIMENSIONS.flatMap((dimension): DashboardAgreement[] => {
    // The latest blind round under the same prompt decides.
    const decided = blind
      .filter((round) => round.prompts?.[dimension] === answers.prompts[dimension])
      .flatMap((round) => round.agreement.filter((result) => result.dimension === dimension))
      .at(-1)
    return decided === undefined ? [] : [agreementOf(decided)]
  })
  const disagreements = blind.flatMap((round) => round.correctnessDisagreements ?? [])
  const judgeHigher = disagreements.filter(({ human, judge }) => judge > human).length
  const judgeLower = disagreements.filter(({ human, judge }) => judge < human).length
  const rounds: DashboardRound[] = calibrations.map((round) => ({
    name: roundName(round),
    blind: round.blind !== false,
    agreement: round.agreement.map(agreementOf),
  }))
  return {
    calibrated:
      unreadable.length === 0 &&
      agreement.length === DIMENSIONS.length &&
      agreement.every((result) => result.passed),
    agreement,
    judgeHigher,
    judgeLower,
    ...biasWords(judgeHigher, judgeLower),
    rounds,
    unreadable: [...unreadable],
  }
}

/** The sentence a report's markdown and the CLI's summary use, the same as the dashboard's. */
export function judgeSentence(judge: DashboardJudge): string {
  const status = judge.calibrated
    ? 'The judge is calibrated for these prompts.'
    : 'The judge is not calibrated for these prompts, so these answer metrics are not yet to be trusted.'
  const unread =
    judge.unreadable.length === 0 ? [] : [`Could not read ${judge.unreadable.join(', ')}.`]
  return [status, ...unread, ...(judge.bias === null ? [] : [judge.bias])].join(' ')
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
