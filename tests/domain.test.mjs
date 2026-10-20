import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import { productionAssets } from '../scripts/build-contract.mjs'

const entry = '<link rel="canonical" href="https://flow.asinfra.no/">' +
  '<meta property="og:url" content="https://flow.asinfra.no/">' +
  '<script type="module" src="/assets/index.js"></script><link rel="stylesheet" href="/assets/index.css">'

test('build separates canonical metadata from root-based production assets', () => {
  assert.deepEqual(productionAssets(entry), ['/assets/index.js', '/assets/index.css'])
  for (const invalid of [
    entry.replace('/assets/index.js', '/study/assets/index.js'),
    entry.replace('/assets/index.css', 'assets/index.css'),
    entry.replaceAll('https://flow.asinfra.no/', 'https://study.asinfra.no/'),
    entry.replace('<link rel="canonical" href="https://flow.asinfra.no/">', ''),
    entry.replace('<meta property="og:url" content="https://flow.asinfra.no/">', ''),
  ]) assert.throws(() => productionAssets(invalid))
})

test('domain preparation leaves Auth origin, session recovery and Pages architecture intact', async () => {
  const source = path => readFile(new URL('../' + path, import.meta.url), 'utf8')
  assert.match(await source('src/components/AuthForm.tsx'), /authRedirectUrl\(window.location.origin, import.meta.env.BASE_URL\)/)
  const sdk = await source('src/lib/supabase.ts')
  for (const flag of ['persistSession', 'autoRefreshToken', 'detectSessionInUrl']) assert.ok(sdk.includes(flag + ': true'))
  const workflow = await source('.github/workflows/pages.yml')
  assert.match(workflow, /name: Validate and deploy Flow/)
  assert.match(workflow, /group: flow-pages-/)
  assert.match(workflow, /name: Deploy Flow/)
  assert.match(workflow, /path: dist/)
  assert.match(workflow, /github.event_name != 'pull_request' && github.ref == 'refs\/heads\/main'/)
})
