import type { TraceChunk } from '@docs-rag-lab/contracts'

import common from '../lib/common.module.css'
import { chunkLocation, chunkTitle } from '../lib/format.ts'

export interface ChunkButtonProps {
  chunkId: string
  chunk: TraceChunk | undefined
  selected: boolean
  onSelect: (chunkId: string) => void
  className?: string | undefined
  titleClassName?: string | undefined
  locationClassName?: string | undefined
}

/**
 * A chunk's title and place in the docs, as a button that selects it for the
 * Document tab. Selecting is not a toggle, so the selected one is marked with
 * aria-current and a visible "selected" label, never by colour alone.
 */
export function ChunkButton(props: ChunkButtonProps) {
  const { chunkId, chunk, selected, onSelect } = props
  return (
    <button
      type="button"
      className={props.className}
      aria-current={selected ? 'true' : undefined}
      onClick={() => {
        onSelect(chunkId)
      }}
    >
      <span className={props.titleClassName}>
        {chunk === undefined ? chunkId : chunkTitle(chunk)}
      </span>
      {chunk !== undefined && props.locationClassName !== undefined && (
        <span className={props.locationClassName}>{chunkLocation(chunk)}</span>
      )}
      {selected && <span className={common.badge}>selected</span>}
    </button>
  )
}
