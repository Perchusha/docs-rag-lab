// A sliding one-minute window over requests and billed tokens, so a sync
// stays under the provider's RPM and TPM limits instead of hitting 429s. A
// request over the whole TPM budget stays in the window for longer, in
// proportion, so that the average stays under the limit (ADR-0014).

export interface Clock {
  now(): number
  sleep(ms: number): Promise<void>
}

export const systemClock: Clock = {
  now: () => Date.now(),
  sleep: (ms) =>
    new Promise((resolve) => {
      setTimeout(resolve, ms)
    }),
}

const WINDOW_MS = 60_000
// A little slack, so a request does not land on the exact edge of the window.
const MARGIN_MS = 250

interface Entry {
  time: number
  tokens: number
}

export interface Slot {
  /** Replace the request's estimated tokens with the billed count. */
  settle(tokens: number): void
}

export class RateLimiter {
  readonly #rpm: number
  readonly #tpm: number
  readonly #clock: Clock
  #entries: Entry[] = []
  #waitedMs = 0

  constructor(limits: { rpm: number; tpm: number }, clock: Clock = systemClock) {
    if (limits.rpm <= 0 || limits.tpm <= 0) throw new Error('rate limits must be positive')
    this.#rpm = limits.rpm
    this.#tpm = limits.tpm
    this.#clock = clock
  }

  /** Total time spent waiting, on the window and on retry backoff. */
  get waitedMs(): number {
    return this.#waitedMs
  }

  /** Sleeps for `ms` and counts it as rate-limit waiting (used for retry backoff). */
  async wait(ms: number): Promise<void> {
    if (ms <= 0) return
    this.#waitedMs += ms
    await this.#clock.sleep(ms)
  }

  #leavesAt(entry: Entry): number {
    return entry.time + WINDOW_MS * Math.max(1, entry.tokens / this.#tpm)
  }

  /**
   * Waits until one more request of about `estimatedTokens` fits in the
   * window. A request larger than the whole TPM budget goes through once the
   * window is empty.
   */
  async acquire(estimatedTokens: number): Promise<Slot> {
    for (;;) {
      const now = this.#clock.now()
      this.#entries = this.#entries.filter((entry) => this.#leavesAt(entry) > now)
      const used = this.#entries.reduce((sum, entry) => sum + entry.tokens, 0)
      const fits =
        this.#entries.length < this.#rpm &&
        (used + estimatedTokens <= this.#tpm || this.#entries.length === 0)
      if (fits) {
        const entry: Entry = { time: now, tokens: estimatedTokens }
        this.#entries.push(entry)
        return {
          settle: (tokens) => {
            entry.tokens = tokens
          },
        }
      }
      const next = Math.min(...this.#entries.map((entry) => this.#leavesAt(entry)))
      await this.wait(Math.max(1, next - now + MARGIN_MS))
    }
  }
}
