// `turbo gen source` scaffolds a documentation source (SPEC section 12). It stops
// where sources start to differ, at the parser, and the add-source skill goes on from there.
import type { PlopTypes } from '@turbo/gen'

/** Source-kit's doc types. A template cannot be checked against them, so the prompt is. */
const DOC_TYPES = ['handbook', 'reference', 'option', 'release-notes', 'other']

const required = (value: unknown): true | string =>
  typeof value === 'string' && value.trim() !== '' ? true : 'This cannot be empty.'

const httpsUrl = (value: unknown): true | string =>
  typeof value === 'string' && /^https:\/\/[^\s/]+(\/\S*)?$/.test(value)
    ? true
    : 'Give an https URL.'

/** `src/content/learn:handbook,src/content/reference:reference` as a list. */
function includeList(value: string): { dir: string; docType: string }[] {
  return value.split(',').map((pair) => {
    const [dir = '', docType = ''] = pair.trim().split(':')
    return { dir: dir.replace(/\/+$/, ''), docType }
  })
}

function validIncludes(value: unknown): true | string {
  if (typeof value !== 'string' || value.trim() === '') return 'Give at least one dir:docType.'
  for (const { dir, docType } of includeList(value)) {
    if (dir === '') return 'Each entry needs a directory, as dir:docType.'
    if (!DOC_TYPES.includes(docType)) {
      return `"${docType}" is not a doc type: use one of ${DOC_TYPES.join(', ')}.`
    }
  }
  return true
}

/** A value as a TypeScript string, with the quotes Prettier would give it. */
function quoted(value: string): string {
  const text = value.replaceAll('\\', '\\\\')
  if (text.includes("'") && !text.includes('"')) return `"${text}"`
  return `'${text.replaceAll("'", "\\'")}'`
}

export default function generator(plop: PlopTypes.NodePlopAPI): void {
  plop.setHelper('includeList', includeList)
  plop.setHelper('quoted', quoted)
  plop.setHelper('escapeRegex', (value: string) =>
    value.replace(/[.*+?^${}()|[\]\\/]/g, String.raw`\$&`),
  )

  plop.setGenerator('source', {
    description: 'A documentation source in packages/sources/<id>',
    prompts: [
      {
        type: 'input',
        name: 'id',
        message: 'Source id, in lowercase, as in react or rust-book',
        validate: (value: unknown) =>
          typeof value === 'string' && /^[a-z][a-z0-9]*(-[a-z0-9]+)*$/.test(value)
            ? true
            : 'Use lowercase letters, digits and single hyphens, starting with a letter.',
      },
      { type: 'input', name: 'repo', message: 'Upstream repository URL', validate: httpsUrl },
      { type: 'input', name: 'branch', message: 'Upstream branch', validate: required },
      {
        type: 'input',
        name: 'site',
        message: 'Public site, as in https://react.dev',
        validate: httpsUrl,
      },
      {
        type: 'input',
        name: 'includes',
        message: 'Directories to index with their doc types, as dir:docType,dir:docType',
        validate: validIncludes,
      },
      { type: 'input', name: 'licenseName', message: 'License of the docs', validate: required },
      { type: 'input', name: 'licenseUrl', message: 'URL of that license', validate: httpsUrl },
      { type: 'input', name: 'attribution', message: 'Attribution line', validate: required },
    ],
    actions: [
      {
        type: 'addMany',
        destination: '{{turbo.paths.root}}/packages/sources/{{id}}',
        base: 'templates/source',
        templateFiles: 'templates/source/**/*.hbs',
        stripExtensions: ['hbs'],
      },
    ],
  })
}
