import assert from 'node:assert/strict'
import test from 'node:test'
import { createClient } from '@supabase/supabase-js'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { createServer } from 'vite'
import react from '@vitejs/plugin-react'
import { nativeDraft, nativeLocalMinute, nativeMinuteInstant, buildNativeCorrection, nativeCorrectionWork, interruptedPeriod } from '../src/lib/native-period.ts'
import { createFlowHistoryApi, NativeCorrectionError, nativeHistoryWork } from '../src/lib/flow-history.ts'
import { createFlowHistoryStore } from '../src/lib/flow-history-store.ts'
import { mapFlowSnapshot } from '../src/lib/flow-work.ts'

const id = n => `10000000-0000-4000-8000-${String(n).padStart(12, '0')}`
const now = Date.parse('2026-10-22T22:30:00Z'), server = new Date(now).toISOString(), tick = () => new Promise(r => setImmediate(r))
function snapshot(open = false) {
  const from = '2026-10-22T18:00:03.123456Z'
  return mapFlowSnapshot({ server_time: server, work_day: { id: id(1), timezone: 'UTC', logical_date: '2026-10-22',
    boundary_at: '2026-10-22T04:00:00Z', cutoff_at: '2026-10-23T04:00:00Z', started_at: from, ended_at: open ? null : '2026-10-23T04:00:00Z', created_at: from },
    segments: [{ id: id(2), work_day_id: id(1), started_at: from, ended_at: open ? null : '2026-10-22T22:00:04.654321Z', area_id: id(3), task_id: id(4), created_at: from }] })
}
const catalog = { areas: [{ id: id(3), name: 'Operativsystemer', is_archived: true }], tasks: [{ id: id(4), area_id: id(3), title: 'Lesing', status: 'completed' }] }
function input(s = snapshot(), draft = {}) { return buildNativeCorrection(s, s.segments[0], { ...nativeDraft(s, s.segments[0]), ...draft }, now, catalog) }

test('stored timezone independent of current browser; unchanged timestamps keep exact seconds/microseconds', () => {
  const s = snapshot(); s.work_day.timezone = 'America/Los_Angeles'
  const before = process.env.TZ
  try {
    for (const zone of ['Europe/Oslo', 'UTC', 'Pacific/Auckland']) {
      process.env.TZ = zone
      const draft = nativeDraft(s, s.segments[0]); assert.equal(draft.from, '2026-10-22T11:00')
      const result = input(s); assert.equal(result.desired.started_at, s.segments[0].started_at); assert.equal(result.desired.ended_at, s.segments[0].ended_at)
      assert.deepEqual(result.expected, result.desired)
    }
  } finally { if (before === undefined) delete process.env.TZ; else process.env.TZ = before }
})
test('new minutes resolve normal stored-zone instants; impossible and ambiguous Oslo DST minutes reject', () => {
  assert.equal(nativeMinuteInstant('2026-10-22T20:15', 'Europe/Oslo'), '2026-10-22T18:15:00.000Z')
  assert.equal(nativeMinuteInstant('2026-10-22T20:15', 'UTC'), '2026-10-22T20:15:00.000Z')
  assert.throws(() => nativeMinuteInstant('2026-03-29T02:30', 'Europe/Oslo'), /finnes ikke/)
  assert.throws(() => nativeMinuteInstant('2026-10-25T02:30', 'Europe/Oslo'), /to ganger/)
  assert.throws(() => nativeMinuteInstant('2026-02-30T12:30', 'UTC'), /Ugyldig/)
  assert.throws(() => nativeMinuteInstant('2026-10-22T20:15', 'guess'), /lagrede tidssone/)
  for (const original of ['2026-10-25T02:30:19.123456+02:00', '2026-10-25T02:30:19.654321+01:00']) {
    assert.equal(nativeMinuteInstant(nativeLocalMinute(original, 'Europe/Oslo'), 'Europe/Oslo', original), original)
  }
})
test('changing start, end or attribution preserves every untouched field and completed/archived/moved history', () => {
  const s = snapshot()
  assert.equal(input(s, { from: '2026-10-22T18:15' }).desired.started_at, '2026-10-22T18:15:00.000Z')
  assert.equal(input(s, { from: '2026-10-22T18:15' }).desired.ended_at, s.segments[0].ended_at)
  assert.equal(input(s, { to: '2026-10-22T20:15' }).desired.started_at, s.segments[0].started_at)
  assert.equal(input(s, { to: '2026-10-22T20:15' }).desired.ended_at, '2026-10-22T20:15:00.000Z')
  const moved = { ...catalog, tasks: [{ ...catalog.tasks[0], area_id: null }] }
  assert.doesNotThrow(() => buildNativeCorrection(s, s.segments[0], nativeDraft(s, s.segments[0]), now, moved))
  assert.throws(() => input(s, { area: id(9) }), /Oppgaven må tilhøre/)
  const result = input(s, { area: '', task: '' }); assert.equal(result.desired.task_id, null)
  assert.equal(result.desired.started_at, s.segments[0].started_at); assert.equal(result.desired.ended_at, s.segments[0].ended_at)
})
test('zero, touching and disjoint corrections work; future/bounds/positive overlap are rejected', () => {
  const s = snapshot(); s.segments[0].started_at = s.work_day.started_at = '2026-10-22T18:00:00Z'
  assert.equal(nativeCorrectionWork(input(s, { to: '2026-10-22T18:00' })), 0)
  for (const [draft, message] of [[{ to: '2026-10-22T23:00' }, /fremtiden/], [{ from: '2026-10-22T17:59' }, /arbeidsdagen/],
    [{ to: '2026-10-23T04:01' }, /arbeidsdagen/], [{ to: '2026-10-22T17:00' }, /arbeidsdagen/]]) assert.throws(() => input(s, draft), message)
  s.segments[0].ended_at = '2026-10-22T19:00:00Z'
  s.segments.push({ ...s.segments[0], id: id(6), started_at: '2026-10-22T20:00:00Z', ended_at: '2026-10-22T21:00:00Z' })
  assert.throws(() => input(s, { to: '2026-10-22T20:30' }), /overlapper/)
  assert.doesNotThrow(() => input(s, { to: '2026-10-22T20:00' }))
  assert.equal(nativeCorrectionWork(input(s, { from: '2026-10-22T20:30', to: '2026-10-22T20:30' })), 0)
  s.segments[1].started_at = s.segments[1].ended_at = '2026-10-22T18:30:00Z'
  const mapped = mapFlowSnapshot(s); assert.equal(nativeHistoryWork(mapped), 3600000)
  const exact = structuredClone(s)
  exact.segments[0].started_at = '2026-10-22T18:00:03.000001Z'; exact.segments[0].ended_at = '2026-10-22T18:00:03.000002Z'
  exact.segments[1].started_at = '2026-10-22T18:00:03.000002Z'; exact.segments[1].ended_at = '2026-10-22T18:00:03.000003Z'
  exact.segments.reverse(); assert.equal(mapFlowSnapshot(exact).segments[0].id, id(2))
  exact.segments[0].started_at = '2026-10-22T18:00:03.000001Z'; assert.throws(() => mapFlowSnapshot(exact))
})
test('interruption correction requires exactly the observed open identity, never heuristic end or new activity', () => {
  const s = snapshot(true), notice = { dayId: id(1), segmentId: id(2), count: 1 }
  assert.equal(nativeDraft(s, s.segments[0]).to, '')
  assert.equal(interruptedPeriod(s, notice).id, id(2))
  for (const update of [{ dayId: id(7) }, { segmentId: id(7) }, { count: 2 }]) assert.equal(interruptedPeriod(s, { ...notice, ...update }), null)
  s.segments[0].ended_at = '2026-10-22T20:00Z'; assert.equal(interruptedPeriod(s, notice), null)
  s.segments.push({ ...s.segments[0], id: id(9), ended_at: null }); assert.equal(interruptedPeriod(s, notice), null)
})
test('SDK sends full separate expected/desired state; curated SQL errors and inconsistent success never become optimistic totals', async () => {
  const s = snapshot(), edit = input(s, { to: '2026-10-22T20:15' }), requests = []
  const corrected = { ...s, segments: [{ ...s.segments[0], ...edit.desired }] }; let response = corrected, status = 200
  const client = createClient('https://example.supabase.co', 'sb_publishable_test', { auth: { persistSession: false }, global: { fetch: async (url, options) => {
    requests.push({ name: String(url).split('/').at(-1), args: JSON.parse(options.body) }); return new Response(JSON.stringify(response), { status })
  } } })
  const api = createFlowHistoryApi(client), signal = new AbortController().signal
  assert.deepEqual(await api.correctNative(edit, signal), corrected)
  assert.deepEqual(requests[0], { name: 'flow_work_segment_correct', args: { p_segment_id: id(2), p_work_day_id: id(1),
    p_expected_started_at: edit.expected.started_at, p_expected_ended_at: edit.expected.ended_at, p_expected_area_id: id(3), p_expected_task_id: id(4),
    p_started_at: edit.desired.started_at, p_ended_at: edit.desired.ended_at, p_area_id: id(3), p_task_id: id(4) } })
  response = s; await assert.rejects(api.correctNative(edit, signal), e => e.kind === 'unknown')
  for (const [code, kind] of [['40001', 'conflict'], ['42501', 'conflict'], ['22023', 'validation'], ['22008', 'validation'], ['23P01', 'validation'], ['23503', 'validation'], ['P0001', 'unknown']]) {
    response = { code, message: 'RAW PRIVATE SQL' }; status = 400
    await assert.rejects(api.correctNative(edit, signal), e => e instanceof NativeCorrectionError && e.kind === kind && !e.message.includes('RAW'))
  }
})
function storeFixture() {
  let s = snapshot(), writes = 0, reads = 0, statsReads = 0, areaReads = 0, mode = 'success', release
  const edit = input(s, { to: '2026-10-22T20:15' })
  const api = {
    list: async () => ({ rows: [{ key: 'flow:' + id(1), id: id(1), source: 'flow', started_at: s.work_day.started_at, snapshot: s }], next_cursor: null, server_time: server }),
    statistics: async () => { statsReads++; return { total: nativeHistoryWork(s), server_time: server, period: { kind: 'total', anchor: null } } },
    area: async () => { areaReads++; return { total: { total: nativeHistoryWork(s), server_time: server } } },
    nativeSnapshot: async () => { reads++; if (mode === 'offline') throw Error('offline'); return s },
    correctNative: async input => {
      writes++
      if (mode === 'hold') await new Promise(r => { release = r })
      if (mode === 'stale') throw new NativeCorrectionError('conflict', 'Perioden er endret')
      if (mode === 'validation') throw new NativeCorrectionError('validation', 'Perioden overlapper')
      if (mode === 'offline') throw Error('Lost response')
      s = { ...s, segments: [{ ...s.segments[0], ...input.desired }] }
      if (mode === 'lost') throw Error('Committed response lost')
      return s
    },
  }
  const store = createFlowHistoryStore(api, 'UTC')
  return { store, api, edit, set: value => { mode = value }, release: () => release(), counts: () => ({ writes, reads, statsReads, areaReads }) }
}
for (const mode of ['success', 'lost', 'stale', 'validation', 'offline']) test('mutation ' + mode + ': recovery, no blind retry, draft safety and canonical refresh', async t => {
  const f = storeFixture(); t.after(() => f.store.disconnect()); f.store.connect(); await tick(); await f.store.selectArea(id(3))
  f.set(mode); const ok = await f.store.correctNative(f.edit), state = f.store.getSnapshot()
  assert.equal(ok, ['success', 'lost'].includes(mode)); assert.equal(f.counts().writes, 1)
  assert.equal(state.mutation, null); assert.equal(state.statisticsStatus, 'ready'); assert.equal(state.areaStatus, 'ready')
  assert.equal(state.correctionBlocked, ['stale', 'offline'].includes(mode) ? id(2) : null)
  assert.equal(f.counts().reads, ['lost', 'offline'].includes(mode) ? 1 : 0)
  assert.ok(f.counts().statsReads >= 2 && f.counts().areaReads >= 2)
  assert.equal(state.statistics.total, nativeHistoryWork(state.rows[0].snapshot)); assert.equal(state.area.total.total, state.statistics.total)
  if (state.correctionBlocked) { assert.equal(await f.store.correctNative(f.edit), false); assert.equal(f.counts().writes, 1) }
  if (mode === 'validation') { f.set('success'); assert.equal(await f.store.correctNative(f.edit), true) }
  if (mode === 'success') assert.equal(state.rows[0].snapshot.segments[0].ended_at, f.edit.desired.ended_at)
})
test('double submit shares existing write lane; fresh explicit open clears block, not frozen expected values', async t => {
  const f = storeFixture(); t.after(() => f.store.disconnect()); f.store.connect(); await tick(); f.set('hold')
  const pending = f.store.correctNative(f.edit)
  assert.equal(f.store.getSnapshot().mutation, 'saving'); assert.equal(await f.store.correctNative(f.edit), false)
  f.release(); assert.equal(await pending, true); assert.equal(f.counts().writes, 1)
  f.set('stale'); await f.store.correctNative(f.edit); const before = structuredClone(f.edit.expected)
  f.store.prepareCorrection(); assert.equal(f.store.getSnapshot().correctionBlocked, null); assert.deepEqual(f.edit.expected, before)
})
test('late recovery read after disconnect cannot publish a confirmation into a stale store', async () => {
  const f = storeFixture(); f.store.connect(); await tick(); f.set('lost')
  let resolve
  f.api.nativeSnapshot = () => new Promise(r => { resolve = r })
  const pending = f.store.correctNative(f.edit); await tick(); f.store.disconnect()
  const before = f.store.getSnapshot(), s = snapshot(); s.segments[0] = { ...s.segments[0], ...f.edit.desired }
  resolve(s); assert.equal(await pending, false); assert.equal(f.store.getSnapshot(), before)
})
test('real native form uses fieldset/labels, stored zone and minute inputs; forgotten end starts blank and activity stays readonly', { timeout: 30000 }, async t => {
  const vite = await createServer({ configFile: false, envFile: false, appType: 'custom', logLevel: 'silent', server: { middlewareMode: true, hmr: false }, plugins: [react()] }); t.after(() => vite.close())
  const { default: Form } = await vite.ssrLoadModule('/src/components/NativePeriodForm.tsx')
  const props = { snapshot: snapshot(), segment: snapshot().segments[0], catalog, now: () => now, busy: false, blocked: false, error: null, onClose() {}, onSave: async () => true }
  const html = renderToStaticMarkup(createElement(Form, props))
  assert.match(html, /<fieldset[^>]*aria-describedby/); assert.match(html, /<legend>Rediger arbeidsperiode/)
  assert.equal((html.match(/step="60"/g) ?? []).length, 2); assert.match(html, /Tidssone: UTC/)
  assert.match(html, /Arkivert/); assert.match(html, /Fullført/); assert.match(html, /Lagre korrigering/); assert.doesNotMatch(html, /Slett/)
  const s = snapshot(true), finish = renderToStaticMarkup(createElement(Form, { ...props, snapshot: s, segment: s.segments[0], finishOnly: true }))
  assert.match(finish, /Når sluttet du å jobbe/); assert.match(finish, /Sluttet å jobbe/); assert.match(finish, /value=""/)
  assert.doesNotMatch(finish, /<select|>Fra</); assert.equal((finish.match(/type="datetime-local"/g) ?? []).length, 1)
  const blocked = renderToStaticMarkup(createElement(Form, { ...props, blocked: true, error: 'Arbeidsperioden er endret' }))
  assert.match(blocked, /<fieldset disabled/); assert.match(blocked, /role="alert"/); assert.match(blocked, /åpne editoren/)
})
