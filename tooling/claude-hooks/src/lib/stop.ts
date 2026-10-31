/**
 * What the Stop hook does with a test result.
 * - pass: let Claude stop.
 * - block: exit 2 so Claude keeps working on the failure.
 * - warn: Claude already had one retry (`stop_hook_active`), so let it stop
 *   and warn the user. This is what makes an endless loop impossible.
 */
export type StopOutcome = 'pass' | 'block' | 'warn'

export function stopOutcome(testsPassed: boolean, stopHookActive: boolean): StopOutcome {
  if (testsPassed) return 'pass'
  return stopHookActive ? 'warn' : 'block'
}
