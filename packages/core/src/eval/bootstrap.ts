// A percentile bootstrap over questions, for the spread of a mean (ADR-0013). A mean of ranks
// is bounded and skewed, so a t-interval can pass its range. This one cannot, and it is just
// as deterministic: the seed is fixed. It describes spread and decides nothing, since verdicts
// come from the sign test (ADR-0010).

/** A small seeded generator (mulberry32): results need to repeat, not to be secure. */
export function seeded(seed: number): () => number {
  let state = seed
  return () => {
    state = (state + 0x6d2b79f5) | 0
    let t = Math.imul(state ^ (state >>> 15), 1 | state)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4_294_967_296
  }
}

const RESAMPLES = 10_000
export const BOOTSTRAP_SEED = 20_261_103

export interface BootstrapOptions {
  resamples?: number
  seed?: number
}

/** The 95% interval of a mean, and the mean. No values gives zeros: a caller shows no number. */
export function bootstrapMean(
  values: readonly number[],
  options: BootstrapOptions = {},
): { value: number; low: number; high: number } {
  const n = values.length
  if (n === 0) return { value: 0, low: 0, high: 0 }
  const resamples = options.resamples ?? RESAMPLES
  const random = seeded(options.seed ?? BOOTSTRAP_SEED)
  const means = new Float64Array(resamples)
  for (let i = 0; i < resamples; i++) {
    let sum = 0
    for (let j = 0; j < n; j++) sum += values[Math.floor(random() * n)] ?? 0
    means[i] = sum / n
  }
  means.sort()
  const at = (share: number): number => means[Math.floor(share * (resamples - 1))] ?? 0
  return {
    value: values.reduce((sum, value) => sum + value, 0) / n,
    low: at(0.025),
    high: at(0.975),
  }
}
