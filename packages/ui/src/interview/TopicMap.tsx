import type { TopicGroup, TopicProgress } from '@docs-rag-lab/contracts'
import { ChevronRight } from 'lucide-react'
import { useId, useState } from 'react'

import common from '../lib/common.module.css'
import { filterGroups, seenShare, topicProgressText } from '../lib/interview.ts'
import styles from './Interview.module.css'

export interface TopicMapProps {
  groups: readonly TopicGroup[]
  /** The sources' names, by ID, for the group headings. */
  sourceTitles: Readonly<Record<string, string>>
  onPractice: (topic: TopicProgress) => void
}

const keyOf = (group: Pick<TopicGroup, 'source' | 'group'>): string =>
  `${group.source}:${group.group}`

const plural = (count: number, one: string): string =>
  `${String(count)} ${count === 1 ? one : `${one}s`}`

function Topics({
  topics,
  id,
  onPractice,
}: {
  topics: readonly TopicProgress[]
  id?: string
  onPractice: (topic: TopicProgress) => void
}) {
  return (
    <ul id={id} className={styles.topics}>
      {topics.map((topic) => (
        <li key={topic.id} className={styles.topic}>
          <span className={styles.topicTitle}>{topic.title}</span>
          <span className={styles.topicProgress}>{topicProgressText(topic)}</span>
          {/* The words above say it: the bar only adds a glance. */}
          <span className={styles.bar} aria-hidden="true">
            <span style={{ inlineSize: `${String(Math.round(seenShare(topic) * 100))}%` }} />
          </span>
          <button
            type="button"
            className={[common.button, styles.practice].filter(Boolean).join(' ')}
            aria-label={`Practice ${topic.title}`}
            onClick={() => {
              onPractice(topic)
            }}
          >
            Practice
          </button>
        </li>
      ))}
    </ul>
  )
}

/**
 * The topic map (ADR-0018). Its sections start collapsed, since there are hundreds of pages, and a
 * search shows every topic it finds with its section, open. Compiler options and React's reference
 * pages are topics of a few pages each, as their sources say.
 */
export function TopicMap({ groups, sourceTitles, onPractice }: TopicMapProps) {
  const [query, setQuery] = useState('')
  const [open, setOpen] = useState<ReadonlySet<string>>(new Set())
  const id = useId()
  const searching = query.trim() !== ''
  const shown = filterGroups(groups, query)
  const titleOf = (group: TopicGroup): string =>
    `${sourceTitles[group.source] ?? group.source}: ${group.group}`

  return (
    <section className={styles.section} aria-labelledby={`${id}-heading`}>
      <h2 id={`${id}-heading`}>Topics</h2>
      <label className={styles.search}>
        Find a topic
        <input
          type="search"
          value={query}
          onChange={(event) => {
            setQuery(event.target.value)
          }}
        />
      </label>
      {/* Announced as the search narrows, without moving focus out of the field. */}
      <p role="status" className={searching ? styles.muted : common.srOnly}>
        {searching
          ? shown.length === 0
            ? `No topic matches "${query.trim()}".`
            : `${plural(
                shown.reduce((sum, group) => sum + group.topics.length, 0),
                'topic',
              )} found.`
          : ''}
      </p>
      {shown.map((group) => {
        const key = keyOf(group)
        const listId = `${id}-${key}`
        if (searching) {
          return (
            <div key={key} className={styles.group}>
              <h3 className={styles.groupTitle}>{titleOf(group)}</h3>
              <Topics topics={group.topics} onPractice={onPractice} />
            </div>
          )
        }
        const expanded = open.has(key)
        return (
          <div key={key} className={styles.group}>
            <h3>
              <button
                type="button"
                className={styles.groupToggle}
                aria-expanded={expanded}
                aria-controls={expanded ? listId : undefined}
                onClick={() => {
                  const next = new Set(open)
                  if (expanded) next.delete(key)
                  else next.add(key)
                  setOpen(next)
                }}
              >
                <ChevronRight className={styles.chevron} aria-hidden="true" />
                {titleOf(group)}
                <span className={styles.muted}>{plural(group.topics.length, 'topic')}</span>
              </button>
            </h3>
            {expanded && <Topics id={listId} topics={group.topics} onPractice={onPractice} />}
          </div>
        )
      })}
    </section>
  )
}
