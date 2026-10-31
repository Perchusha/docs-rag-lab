// violation: ui-no-internal-packages (type-only imports count too)
import type { CoreThing } from '../../core/src/index.ts'

export type UiThing = CoreThing
