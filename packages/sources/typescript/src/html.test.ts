import { describe, expect, it } from 'vitest'

import { htmlToText, isHtmlComment } from './html.ts'

describe('htmlToText', () => {
  it('keeps text, marks code, decodes entities and breaks lines at block ends', () => {
    const html = [
      "<blockquote class='bg-reading'>",
      "  <p>Background Reading:<br /><a href='https://example.com'>Classes (MDN)</a></p>",
      '</blockquote>',
      '<p>Use <code>a &lt; b</code> &amp; more&#33;</p>',
    ].join('\n')
    expect(htmlToText(html)).toBe('Background Reading:\nClasses (MDN)\n\nUse `a < b` & more!')
  })

  it('puts each table row on its own line, cells joined by " | "', () => {
    expect(
      htmlToText(
        '<table><tr><td><code>--all</code></td><td>boolean</td></tr><tr><td>Show all.</td></tr></table>',
      ),
    ).toBe('`--all` | boolean\nShow all.')
  })

  it('flattens block content inside cells and keeps rows adjacent across blank lines', () => {
    const html = [
      '<table>',
      '  <thead><tr><th>Flag</th><th>Type</th></tr></thead>',
      "<tr class='odd' name='all'>",
      '  <td><code>--all</code></td>',
      '  <td><p><code>boolean</code></p>',
      '</td>',
      '</tr>',
      '<tr class="option-description odd"><td colspan="3">',
      '<p>Show all &lt;compiler&gt; options.</p>',
      '</td></tr>',
      '',
      '<tr><td><code>--a</code><br/><code>--b</code></td><td></td></tr>',
      '</table>',
    ].join('\n')
    expect(htmlToText(html)).toBe(
      'Flag | Type\n`--all` | `boolean`\nShow all <compiler> options.\n`--a` `--b` |',
    )
  })

  it('adds no space where an inline tag closes before punctuation', () => {
    expect(
      htmlToText(
        "<tr><td><code>true</code> if <a href='#strict'><code>strict</code></a>; <code>false</code> otherwise.</td></tr>",
      ),
    ).toBe('`true` if `strict`; `false` otherwise.')
  })

  it('leaves cells of a table that markdown split apart as plain text', () => {
    expect(htmlToText('</td>\n<td>')).toBe('')
  })

  it('returns nothing for media and comments', () => {
    expect(htmlToText("<video src='x.mp4' autoplay></video>")).toBe('')
    expect(htmlToText('<!-- hidden -->')).toBe('')
  })
})

describe('isHtmlComment', () => {
  it('recognizes a block that is only a comment', () => {
    expect(isHtmlComment('<!--\n## Hidden\n-->')).toBe(true)
    expect(isHtmlComment('<!-- note --><p>shown</p>')).toBe(false)
  })
})
