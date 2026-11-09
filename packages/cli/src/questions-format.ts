// What drl questions prints and writes (ADR-0018): the plan, the pilot's questions, the sheet the
// owner labels the bank's sample from, the score of those labels, and the cards flagged as wrong.
import type { BankCheck, BankPlan, CardFlag, QuestionRow, TokenPlan } from '@docs-rag-lab/core'

const count = (n: number): string => n.toLocaleString('en-US')
const usd = (n: number): string => `$${n.toFixed(4)}`
const percent = (x: number): string => `${String(Math.round(x * 100))}%`

const tokens = (plan: TokenPlan): string =>
  `${count(Math.round(plan.cacheWrite))} cache write, ${count(Math.round(plan.cacheRead))} cache read, ${count(Math.round(plan.uncached))} uncached, ${count(Math.round(plan.output))} out`

export function formatBankPlan(
  plan: BankPlan,
  models: { generate: string; check: string },
): string {
  return [
    `questions for ${count(plan.chunks)} chunks over ${count(plan.documents)} documents, about ${usd(plan.usd)}:`,
    `  writing, ${models.generate}: about ${usd(plan.generate.usd)} (estimated tokens: ${tokens(plan.generate)})`,
    `  checking, ${models.check}: about ${usd(plan.check.usd)} (estimated tokens: ${tokens(plan.check)})`,
  ].join('\n')
}

function fenced(code: string, lang: string): string {
  const longest = Math.max(0, ...(code.match(/`+/g) ?? []).map((run) => run.length))
  const fence = '`'.repeat(Math.max(3, longest + 1))
  return `${fence}${lang}\n${code}\n${fence}`
}

/** A question as the pilot shows it to the owner: what it asks, what it answers, and what became of it. */
export function formatPilotQuestion(row: QuestionRow): string {
  const { question } = row
  return [
    `### ${question.kind}, ${row.status}: ${question.citation.docPath}`,
    '',
    `**Question:** ${question.prompt}`,
    ...(question.code === undefined ? [] : ['', fenced(question.code.code, question.code.lang)]),
    '',
    `**Answer:** ${question.answer}`,
    ...(question.quote === undefined ? [] : ['', `**Quote:** ${question.quote}`]),
    ...(row.reason === undefined ? [] : ['', `**Checker:** ${row.reason}`]),
  ].join('\n')
}

/** The sheet of the bank's sample: everything the owner needs to label, and nothing of the checker. */
export function formatBankSheet(
  sample: readonly QuestionRow[],
  hash: string,
  chunkText: (row: QuestionRow) => string,
): string {
  const items = sample.flatMap((row, i) => {
    const { question } = row
    return [
      `## Item ${String(i + 1)}`,
      '',
      `**Source:** ${question.source}, ${question.kind}, [${question.citation.title}](${question.citation.url})`,
      '',
      `**Question:** ${question.prompt}`,
      ...(question.code === undefined ? [] : ['', fenced(question.code.code, question.code.lang)]),
      '',
      `**Stored answer:** ${question.answer}`,
      '',
      `**Quote:** ${question.quote ?? ''}`,
      '',
      '**The cited passage:**',
      '',
      fenced(chunkText(row), 'markdown'),
      '',
    ]
  })
  return [
    '# Labels for the interview bank',
    '',
    `Sample \`${hash}\`. These are 20 questions the app would show, written by a model from one passage of the docs each (ADR-0018). Label each on two counts, without looking at the bank:`,
    '',
    '- **Answerable:** a reader of the cited passage alone could answer the question fully. yes or no.',
    '- **Correct:** the stored answer is right by that passage, and gives everything the question asks. Details the question did not ask for count neither way. yes or no.',
    '',
    'Reply with one line per item, such as `1: yes yes`.',
    '',
    ...items,
  ].join('\n')
}

export function formatBankCheck(check: BankCheck): string {
  const { passed } = check
  return [
    `# The interview bank's test: ${String(check.labelled)} questions labelled`,
    '',
    `Sample \`${check.sample}\`. H holds when at most ${String(check.allowed)} of the questions fail on either count (ADR-0018).`,
    '',
    `Passed both counts: ${String(passed.count)} of ${String(passed.of)} (${percent(passed.low)} to ${percent(passed.high)}).`,
    '',
    ...(check.failed.length === 0
      ? ['No question failed.']
      : [
          'Failed:',
          '',
          ...check.failed.map(
            (failure) =>
              `- Item ${String(failure.item)}, ${failure.source} ${failure.kind} \`${failure.questionId}\`: ${failure.answerable ? 'answerable' : 'not answerable'}, ${failure.correct ? 'correct' : 'not correct'}`,
          ),
        ]),
    '',
    check.holds
      ? 'H holds.'
      : 'H misses: the generated questions are hidden, and the owner is asked.',
    '',
  ].join('\n')
}

/** What `drl questions flagged` prints of one flag: the card, the owner's reason, and the bank's status. */
export function formatFlag(flag: CardFlag, row: QuestionRow | undefined): string {
  const head = `${flag.questionId}, flagged ${flag.flaggedAt.slice(0, 10)}`
  if (row === undefined) {
    return [
      head,
      `  Your reason: ${flag.reason}`,
      '  In the bank: no longer there, since its chunk changed or a run dropped it',
    ].join('\n')
  }
  const { question } = row
  return [
    `${head}, ${question.source} ${question.kind}`,
    `  Question: ${question.prompt}`,
    `  Stored answer: ${question.answer}`,
    `  Docs: ${question.citation.url}`,
    `  Your reason: ${flag.reason}`,
    row.status === 'rejected-owner'
      ? '  In the bank: rejected already'
      : row.status === 'shown'
        ? `  In the bank: shown. To reject it with your reason: pnpm drl questions reject ${flag.questionId}`
        : `  In the bank: ${row.status}`,
  ].join('\n')
}
