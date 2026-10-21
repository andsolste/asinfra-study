import assert from 'node:assert/strict'
import test from 'node:test'
import { readFile } from 'node:fs/promises'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { createServer } from 'vite'
import react from '@vitejs/plugin-react'
import { flowViews, flowLocationUrl, readFlowLocation } from '../src/lib/flow-navigation.ts'

test('navigation restores the three main views and both insight views on reload', () => {
  assert.deepEqual(Object.values(flowViews), ['Arbeid', 'Oppgaver', 'Innsikt'])
  for (const [suffix, expected] of [
    ['/', { view: 'work', insight: 'overview' }],
    ['/?view=tasks', { view: 'tasks', insight: 'overview' }],
    ['/?view=insights', { view: 'insights', insight: 'overview' }],
    ['/?view=insights&section=history', { view: 'insights', insight: 'history' }],
    ['/?view=unknown&section=unknown', { view: 'work', insight: 'overview' }],
    ['/?view=https://evil.example/', { view: 'work', insight: 'overview' }],
  ]) assert.deepEqual(readFlowLocation('https://flow.asinfra.no' + suffix), expected)
})

test('URLs are static-host safe, preserve Auth query/hash and work on localhost/subpaths', () => {
  for (const origin of ['https://flow.asinfra.no/', 'http://localhost:5173/', 'https://example.test/preview/']) {
    const href = origin + '?code=example&next=%2Ftest&view=unknown#access_token=example&refresh_token=example'
    for (const view of ['work', 'tasks', 'insights']) for (const insight of ['overview', 'history']) {
      const next = new URL(flowLocationUrl(href, { view, insight }))
      assert.equal(next.origin + next.pathname, origin)
      assert.equal(next.searchParams.get('code'), 'example')
      assert.equal(next.searchParams.get('next'), '/test')
      assert.equal(next.hash, '#access_token=example&refresh_token=example')
      assert.equal(next.searchParams.get('view'), view === 'work' ? null : view)
      assert.equal(next.searchParams.get('section'), view === 'insights' && insight === 'history' ? 'history' : null)
      assert.equal(flowLocationUrl(next.href, { view, insight }), next.href, 'Same selection must not create a new URL')
    }
  }
})

test('Back/Forward can restore each URL without depending on history.state or a server route', () => {
  const locations = [{ view: 'work', insight: 'overview' }, { view: 'tasks', insight: 'overview' },
    { view: 'insights', insight: 'history' }]
  let href = 'https://flow.asinfra.no/?source=test#study-content'
  const entries = locations.map(location => (href = flowLocationUrl(href, location)))
  for (const index of [2, 1, 0, 1, 2]) assert.deepEqual(readFlowLocation(entries[index]), locations[index])
})

test('real navigation uses semantic current links and leaves modified clicks to the browser', { timeout: 30000 }, async t => {
  const server = await createServer({ configFile: false, envFile: false, appType: 'custom', logLevel: 'silent',
    server: { middlewareMode: true, hmr: false }, plugins: [react()] })
  t.after(() => server.close())
  const { default: Navigation, followFlowLink } = await server.ssrLoadModule('/src/components/FlowNavigation.tsx')
  const previous = globalThis.window
  globalThis.window = { location: { href: 'https://flow.asinfra.no/?source=test#study-content' } }
  try {
    for (const view of ['work', 'tasks', 'insights']) {
      const html = renderToStaticMarkup(createElement(Navigation, { location: { view, insight: 'overview' }, navigate: () => {} }))
      assert.match(html, /<nav[^>]*aria-label="Hovednavigasjon"/)
      assert.equal((html.match(/<a /g) ?? []).length, 3)
      assert.equal((html.match(/aria-current="page"/g) ?? []).length, 1)
      assert.match(html, new RegExp(`aria-current="page">${flowViews[view]}</a>`))
      assert.match(html, /source=test/); assert.match(html, /#study-content/)
    }
    let followed = 0, prevented = 0
    const event = extra => ({ button: 0, defaultPrevented: false, preventDefault: () => prevented++, ...extra })
    followFlowLink(event({}), () => followed++)
    assert.equal(followed, 1); assert.equal(prevented, 1)
    for (const extra of [{ button: 1 }, { ctrlKey: true }, { metaKey: true }, { shiftKey: true }, { altKey: true }, { defaultPrevented: true }]) {
      followFlowLink(event(extra), () => followed++)
    }
    assert.equal(followed, 1); assert.equal(prevented, 1)
  } finally { if (previous === undefined) delete globalThis.window; else globalThis.window = previous }
})

test('workspace keeps a single owner, persistent forms and only secondary account/export dialogs', async () => {
  const source = file => readFile(new URL('../' + file, import.meta.url), 'utf8')
  const account = await source('src/components/Account.tsx')
  assert.equal((account.match(/useFlowWorkDay\(\)/g) ?? []).length, 1)
  assert.match(account, /hidden=\{location\.view !== 'work'\}/)
  assert.match(account, /hidden=\{location\.view !== 'tasks'\}/)
  assert.match(account, /hidden=\{location\.view !== 'insights'\}/)
  assert.doesNotMatch(account, /key=\{location|panel === '(?:tasks|statistics|history)'/)
  assert.match(account, /panel === 'export' && <FlowExport/)
  assert.match(account, /panel === 'subjects' && <Subjects/)
  const hook = await source('src/hooks/useFlowNavigation.ts')
  assert.match(hook, /addEventListener\('popstate'/)
  assert.match(hook, /removeEventListener\('popstate'/)
  assert.match(hook, /if \(href !== window\.location\.href\)/)
  assert.match(hook, /pushState\(window\.history\.state, '', href\)/)
  assert.doesNotMatch(hook, /replaceState|location\.(assign|replace)|localStorage/)
  const timer = await source('src/components/FlowTimer.tsx')
  assert.ok(timer.indexOf('Dagen avsluttes ved') > timer.indexOf("panel === 'day' &&"))
  assert.doesNotMatch(await source('src/components/FlowStatistics.tsx'), /04:00 til neste/)
})
