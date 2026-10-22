import assert from 'node:assert/strict'
import test from 'node:test'
import { readFile } from 'node:fs/promises'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { createServer } from 'vite'
import react from '@vitejs/plugin-react'

test('cross-view status preserves paused context without presenting stale work as running', { timeout: 30000 }, async t => {
  const vite = await createServer({ configFile: false, envFile: false, appType: 'custom', logLevel: 'silent',
    server: { middlewareMode: true, hmr: false }, plugins: [react()] })
  t.after(() => vite.close())
  const { default: Status } = await vite.ssrLoadModule('/src/components/WorkStatus.tsx')
  const { default: Subjects } = await vite.ssrLoadModule('/src/components/Subjects.tsx')
  const previous = globalThis.window
  globalThis.window = { location: { href: 'https://flow.asinfra.no/?view=tasks&source=test#study-content' } }
  try {
    const catalog = { areas: [{ id: 'area', name: 'Nettverk', is_archived: false }], tasks: [{ id: 'task', title: 'Dokumenter lab' }] }
    const segment = { area_id: 'area', task_id: 'task', ended_at: null }
    const workspace = { phase: 'running', catalog, data: { current: { segments: [segment] } } }
    const render = (data, view = 'tasks') => renderToStaticMarkup(createElement(Status, {
      data, location: { view, insight: 'history' }, navigate: () => assert.fail('Rendering must not navigate'),
    }))
    for (const view of ['tasks', 'insights']) {
      assert.match(render(workspace, view), /Arbeider · Nettverk · Dokumenter lab/)
      const paused = { ...workspace, phase: 'paused', data: { current: { segments: [{ ...segment, ended_at: '2026-10-22T10:00:00Z' }] } } }
      const html = render(paused, view)
      assert.match(html, /Pauset · Siste aktivitet · Nettverk · Dokumenter lab/)
      assert.doesNotMatch(html, /Arbeider ·/)
      assert.match(html, /href="https:\/\/flow.asinfra.no\/\?source=test#study-content"/)
      assert.match(html, /Til Arbeid →/)
      const archived = { ...paused, catalog: { ...catalog, areas: [{ ...catalog.areas[0], is_archived: true }] } }
      assert.match(render(archived, view), /Pauset · Siste aktivitet/)
    }
    for (const phase of ['recovering', 'error']) {
      const html = render({ ...workspace, phase })
      assert.match(html, phase === 'recovering' ? /Kontrollerer arbeidsstatus/ : /Arbeidsstatus må kontrolleres/)
      assert.doesNotMatch(html, /Arbeider ·|Pauset ·/)
    }
    assert.equal(render(workspace, 'work'), '')
    assert.equal(render({ ...workspace, phase: 'idle', data: { current: null } }), '')
    assert.equal(render({ ...workspace, phase: 'loading', data: null }), '')
    const areas = renderToStaticMarkup(createElement(Subjects, { tasks: [], data: {
      subjects: catalog.areas, status: 'loading', busy: true, notice: '', error: null,
    } }))
    assert.match(areas, /Oppdaterer områdene dine/)
    assert.match(areas, /Nettverk/)
    assert.match(areas, /disabled=""/)
    assert.doesNotMatch(areas, /Organisering/)
  } finally { if (previous === undefined) delete globalThis.window; else globalThis.window = previous }
})

test('dialog trap excludes closed details content, not the summary; legacy/public timer CSS stays intact', async () => {
  const panel = await readFile(new URL('../src/components/DetailPanel.tsx', import.meta.url), 'utf8')
  assert.match(panel, /!element\.closest\('details:not\(\[open\]\) > :not\(summary\)'\)/)
  assert.match(panel, /element\.tabIndex >= 0/)
  assert.match(panel, /!element\.matches\(':disabled'\)/)
  const css = await readFile(new URL('../src/styles.css', import.meta.url), 'utf8')
  assert.doesNotMatch(css, /\.account-controls|\.detail-actions/)
  for (const selector of ['.timer-current', '.timer-clock', '.timer-start', '.timer-saved']) assert.ok(css.includes(selector))
})
