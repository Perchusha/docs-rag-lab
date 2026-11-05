import { fileURLToPath } from 'node:url'

import {
  chunkDocument,
  listSourceFiles,
  readSourceFile,
  type Block,
  type ParsedDoc,
} from '@docs-rag-lab/source-kit'
import { describe, expect, it } from 'vitest'

import { matchPath, reactSource } from './index.ts'

const fixtureRoot = fileURLToPath(new URL('../__fixtures__/repo/', import.meta.url))
const LEARN = 'src/content/learn'
const REFERENCE = 'src/content/reference'

const source = reactSource()

function parse(path: string): Promise<ParsedDoc> {
  return source.parse(readSourceFile(fixtureRoot, path), { commitSha: undefined })
}

/** Parses a snippet as the body of a page, for what a short example shows best. */
function parseBody(body: string, frontmatter = 'title: A page'): Promise<ParsedDoc> {
  const content = `---\n${frontmatter}\n---\n\n${body}\n`
  return source.parse({ path: `${LEARN}/a-page.md`, content }, { commitSha: undefined })
}

function allBlocks(doc: ParsedDoc): Block[] {
  return doc.sections.flatMap((section) => section.blocks)
}

function sectionAt(doc: ParsedDoc, anchor: string) {
  const section = doc.sections.find((candidate) => candidate.anchor === anchor)
  if (section === undefined) throw new Error(`no section ${anchor}`)
  return section
}

function proseOf(blocks: readonly Block[]): string {
  return blocks
    .flatMap((block) => {
      if (block.kind === 'prose') return [block.text]
      return block.kind === 'callout' ? [proseOf(block.blocks)] : []
    })
    .join('\n')
}

describe('reactSource', () => {
  it('describes the upstream repository and its two include paths', () => {
    expect(source).toMatchObject({
      id: 'react',
      repo: 'https://github.com/reactjs/react.dev',
      branch: 'main',
      include: [LEARN, REFERENCE],
      license: { name: 'CC BY 4.0' },
    })
  })

  it('takes the branch from its options', () => {
    expect(reactSource({ branch: 'other' }).branch).toBe('other')
  })
})

describe('matchPath', () => {
  it('takes the markdown of the two sections', () => {
    expect(matchPath(`${LEARN}/index.md`)).toBe(true)
    expect(matchPath(`${REFERENCE}/react/useState.md`)).toBe(true)
  })

  it('leaves out the rest of the site', () => {
    expect(matchPath('src/content/blog/2024/12/05/react-19.md')).toBe(false)
    expect(matchPath('src/content/community/index.md')).toBe(false)
    expect(matchPath(`${LEARN}/picture.png`)).toBe(false)
  })

  it('leaves out the sandbox test, which is no page on the site', () => {
    expect(matchPath(`${LEARN}/rsc-sandbox-test.md`)).toBe(false)
  })
})

describe('urls and doc types', () => {
  it('maps a path to its page, keeping the case', async () => {
    const doc = await parse(`${REFERENCE}/react/useState.md`)
    expect(doc.url).toBe('https://react.dev/reference/react/useState')
    expect(doc.docType).toBe('reference')
  })

  it('gives an index file the URL of its folder', async () => {
    expect((await parse(`${LEARN}/react-compiler/index.md`)).url).toBe(
      'https://react.dev/learn/react-compiler',
    )
    expect((await parse(`${REFERENCE}/eslint-plugin-react-hooks/index.md`)).url).toBe(
      'https://react.dev/reference/eslint-plugin-react-hooks',
    )
  })

  it('calls learn a handbook', async () => {
    expect((await parse(`${LEARN}/keeping-components-pure.md`)).docType).toBe('handbook')
  })
})

describe('titles', () => {
  it('takes the title from the frontmatter', async () => {
    expect((await parse(`${REFERENCE}/rsc/use-server.md`)).title).toBe("'use server'")
  })

  it('reads the frontmatter a page of a tag writes instead', async () => {
    expect((await parse(`${REFERENCE}/react-dom/components/link.md`)).title).toBe('<link>')
  })

  it('refuses a page with no title', async () => {
    await expect(parseBody('Text.', 'other: thing')).rejects.toThrow('frontmatter has no title')
  })
})

describe('a page that is not stable', () => {
  it('says so in the title, which starts every chunk', async () => {
    const doc = await parse(`${REFERENCE}/react/experimental_taintObjectReference.md`)
    expect(doc.title).toBe('experimental_taintObjectReference (Experimental)')
    expect(doc.metadata.version).toBe('experimental')
    const chunks = chunkDocument(`${REFERENCE}/react/x.md`, doc)
    expect(chunks.length).toBeGreaterThan(1)
    for (const chunk of chunks) expect(chunk.text).toMatch(/^experimental_\w+ \(Experimental\)/)
  })

  it('names a release candidate', async () => {
    const doc = await parse(`${REFERENCE}/eslint-plugin-react-hooks/index.md`)
    expect(doc.title).toBe('eslint-plugin-react-hooks (RC)')
    expect(doc.metadata.version).toBe('rc')
  })

  it('leaves the title of a stable page alone', async () => {
    const doc = await parse(`${LEARN}/keeping-components-pure.md`)
    expect(doc.title).toBe('Keeping Components Pure')
    expect(doc.metadata).toEqual({})
  })

  it('refuses a version it does not know', async () => {
    await expect(parseBody('Text.', 'title: A\nversion: next')).rejects.toThrow(
      'an unknown version: next',
    )
  })

  it('writes the badges out, as the site shows them', async () => {
    const doc = await parseBody(
      '* <CanaryBadge /> **optional** `one`: A prop.\n* <ExperimentalBadge /> **optional** `two`: A prop.',
    )
    expect(proseOf(allBlocks(doc))).toBe(
      '* Canary only **optional** `one`: A prop.\n* Experimental only **optional** `two`: A prop.',
    )
  })

  it('keeps the box the page opens with', async () => {
    const doc = await parse(`${REFERENCE}/react/experimental_taintObjectReference.md`)
    const box = allBlocks(doc).find((block) => block.kind === 'callout')
    expect(box).toMatchObject({ variant: 'Experimental Feature' })
    expect(proseOf(box === undefined ? [] : [box])).toContain('not available in a stable version')
  })
})

describe('headings', () => {
  it('takes every anchor from the id the heading writes', async () => {
    const doc = await parse(`${LEARN}/keeping-components-pure.md`)
    expect(sectionAt(doc, 'where-you-_can_-cause-side-effects').headingPath).toEqual([
      'Where you can cause side effects',
    ])
  })

  it('keeps inline code in the heading text, without the backticks', async () => {
    const doc = await parse(`${REFERENCE}/react/useState.md`)
    expect(sectionAt(doc, 'usestate').headingPath).toEqual(['Reference', 'useState(initialState)'])
  })

  it('nests headings by their level', async () => {
    const doc = await parseBody(
      '## One {/*one*/}\n\nA.\n\n### Two {/*two*/}\n\nB.\n\n## Three {/*three*/}\n\nC.',
    )
    expect(doc.sections.map((section) => section.headingPath)).toEqual([
      ['One'],
      ['One', 'Two'],
      ['Three'],
    ])
  })

  it('leaves out a word the site strikes out', async () => {
    const doc = await parse(`${LEARN}/writing-markup-with-jsx.md`)
    expect(sectionAt(doc, '3-camelcase-salls-most-of-the-things').headingPath.at(-1)).toBe(
      '3. camelCase most of the things!',
    )
  })

  it('refuses a heading with no id, which upstream does not allow', async () => {
    await expect(parseBody('## Plain\n\nText.')).rejects.toThrow('a-page.md:5: a heading has no')
  })
})

describe('code', () => {
  it('keeps each file of an example, with its name', async () => {
    const doc = await parse(`${LEARN}/keeping-components-pure.md`)
    const code = allBlocks(doc).flatMap((block) =>
      block.kind === 'callout' ? block.blocks : [block],
    )
    expect(code).toContainEqual(expect.objectContaining({ kind: 'code', lang: 'js src/Clock.js' }))
  })

  it('leaves out the files the site hides', async () => {
    const doc = await parseBody(
      '<Sandpack>\n\n```js src/App.js active\nshown();\n```\n\n```json package.json hidden\n{}\n```\n\n```js src/data.js hidden\nnotShown();\n```\n\n```css\nb { }\n```\n\n</Sandpack>',
    )
    expect(allBlocks(doc)).toEqual([
      { kind: 'code', lang: 'js src/App.js', code: 'shown();' },
      { kind: 'code', lang: 'css', code: 'b { }' },
    ])
  })

  it('treats the example that shows its HTML the same way', async () => {
    const doc = await parse(`${REFERENCE}/react-dom/components/link.md`)
    expect(
      allBlocks(doc).some((block) => block.kind === 'code' && block.lang.endsWith('src/App.js')),
    ).toBe(true)
  })

  it('keeps only the language and the file name of an info string', async () => {
    const doc = await parseBody(
      [
        '```js{2-3,8-9}',
        'a();',
        '```',
        '',
        '```js {2,5}',
        'b();',
        '```',
        '',
        '```js [[1, 4, "age"], [2, 4, "set.Age"]]',
        'c();',
        '```',
        '',
        "```js {expectedErrors: {'react-compiler': [5, 7]}} src/Profile.js {5,8}",
        'd();',
        '```',
        '',
        '```[[1, 4, "age"]]',
        'e();',
        '```',
        '',
        '```',
        'f();',
        '```',
      ].join('\n'),
    )
    expect(
      allBlocks(doc).map((block) => (block.kind === 'code' ? block.lang : block.kind)),
    ).toEqual(['js', 'js', 'js', 'js src/Profile.js', '', ''])
  })

  it('takes a terminal block as code, verbatim', async () => {
    const doc = await parse(`${LEARN}/creating-a-react-app.md`)
    expect(allBlocks(doc)).toContainEqual({
      kind: 'code',
      lang: 'bash',
      code: 'npx create-next-app@latest',
    })
  })

  it('does not care for the blank lines inside a terminal block', async () => {
    const doc = await parseBody('<TerminalBlock>\n\nnpm install a\n\n</TerminalBlock>')
    expect(allBlocks(doc)).toEqual([{ kind: 'code', lang: 'bash', code: 'npm install a' }])
  })

  it('leaves code nested in a list inside the prose', async () => {
    const doc = await parseBody('1. Run:\n\n   ```js {1}\n   a();\n   ```')
    expect(allBlocks(doc)).toEqual([
      { kind: 'prose', text: '1. Run:\n\n   ```js {1}\n   a();\n   ```' },
    ])
  })
})

describe('callouts', () => {
  it.each([
    ['Note', 'Note'],
    ['Pitfall', 'Pitfall'],
    ['DeepDive', 'Deep Dive'],
    ['Deprecated', 'Deprecated'],
    ['Experimental', 'Experimental Feature'],
    ['Wip', 'Under Construction'],
    ['RSC', 'React Server Components'],
    ['Hint', 'Hint'],
    ['Solution', 'Solution'],
  ])('labels <%s> as the site does', async (component, variant) => {
    const doc = await parseBody(`<${component}>\n\nText.\n\n</${component}>`)
    expect(allBlocks(doc)).toEqual([
      { kind: 'callout', variant, blocks: [{ kind: 'prose', text: 'Text.' }] },
    ])
  })

  it('keeps a code block inside a callout', async () => {
    const doc = await parseBody('<Pitfall>\n\nText.\n\n```js\na();\n```\n\n</Pitfall>')
    expect(allBlocks(doc)).toEqual([
      {
        kind: 'callout',
        variant: 'Pitfall',
        blocks: [
          { kind: 'prose', text: 'Text.' },
          { kind: 'code', lang: 'js', code: 'a();' },
        ],
      },
    ])
  })

  it('names what a page opens with', async () => {
    const chapter = await parse(`${LEARN}/adding-interactivity.md`)
    expect(allBlocks(chapter)[1]).toMatchObject({ variant: 'In this chapter' })
    const page = await parse(`${LEARN}/keeping-components-pure.md`)
    expect(allBlocks(page)[1]).toMatchObject({ variant: 'You will learn' })
  })

  it('names the console messages by their level', async () => {
    const doc = await parseBody(
      '<ConsoleBlock level="error">\n\nBad.\n\n</ConsoleBlock>\n\n<ConsoleBlockMulti>\n<ConsoleLogLine level="warning">\n\nCareful.\n\n</ConsoleLogLine>\n</ConsoleBlockMulti>',
    )
    expect(allBlocks(doc)).toEqual([
      { kind: 'callout', variant: 'Console error', blocks: [{ kind: 'prose', text: 'Bad.' }] },
      {
        kind: 'callout',
        variant: 'Console warning',
        blocks: [{ kind: 'prose', text: 'Careful.' }],
      },
    ])
  })

  it('cuts a long one between its blocks, and each part keeps the label', async () => {
    const code = 'x'.repeat(2500)
    const doc = await parseBody(
      `<Solution>\n\nFirst.\n\n\`\`\`js\n${code}\n\`\`\`\n\n\`\`\`js\n${code}\n\`\`\`\n\nLast.\n\n</Solution>`,
    )
    const blocks = allBlocks(doc)
    expect(blocks.length).toBeGreaterThan(1)
    for (const block of blocks) expect(block).toMatchObject({ variant: 'Solution' })
    const inner = blocks.flatMap((block) => (block.kind === 'callout' ? block.blocks : []))
    expect(inner.map((block) => block.kind)).toEqual(['prose', 'code', 'code', 'prose'])
  })

  it('reads a box written on one line', async () => {
    const doc = await parseBody('<Hint>Look closer.</Hint>')
    expect(allBlocks(doc)).toEqual([
      { kind: 'callout', variant: 'Hint', blocks: [{ kind: 'prose', text: 'Look closer.' }] },
    ])
  })
})

describe('a component with headings inside', () => {
  it('gives a deep dive a section, with its anchor', async () => {
    const doc = await parse(`${LEARN}/understanding-your-ui-as-a-tree.md`)
    const section = sectionAt(doc, 'where-are-the-html-elements-in-the-render-tree')
    expect(section.headingPath).toEqual([
      'The Render Tree',
      'Where are the HTML tags in the render tree?',
    ])
    expect(section.blocks[0]).toMatchObject({ kind: 'callout', variant: 'Deep Dive' })
  })

  it('goes back to the heading before it for what follows it', async () => {
    const doc = await parse(`${LEARN}/understanding-your-ui-as-a-tree.md`)
    const sections = doc.sections.filter((section) => section.anchor === 'the-render-tree')
    expect(sections).toHaveLength(2)
    expect(sections[1]?.headingPath).toEqual(['The Render Tree'])
    expect(proseOf(sections[1]?.blocks ?? [])).toContain('A render tree represents')
    expect(new Set(chunkDocument('a.md', doc).map((chunk) => chunk.id)).size).toBe(
      chunkDocument('a.md', doc).length,
    )
  })

  it('needs no such return when a heading comes next', async () => {
    const doc = await parseBody(
      '## One {/*one*/}\n\n<DeepDive>\n\n#### Two {/*two*/}\n\nA.\n\n</DeepDive>\n\n## Three {/*three*/}\n\nB.',
    )
    expect(doc.sections.map((section) => section.anchor)).toEqual(['one', 'two', 'three'])
  })

  it('gives a heading inside a note or a pitfall its section too', async () => {
    const doc = await parse(`${REFERENCE}/react-dom/hooks/useFormStatus.md`)
    const section = sectionAt(
      doc,
      'useformstatus-will-not-return-status-information-for-a-form-rendered-in-the-same-component',
    )
    expect(section.blocks[0]).toMatchObject({ kind: 'callout', variant: 'Pitfall' })
  })

  it('reads a page where such a box holds another', async () => {
    const doc = await parseBody(
      '## One {/*one*/}\n\n<DeepDive>\n\n#### Two {/*two*/}\n\nA.\n\n<Note>\n\n#### Three {/*three*/}\n\nB.\n\n</Note>\n\nC.\n\n</DeepDive>\n\nD.',
    )
    expect(doc.sections.map((section) => section.headingPath.at(-1))).toEqual([
      'One',
      'Two',
      'Three',
      'Two',
      'One',
    ])
    expect(proseOf(doc.sections.at(-1)?.blocks ?? [])).toBe('D.')
    expect(doc.sections[2]?.blocks[0]).toMatchObject({
      kind: 'callout',
      variant: 'Deep Dive',
      blocks: [{ kind: 'callout', variant: 'Note' }],
    })
  })
})

describe('examples and challenges', () => {
  it('gives <Recipes> its title and anchor, with the examples under it', async () => {
    const doc = await parse(`${REFERENCE}/react/useState.md`)
    const title = 'Basic useState examples'
    expect(sectionAt(doc, 'examples-basic').headingPath.at(-1)).toBe(title)
    expect(sectionAt(doc, 'counter-number').headingPath.at(-2)).toBe(title)
  })

  it('falls back on the title and anchor the site gives', async () => {
    const doc = await parseBody('## One {/*one*/}\n\n<Recipes>\n\nA.\n\n</Recipes>')
    expect(sectionAt(doc, 'examples').headingPath).toEqual(['One', 'Try out some examples'])
  })

  it('takes a title with no anchor of its own', async () => {
    const doc = await parse(`${REFERENCE}/react-dom/preinit.md`)
    expect(sectionAt(doc, 'examples').headingPath.at(-1)).toBe('Examples of preiniting')
  })

  it('drops the empty <Solution /> that ends each example', async () => {
    const doc = await parse(`${REFERENCE}/react-dom/preinit.md`)
    expect(
      allBlocks(doc).some((block) => block.kind === 'callout' && block.variant === 'Solution'),
    ).toBe(false)
  })

  it('makes <Recap> and <Challenges> the h2s they are on the site', async () => {
    const doc = await parse(`${LEARN}/keeping-components-pure.md`)
    expect(sectionAt(doc, 'recap').headingPath).toEqual(['Recap'])
    expect(sectionAt(doc, 'challenges').headingPath).toEqual(['Try out some challenges'])
    expect(sectionAt(doc, 'fix-a-broken-clock').headingPath).toEqual([
      'Try out some challenges',
      'Fix a broken clock',
    ])
  })

  it('keeps the hint and the solution of a challenge', async () => {
    const doc = await parse(`${LEARN}/keeping-components-pure.md`)
    const variants = sectionAt(doc, 'fix-a-broken-clock').blocks.flatMap((block) =>
      block.kind === 'callout' ? [block.variant] : [],
    )
    expect(variants).toEqual(['Hint', 'Solution'])
  })
})

describe('pictures', () => {
  it('keeps the description and the caption of a diagram', async () => {
    const doc = await parseBody(
      '<Diagram name="a" height={1} width={2} alt="Two boxes and an arrow.">\n\nThe caption.\n\n</Diagram>',
    )
    expect(allBlocks(doc)).toEqual([
      {
        kind: 'callout',
        variant: 'Diagram',
        blocks: [
          { kind: 'prose', text: 'Two boxes and an arrow.' },
          { kind: 'prose', text: 'The caption.' },
        ],
      },
    ])
  })

  it('reads a diagram written on one line', async () => {
    const doc = await parseBody('<Diagram name="a" alt="Two boxes.">The caption.</Diagram>')
    expect(allBlocks(doc)[0]).toMatchObject({ kind: 'callout', variant: 'Diagram' })
  })

  it('keeps the description and the caption of an illustration', async () => {
    const doc = await parseBody(
      '<IllustrationBlock sequential>\n  <Illustration caption="Trigger" alt="A server." src="/a.png" />\n</IllustrationBlock>',
    )
    expect(allBlocks(doc)).toEqual([
      {
        kind: 'callout',
        variant: 'Illustration',
        blocks: [
          { kind: 'prose', text: 'A server.' },
          { kind: 'prose', text: 'Trigger' },
        ],
      },
    ])
  })

  it('takes the alt text of an image, once for a light and dark pair', async () => {
    const doc = await parse(`${REFERENCE}/dev-tools/react-performance-tracks.md`)
    const text = proseOf(allBlocks(doc))
    expect(text.match(/^React Performance Tracks$/gm)).toHaveLength(1)
  })

  it('has nothing to keep of an image with no alt text', async () => {
    const doc = await parseBody('<img src="/a.png" width="300" />')
    expect(allBlocks(doc)).toEqual([])
  })

  it('takes the alt text of a markdown image', async () => {
    const doc = await parse(`${LEARN}/react-developer-tools.md`)
    const text = proseOf(allBlocks(doc))
    expect(text).toContain('React Developer Tools extension')
    expect(text).not.toContain('/images/')
  })
})

describe('prose', () => {
  it('leaves no trace of a layout component', async () => {
    const doc = await parseBody(
      '<Intro>\n\nFirst.\n\n</Intro>\n\n<InlineToc />\n\n<LearnMore path="/learn/a">\n\nRead [this](/learn/a).\n\n</LearnMore>\n\n<FullWidth>\n\n<CodeDiagram flip>\n\nSecond.\n\n</CodeDiagram>\n\n</FullWidth>',
    )
    expect(allBlocks(doc)).toEqual([
      { kind: 'prose', text: 'First.' },
      { kind: 'prose', text: 'Read [this](/learn/a).' },
      { kind: 'prose', text: 'Second.' },
    ])
  })

  it('keeps the words of an inline component, and the markup around them', async () => {
    const doc = await parse(`${REFERENCE}/rsc/use-server.md`)
    expect(proseOf(allBlocks(doc))).toContain(
      'can only be called in [client code](/reference/rsc/use-client).',
    )
  })

  it('writes a formula out', async () => {
    const doc = await parse(`${LEARN}/keeping-components-pure.md`)
    expect(proseOf(allBlocks(doc))).toContain('Consider this math formula: y = 2x.')
  })

  it('keeps the word in a styled span', async () => {
    const doc = await parse(`${REFERENCE}/dev-tools/react-performance-tracks.md`)
    expect(proseOf(allBlocks(doc))).toContain('- Mount - A corresponding subtree')
  })

  it('reads a written space, and drops a comment', async () => {
    const doc = await parseBody("A<CodeStep step={1}>b</CodeStep>{' '}c{/* not this */}.")
    expect(proseOf(allBlocks(doc))).toBe('Ab c.')
  })

  it('leaves a comment in no block', async () => {
    const doc = await parseBody('{/* A TODO. */}\n\n[comment]: <> (Another.)\n\n---\n\nText.')
    expect(allBlocks(doc)).toEqual([{ kind: 'prose', text: 'Text.' }])
  })

  it('leaves out an import line', async () => {
    const doc = await parseBody("import A from './a.js'\n\nText.")
    expect(allBlocks(doc)).toEqual([{ kind: 'prose', text: 'Text.' }])
  })
})

describe('what the survey did not see', () => {
  it('refuses a component it does not know, and says where', async () => {
    await expect(parseBody('<NewBox>\n\nText.\n\n</NewBox>')).rejects.toThrow(
      'a-page.md:5: an unknown component: <NewBox>',
    )
  })

  it('refuses an inline component it does not know', async () => {
    await expect(parseBody('Text <NewBadge /> here.')).rejects.toThrow(
      'an unknown component: <NewBadge>',
    )
  })

  it('refuses a component inside markdown', async () => {
    await expect(parseBody('- Item\n\n  <Note>\n\n  Text.\n\n  </Note>')).rejects.toThrow(
      '<Note> inside markdown',
    )
  })

  it('refuses an expression that would need running', async () => {
    await expect(parseBody('Text {count} here.')).rejects.toThrow(
      'an unexpected expression: {count}',
    )
    await expect(parseBody('{count}')).rejects.toThrow('an unexpected expression: {count}')
  })
})

describe('the fixtures', () => {
  // Inline code and code blocks talk about components all the time, and so do titles and headings.
  function outsideCode(text: string): string {
    const lines = text.split('\n').slice(1)
    let fence: string | undefined
    const kept = lines.filter((line) => {
      const marker = /^\s*(`{3,})/.exec(line)?.[1]
      if (fence === undefined && marker !== undefined) {
        fence = marker
        return false
      }
      if (fence !== undefined) {
        if (line.trim() === fence) fence = undefined
        return false
      }
      return !/^#{1,6} /.test(line)
    })
    return kept.join('\n').replace(/`[^`\n]*`/g, '')
  }

  it('leave no component markup or import line in any chunk', async () => {
    for (const file of listSourceFiles(fixtureRoot, source)) {
      const doc = await source.parse(file, { commitSha: undefined })
      for (const chunk of chunkDocument(file.path, doc)) {
        const text = outsideCode(chunk.text)
        expect(text, chunk.id).not.toMatch(/<\/?(?:[A-Z][A-Za-z]*|div|img|span|s)(?:\s[^>]*)?\/?>/)
        expect(text, chunk.id).not.toMatch(/\{\/\*/)
        expect(text, chunk.id).not.toMatch(/^import\s.+from\s/m)
      }
    }
  })
})
