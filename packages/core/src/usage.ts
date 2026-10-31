// Token and cost accounting. Every command reports what it spent, from the
// token counts the APIs return and the prices in config (ADR-0004).
import type { PricingConfig } from './config.ts'

export interface ModelUsage {
  kind: 'embedding' | 'messages'
  requests: number
  inputTokens: number
  outputTokens: number
  cacheWriteTokens: number
  cacheReadTokens: number
  /** Embedding inputs served from the local cache instead of the API. */
  cacheHits: number
}

/** The usage fields of a Claude response that cost money. */
export interface MessageUsage {
  input_tokens: number
  output_tokens: number
  cache_creation_input_tokens?: number | null
  cache_read_input_tokens?: number | null
}

export interface CostEstimate {
  total: number
  byModel: Map<string, number>
  /** Models that were used but have no price in config. */
  unpriced: string[]
}

export class UsageMeter {
  readonly #models = new Map<string, ModelUsage>()

  #entry(model: string, kind: ModelUsage['kind']): ModelUsage {
    let entry = this.#models.get(model)
    if (entry === undefined) {
      entry = {
        kind,
        requests: 0,
        inputTokens: 0,
        outputTokens: 0,
        cacheWriteTokens: 0,
        cacheReadTokens: 0,
        cacheHits: 0,
      }
      this.#models.set(model, entry)
    }
    return entry
  }

  recordEmbedding(model: string, tokens: number): void {
    const entry = this.#entry(model, 'embedding')
    entry.requests++
    entry.inputTokens += tokens
  }

  recordEmbeddingCacheHits(model: string, count: number): void {
    if (count > 0) this.#entry(model, 'embedding').cacheHits += count
  }

  recordMessage(model: string, usage: MessageUsage): void {
    const entry = this.#entry(model, 'messages')
    entry.requests++
    entry.inputTokens += usage.input_tokens
    entry.outputTokens += usage.output_tokens
    entry.cacheWriteTokens += usage.cache_creation_input_tokens ?? 0
    entry.cacheReadTokens += usage.cache_read_input_tokens ?? 0
  }

  entries(): [string, ModelUsage][] {
    return [...this.#models.entries()]
  }

  /** Billed tokens of every kind, across models. */
  totalTokens(): number {
    return this.entries().reduce(
      (sum, [, u]) => sum + u.inputTokens + u.outputTokens + u.cacheWriteTokens + u.cacheReadTokens,
      0,
    )
  }

  estimateCost(pricing: PricingConfig): CostEstimate {
    const byModel = new Map<string, number>()
    const unpriced: string[] = []
    for (const [model, u] of this.entries()) {
      const price = pricing.models[model]
      if (price === undefined) {
        if (u.requests > 0) unpriced.push(model)
        continue
      }
      const cost =
        (u.inputTokens * price.input +
          u.outputTokens * (price.output ?? 0) +
          u.cacheWriteTokens * (price.cacheWrite5m ?? price.input) +
          u.cacheReadTokens * (price.cacheRead ?? price.input)) /
        1_000_000
      byModel.set(model, cost)
    }
    const total = [...byModel.values()].reduce((sum, cost) => sum + cost, 0)
    return { total, byModel, unpriced }
  }
}

const count = (n: number): string => n.toLocaleString('en-US')
const usd = (n: number): string => `$${n.toFixed(4)}`

/** One line for the end of every command. */
export function formatUsage(meter: UsageMeter, pricing: PricingConfig): string {
  const entries = meter.entries()
  const cost = meter.estimateCost(pricing)
  if (entries.length === 0) return 'usage: no API calls, 0 tokens, $0.0000'
  const parts = entries.map(([model, u]) => {
    const price = cost.byModel.has(model) ? usd(cost.byModel.get(model) ?? 0) : 'no price'
    if (u.kind === 'embedding') {
      const requests = `${count(u.requests)} request${u.requests === 1 ? '' : 's'}`
      return `${model} ${count(u.inputTokens)} tokens in ${requests}, ${count(u.cacheHits)} cached (${price})`
    }
    const cache =
      u.cacheReadTokens + u.cacheWriteTokens > 0
        ? `, cache ${count(u.cacheReadTokens)} read / ${count(u.cacheWriteTokens)} written`
        : ''
    return `${model} ${count(u.inputTokens)} in / ${count(u.outputTokens)} out${cache} (${price})`
  })
  const unpriced = cost.unpriced.length > 0 ? `; no price for ${cost.unpriced.join(', ')}` : ''
  return `usage: ${parts.join(' | ')} | total ${count(meter.totalTokens())} tokens, ${usd(cost.total)} estimated at list prices checked ${pricing.checked}${unpriced}`
}
