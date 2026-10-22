import assert from 'node:assert/strict'
import test from 'node:test'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { createServer } from 'vite'
import react from '@vitejs/plugin-react'
import { addDays, flowPeriodLabel, mapFlowStatistics, periodDates } from '../src/lib/flow-statistics.ts'
import { mapFlowHistoryPage } from '../src/lib/flow-history.ts'

const id = n => `10000000-0000-4000-8000-${String(n).padStart(12, '0')}`
const date = '2026-10-21', serverTime = '2026-10-22T12:00:00Z'
const area = { id: id(1), name: 'Arkivert testområde', code: 'TEST', is_archived: true, created_at: serverTime }
function summary(kind = 'week', total = 3601123) {
  const period = { kind, anchor: kind === 'total' ? null : date }, dates = periodDates(period), days = []
  const areas = total ? [{ ...area, work: total }] : []
  if (dates) for (let d = dates.from; d < dates.to; d = addDays(d, 1)) days.push({ date: d, total: d === dates.from ? total : 0, areas: d === dates.from && total ? [{ id: area.id, work: total }] : [] })
  return mapFlowStatistics({ period: { ...period, from_date: dates?.from ?? null, to_date: dates?.to ?? null, timezone: 'UTC' },
    server_time: serverTime, total, days, areas, contributions: total ? [{ area_id: area.id, task_id: id(10), source: 'flow', title: 'Oppgavebidrag', status: 'completed', work: total }] : [],
    task_date: date, task_today: null, task_current: null, legacy_timezone_error: null })
}
function historyRows() {
  const start = '2026-10-21T10:00:00Z', end = '2026-10-21T12:00:00Z'
  return mapFlowHistoryPage({ server_time: serverTime, next_cursor: null, rows: [
    { source: 'flow', id: id(20), started_at: start, snapshot: { server_time: serverTime,
      work_day: { id: id(20), logical_date: date, timezone: 'UTC', boundary_at: '2026-10-21T04:00:00Z', cutoff_at: '2026-10-22T04:00:00Z', started_at: start, ended_at: end, created_at: start },
      segments: [{ id: id(21), work_day_id: id(20), area_id: area.id, task_id: id(10), started_at: start, ended_at: '2026-10-21T11:00:00Z', created_at: start }] } },
    { source: 'legacy-study', id: id(30), started_at: '2026-10-20T10:00:00Z', snapshot: {
      session: { id: id(30), subject_id: area.id, description: 'Eldre beskrivelse', started_at: '2026-10-20T10:00:00Z', ended_at: '2026-10-20T11:00:00Z' }, subject: area,
      segments: [{ id: id(31), session_id: id(30), started_at: '2026-10-20T10:00:00Z', ended_at: '2026-10-20T11:00:00Z' }] } },
  ] }).rows
}
const noop = () => {}
const history = (kind = 'week', changes = {}) => ({ period: summary(kind).period, statistics: summary(kind), statisticsStatus: 'ready', statisticsError: null,
  selectedArea: null, area: null, areaStatus: 'ready', areaError: null, mutation: null, timezone: 'UTC', now: () => Date.parse(serverTime), rows: historyRows(),
  status: 'ready', loadingMore: false, notice: '', error: null, listError: null, cursor: null, selectPeriod: noop, selectArea: noop, setTimezone: noop, reload: noop, ...changes })

test('Innsikt presentation preserves periods, sources, errors, completed minutes and secondary export', { timeout: 30000 }, async t => {
  // The app is client-only. Isolate the export data hook for server rendering;
  // browser QA exercises the real hook, requests, cancellation and downloads.
  const exportFixture = {
    name: 'insights-export-fixture', enforce: 'pre',
    resolveId(source) { if (source === '../hooks/useFlowExport') return '\0insights-export-fixture' },
    load(source) { if (source === '\0insights-export-fixture') return `export const useFlowExport = () => ({phase:'idle', report:null, resolvedPeriod:null, error:null, notice:'', cancel(){}})` },
  }
  const vite = await createServer({ configFile: false, envFile: false, appType: 'custom', logLevel: 'silent', server: { middlewareMode: true, hmr: false }, plugins: [exportFixture, react()] })
  t.after(() => vite.close())
  const { default: Statistics } = await vite.ssrLoadModule('/src/components/FlowStatistics.tsx')
  const { default: History } = await vite.ssrLoadModule('/src/components/FlowHistory.tsx')
  const { default: Export } = await vite.ssrLoadModule('/src/components/FlowExport.tsx')
  const { default: Report } = await vite.ssrLoadModule('/src/components/FlowReport.tsx')
  const renderStats = data => renderToStaticMarkup(createElement(Statistics, { data, catalog: { areas: [area], tasks: [] } }))
  const renderHistory = data => renderToStaticMarkup(createElement(History, { data, catalog: { areas: [area], tasks: [] }, subjects: { status: 'ready', busy: false, subjects: [area] } }))

  await t.test('all four periods put summary and areas before advanced controls, keep exact duration display and text alternatives', () => {
    for (const kind of ['day', 'week', 'month', 'total']) {
      const html = renderStats(history(kind))
      assert.match(html, />1 t</)
      assert.doesNotMatch(html, /01:00:01|timer:minutter:sekunder/)
      assert.ok(html.indexOf('Total arbeidstid') < html.indexOf('statistics-areas-title'))
      assert.ok(html.indexOf('statistics-areas-title') < html.indexOf('statistics-figure'))
      assert.ok(html.indexOf('Vis tallgrunnlag') < html.indexOf('Avansert: Tidssoner'))
      assert.match(html, /Arkivert/); assert.match(html, /<caption>Faktisk arbeidstid/)
      assert.match(html, /aria-pressed="true"/)
      if (kind === 'total') assert.doesNotMatch(html, /aria-label="(?:Forrige|Neste) /)
      else assert.match(html, /aria-label="Forrige /)
    }
  })
  await t.test('empty periods retain zero summary/table but no decorative empty chart or legend', () => {
    for (const kind of ['day', 'week', 'month', 'total']) {
      const html = renderStats(history(kind, { statistics: summary(kind, 0) }))
      assert.match(html, /Ingen registrert arbeidstid i denne perioden/); assert.match(html, />0 min</)
      assert.doesNotMatch(html, /<figure|class="statistics-legend"/); assert.match(html, /Vis tallgrunnlag/)
    }
  })
  await t.test('area detail has back navigation, four totals, archived status and contributions; missing and Annet remain distinct', () => {
    const areaStats = Object.fromEntries(['day', 'week', 'month', 'total'].map(kind => [kind, summary(kind)]))
    const data = history('week', { selectedArea: { id: area.id }, area: areaStats })
    const html = renderStats(data)
    for (const text of ['← Samlet statistikk', 'Områdedetaljer', 'Arkivert område', 'I dag', 'Denne uken', 'Denne måneden', 'Totalt', 'Oppgavebidrag', 'Fullført']) assert.ok(html.includes(text))
    assert.doesNotMatch(html, /aria-label="Statistikkperiode"/)
    assert.match(renderStats({ ...data, selectedArea: { id: id(999) } }), /Utilgjengelig område/)
    assert.match(renderStats({ ...data, selectedArea: { id: null } }), />Annet</)
  })
  await t.test('loading, independent statistics/area errors and legacy zone warnings preserve their own retry/context', () => {
    assert.match(renderStats(history('week', { statisticsStatus: 'loading', statistics: null })), /role="status">Henter statistikk/)
    assert.match(renderStats(history('week', { statisticsStatus: 'error', statisticsError: 'Statistikkfeil', statistics: null })), /Statistikkfeil/)
    assert.match(renderStats(history('week', { selectedArea: { id: area.id }, areaStatus: 'error', areaError: 'Områdefeil' })), /Områdefeil/)
    const html = renderStats(history('week', { timezone: 'invalid', statistics: { ...summary(), legacy_timezone_error: 'invalid-zone' } }))
    assert.match(html, /Native Flow-data vises fortsatt/); assert.match(html, />1 t</); assert.match(html, /Bruk tidssone/)
  })
  await t.test('work log keeps closed native timelines, explicit pause/work, correction and separate legacy editor/delete without period filtering', () => {
    const html = renderHistory(history())
    assert.match(html, /<h2[^>]*>Arbeidslogg</)
    assert.equal((html.match(/class="history-periods"/g) ?? []).length, 2)
    assert.doesNotMatch(html, /<details[^>]*open=/)
    assert.match(html, /Arbeidsperiode/); assert.match(html, /Pause · 1 t/)
    assert.match(html, /Korriger tilknytning/); assert.match(html, /Eldre registrering/)
    assert.match(html, /Rediger registrering/); assert.match(html, /Slett registrering/)
    assert.match(html, /Listen er paginert, ikke filtrert etter perioden/)
    assert.ok(html.indexOf('Vis tidslinje') < html.indexOf('Første aktivitet'))
  })
  await t.test('history empty/error/more/loading remain separate and never imply loaded rows are the full filtered period', () => {
    assert.match(renderHistory(history('week', { rows: [] })), /Ingen avsluttede arbeidsdager/)
    assert.match(renderHistory(history('week', { rows: [], status: 'loading' })), /Henter arbeidslogg/)
    assert.match(renderHistory(history('week', { status: 'loading' })), /Oppdaterer arbeidsloggen/)
    assert.match(renderHistory(history('week', { listError: 'Listefeil' })), /Listefeil/)
    assert.match(renderHistory(history('week', { cursor: { at: serverTime, source: 'flow', id: id(20) } })), />Vis flere</)
  })
  await t.test('export initializes from the selected historical period, keeps CSV/report separate and hides technical details initially', () => {
    for (const kind of ['day', 'week', 'month', 'total']) {
      const data = history(kind), html = renderToStaticMarkup(createElement(Export, { history: data }))
      assert.ok(html.includes(flowPeriodLabel(data.period)))
      assert.match(html, /ikke bare de innlastede radene/); assert.match(html, /Last ned CSV/); assert.match(html, /Vis rapport/)
      assert.ok(html.indexOf('Last ned CSV') < html.indexOf('Avansert: Tidssone'))
      assert.doesNotMatch(html, /<details[^>]*open=/)
    }
  })
  await t.test('report remains a document with table captions, minutes and zero periods without a blank chart', () => {
    const html = renderToStaticMarkup(createElement(Report, { data: summary() }))
    assert.match(html, />1 t</); assert.equal((html.match(/<caption/g) ?? []).length, 3)
    assert.match(html, /Oppgavebidrag/); assert.match(html, /Flow arbeidsrapport/)
    assert.match(html, /<h2 class="report-title">Arbeidsrapport/)
    const preview = renderToStaticMarkup(createElement(Report, { data: summary(), preview: true }))
    assert.match(preview, /<h4 class="report-title">Arbeidsrapport/)
    assert.match(preview, /<h5 class="report-section-title">Arbeid per område/)
    assert.doesNotMatch(preview, /<h[23]/)
    const empty = renderToStaticMarkup(createElement(Report, { data: summary('month', 0) }))
    assert.match(empty, /Ingen registrert arbeidstid/); assert.doesNotMatch(empty, /<figure/)
  })
})
