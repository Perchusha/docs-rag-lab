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

  it('turns table rows into lines', () => {
    expect(
      htmlToText(
        '<table><tr><td><code>--all</code></td><td>boolean</td></tr><tr><td>Show all.</td></tr></table>',
      ),
    ).toBe('`--all` boolean\nShow all.')
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
