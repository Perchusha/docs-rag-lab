// A local token estimate for chunk sizing and request batching. Billed tokens
// always come from the provider's response (ADR-0004). 3.5 characters per
// token sits between English prose (about 4) and code (about 3), so the
// estimate errs on the high side, which keeps batches under rate limits.
const CHARS_PER_TOKEN = 3.5

export function estimateTokens(text: string): number {
  return Math.ceil(text.length / CHARS_PER_TOKEN)
}
