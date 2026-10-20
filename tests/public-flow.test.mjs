import assert from 'node:assert/strict'
import test from 'node:test'
import { readFile } from 'node:fs/promises'
import { createElement, isValidElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { createServer } from 'vite'
import react from '@vitejs/plugin-react'

const source = path => readFile(new URL('../' + path, import.meta.url), 'utf8')
function components(node) {
  if (Array.isArray(node)) return node.flatMap(components)
  if (!isValidElement(node)) return []
  return [node, ...components(node.props.children)]
}

test('public Flow: real React presentation and authenticated Account gate', { timeout: 30000 }, async t => {
  // Compile existing TSX through Vite, without a browser, credentials or a listening server.
  const server = await createServer({ configFile: false, envFile: false, appType: 'custom', logLevel: 'silent',
    server: { middlewareMode: true, hmr: false }, plugins: [react()],
    define: { 'import.meta.env.VITE_SUPABASE_URL': 'undefined', 'import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY': 'undefined' } })
  t.after(() => server.close())
  const { AppView } = await server.ssrLoadModule('/src/App.tsx')
  const { default: Overview } = await server.ssrLoadModule('/src/components/PublicFlowOverview.tsx')
  const { default: Account } = await server.ssrLoadModule('/src/components/Account.tsx')
  const { publicWeekExample } = await server.ssrLoadModule('/src/lib/public-flow-example.ts')
  const auth = { session: null, loading: false, error: null }
  const session = { user: { id: 'private-id', email: 'must-not-be-public@example.test' } }
  const tree = (next = {}, configured = true) => AppView({ auth: { ...auth, ...next }, configured })
  const render = (next = {}, configured = true) => renderToStaticMarkup(tree(next, configured))

  await t.test('session goes straight to Account; loading never mounts the landing or private hooks', () => {
    const account = components(tree({ session })).find(n => n.type === Account)
    assert.equal(account.props.session, session)
    assert.ok(!components(tree({ session })).some(n => n.type === Overview))
    for (const pending of [{ loading: true }, { loading: true, session }]) {
      const nodes = components(tree(pending))
      assert.ok(!nodes.some(n => n.type === Overview || n.type === Account))
      assert.match(render(pending), /Henter innlogging/)
    }
  })
  await t.test('no session and logout show the overview and original login/registration form', () => {
    const html = render()
    assert.match(html, /Se hva du faktisk bruker arbeidstiden på/)
    assert.match(html, /Logg inn/); assert.match(html, /Ny her\? Opprett konto/)
    assert.match(html, /type="email"/); assert.match(html, /current-password/)
    assert.equal((html.match(/<h1[ >]/g) ?? []).length, 1)
    assert.equal((html.match(/<main[ >]/g) ?? []).length, 1)
    assert.match(html, /href="#study-content"/)
    assert.ok(!components(tree({ session })).some(n => n.type === Overview))
    assert.ok(components(tree({ session: null })).some(n => n.type === Overview))
    assert.doesNotMatch(html, /must-not-be-public|private-id/)
  })
  await t.test('configuration/session errors keep public content visible, never Account', () => {
    const html = render({ session, error: 'Kunne ikke gjenopprette innloggingen. Last siden på nytt og prøv igjen.' })
    assert.match(html, /role="alert"/); assert.match(html, /Kunne ikke gjenopprette/)
    assert.ok(!components(tree({ session, error: 'Session error' })).some(n => n.type === Account))
    const missing = render({}, false)
    assert.match(missing, /Se hva du faktisk bruker arbeidstiden på/)
    assert.match(missing, /mangler gyldig Supabase-konfigurasjon/)
    assert.doesNotMatch(missing, /type="password"/)
    assert.ok(!components(tree({ session }, false)).some(n => n.type === Account))
  })
  await t.test('examples are static and anonymous, reuse pure charts and have no app action buttons', async () => {
    const examples = await server.ssrLoadModule('/src/components/FlowExamples.tsx')
    for (const name of ['TimerExample', 'TasksExample', 'StatisticsExample', 'HistoryExample']) {
      const html = renderToStaticMarkup(createElement(examples[name]))
      assert.doesNotMatch(html, /<button|<form|<input|type="submit"|role="button"/)
      assert.doesNotMatch(html, /[0-9a-f]{8}-[0-9a-f-]{27,}|[\w.+-]+@[\w.-]+\.[a-z]{2,}/i)
      assert.match(html, /eksempel/i)
    }
    assert.equal(publicWeekExample.total, publicWeekExample.days.reduce((n, d) => n + d.total, 0))
    assert.equal(publicWeekExample.total, publicWeekExample.areas.reduce((n, a) => n + a.work, 0))
    const html = render()
    for (const term of ['Arbeidsdagen', 'Oppgaver og områder', 'Statistikk', 'Historikk og eksport', 'CSV', 'PDF', 'Annet']) assert.ok(html.includes(term))
  })
  await t.test('public presentation graph has no private hooks/API imports and navigation preserves Auth URL state', async () => {
    for (const path of ['src/components/PublicFlowOverview.tsx', 'src/components/FlowExamples.tsx', 'src/lib/public-flow-example.ts', 'src/components/StatisticsChart.tsx']) {
      assert.doesNotMatch(await source(path), /from ['"][^'"]*(?:hooks\/|supabase|flow-history-store|flow-export-store)|\.(?:rpc|from)\(|setInterval|fetch\(/)
    }
    const overview = await source('src/components/PublicFlowOverview.tsx')
    assert.match(overview, /scrollIntoView/); assert.match(overview, /focus\(/)
    assert.doesNotMatch(overview, /location\.|history\.(?:pushState|replaceState)|href="#/)
    const form = await source('src/components/AuthForm.tsx')
    assert.match(form, /signInWithPassword/); assert.match(form, /signUp/)
    assert.match(form, /authRedirectUrl\(window.location.origin, import.meta.env.BASE_URL\)/)
  })
})
