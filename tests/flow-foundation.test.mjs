import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

const source = path => readFile(new URL('../' + path, import.meta.url), 'utf8')

test('Flow branding prepares its domain and preserves the separate legacy compatibility APIs', async () => {
  const header = await source('src/components/AppHeader.tsx')
  const html = await source('index.html')
  assert.match(header, /<h1>Flow<\/h1>/)
  assert.match(html, /<title>Flow \| ASInfra<\/title>/)
  assert.match(html, /rel="canonical" href="https:\/\/flow\.asinfra\.no\/"/)
  assert.match(html, /property="og:url" content="https:\/\/flow\.asinfra\.no\/"/)
  assert.match(await source('README.md'), /https:\/\/flow\.asinfra\.no\//)
  assert.match(await source('vite.config.ts'), /base: '\/'/)
  for (const file of ['subjects.ts', 'study-sessions.ts', 'study-history.ts']) {
    const api = await source('src/lib/' + file)
    assert.doesNotMatch(api, /\.(?:from|rpc)\(['"]flow_/)
  }
  assert.match(await source('src/lib/subjects.ts'), /\.from\('subjects'\)/)
  assert.match(await source('src/lib/study-sessions.ts'), /study_session_transition/)
  assert.match(await source('src/lib/study-history.ts'), /study_session_history/)
})
