/** A usage error: run() prints its message without a stack trace. */
export class CliError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'CliError'
  }
}
