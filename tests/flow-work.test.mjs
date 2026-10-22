import assert from 'node:assert/strict'
import test from 'node:test'
import { readFile } from 'node:fs/promises'
import { createClient } from '@supabase/supabase-js'
import { mapFlowSnapshot, mapFlowState, mapFlowArea, mapFlowTask, flowDurations, activityUsable, activityName, createFlowApi, browserTimezone } from '../src/lib/flow-work.ts'
import { createFlowStore } from '../src/lib/flow-work-store.ts'

const id = n => `10000000-0000-4000-8000-${String(n).padStart(12, '0')}`
const time = h => `2026-10-13T${h}:00Z`
const area = { id: id(2), name: 'ASInfra', code: 'ASI', is_archived: false, created_at: time('08:00') }
const task = { id: id(3), area_id: area.id, title: 'Utvikle Flow', description: '', deadline_at: null, status: 'active', completed_at: null, created_at: time('08:00'), updated_at: time('08:00') }
const catalog = { areas: [area], tasks: [task] }
function fixture(mode = 'running') {
  return { work_day: { id: id(1), logical_date: '2026-10-13', timezone: 'UTC', boundary_at: time('04:00'),
    cutoff_at: '2026-10-14T04:00:00Z', started_at: time('08:00'), ended_at: mode === 'ended' ? time('10:00') : null, created_at: time('08:00') },
    server_time: time('10:00'), segments: [
      { id: id(10), work_day_id: id(1), area_id: id(2), task_id: id(3), started_at: time('08:00'), ended_at: time('09:00'), created_at: time('08:00') },
      { id: id(11), work_day_id: id(1), area_id: null, task_id: null, started_at: time('09:30'), ended_at: mode === 'running' ? null : time('10:00'), created_at: time('09:30') },
    ] }
}
function state(current = null) { return { current, server_time: time('10:00'), next_boundary_at: time('04:00'), next_cutoff_at: '2026-10-14T04:00:00Z', legacy_active: false } }
const start = { kind: 'start', dayId: id(1), segmentId: id(10), timezone: 'UTC', boundary: time('04:00'), areaId: null, taskId: null }
const switching = { kind: 'activity', dayId: id(1), expectedId: id(11), expectedCount: 2, nextId: id(12), areaId: area.id, taskId: task.id }
const tick = () => new Promise(resolve => setImmediate(resolve))

test('native snapshot validates identity/times/non-overlap and keeps native domain separate', () => {
  assert.equal(mapFlowSnapshot(null), null)
  assert.equal(mapFlowSnapshot(fixture()).work_day.logical_date, '2026-10-13')
  for (const edit of [
    x => { x.work_day.started_at = 'yesterday' }, x => { x.work_day.logical_date = '2026-02-30' },
    x => { x.work_day.timezone = 'guess-zone' }, x => { x.work_day.cutoff_at = time('07:00') },
    x => { x.segments[1].work_day_id = id(999) }, x => { x.segments[1].area_id = 'not-uuid' },
    x => { x.segments[1].started_at = time('08:30') }, x => { x.segments[0].ended_at = null },
    x => { x.segments[1].id = x.segments[0].id }, x => { x.segments[1].ended_at = time('08:00') },
    x => { x.work_day.ended_at = time('10:00') }, x => { x.server_time = '2026-10-13T08:00' },
  ]) {
    const value = fixture(); edit(value); assert.throws(() => mapFlowSnapshot(value))
  }
  assert.throws(() => mapFlowState(state(fixture('ended'))))
  assert.throws(() => mapFlowState({ ...state(), next_boundary_at: null }))
  assert.throws(() => mapFlowState({ ...state(), legacy_active: 'yes' }))
  assert.equal(mapFlowState({ ...state(), next_boundary_at: null, next_cutoff_at: null }).current, null)
})

test('areas/tasks validate status and optional fields; Annet is a null activity not a row', () => {
  assert.equal(mapFlowArea(area).name, 'ASInfra')
  assert.equal(mapFlowTask(task).status, 'active')
  assert.throws(() => mapFlowTask({ ...task, completed_at: time('10:00') }))
  assert.throws(() => mapFlowTask({ ...task, status: 'completed' }))
  assert.throws(() => mapFlowArea({ ...area, is_archived: 1 }))
  assert.equal(activityUsable({ areaId: null, taskId: null }, { areas: [], tasks: [] }), true)
  assert.equal(activityName({ areaId: null, taskId: null }, catalog).area, 'Annet')
  assert.equal(activityUsable({ areaId: area.id, taskId: null }, catalog), true)
  assert.equal(activityUsable({ areaId: area.id, taskId: task.id }, catalog), true)
  const loose = { ...task, area_id: null }
  assert.equal(activityUsable({ areaId: null, taskId: task.id }, { ...catalog, tasks: [loose] }), true)
  assert.equal(activityUsable({ areaId: area.id, taskId: task.id }, { ...catalog, tasks: [loose] }), false)
  assert.equal(activityUsable({ areaId: area.id, taskId: null }, { ...catalog, areas: [{ ...area, is_archived: true }] }), false)
  assert.equal(activityUsable({ areaId: area.id, taskId: task.id }, { ...catalog, tasks: [{ ...task, status: 'completed', completed_at: time('10:00') }] }), false)
})

test('day total excludes gaps; current period is separate and all durations clip at cutoff', () => {
  const running = mapFlowSnapshot(fixture())
  assert.deepEqual(flowDurations(running, Date.parse(time('10:00'))), { work: 90 * 60000, elapsed: 120 * 60000, pause: 30 * 60000, current: 30 * 60000 })
  assert.equal(flowDurations(running, Date.parse(time('10:10'))).current, 40 * 60000)
  const paused = mapFlowSnapshot(fixture('paused'))
  assert.deepEqual(flowDurations(paused, Date.parse(time('11:00'))), { work: 90 * 60000, elapsed: 180 * 60000, pause: 90 * 60000, current: 0 })
  assert.deepEqual(flowDurations(mapFlowSnapshot(fixture('ended')), Date.parse(time('12:00'))), flowDurations(paused, Date.parse(time('10:00'))))
  const beyond = Date.parse(running.work_day.cutoff_at) + 7 * 3600000
  assert.deepEqual(flowDurations(running, beyond), flowDurations(running, Date.parse(running.work_day.cutoff_at)))
})

test('native SDK sends atomic start/switch/pause payloads, no client user or start/end timestamps', async () => {
  const requests = []
  let fail = false
  const client = createClient('http://localhost:9999', 'sb_publishable_TEST_ONLY', {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    global: { fetch: async (url, options) => {
      requests.push({ url: String(url), body: options.body ? JSON.parse(options.body) : null })
      const output = String(url).includes('/rpc/flow_work_state') ? state(fixture())
        : String(url).includes('/rpc/') ? fixture() : String(url).includes('flow_areas') ? [area] : [task]
      return new Response(JSON.stringify(fail ? { message: 'private SQL detail' } : output), { status: fail ? 400 : 200, headers: { 'Content-Type': 'application/json' } })
    } },
  })
  const api = createFlowApi(client), signal = new AbortController().signal
  await api.load(signal, 'UTC'); assert.deepEqual(requests.at(-1).body, { p_timezone: 'UTC' })
  await api.snapshot(signal,id(1)); assert.deepEqual(requests.at(-1).body,{p_work_day_id:id(1)})
  await api.catalog(signal); assert.equal(requests.filter(r => r.url.includes('/rest/v1/flow_')).length, 2)
  await api.act(start, signal)
  assert.ok(requests.at(-1).url.endsWith('/rpc/flow_work_day_start'))
  assert.deepEqual(requests.at(-1).body, { p_work_day_id: start.dayId, p_segment_id: start.segmentId, p_timezone: 'UTC', p_expected_boundary_at: start.boundary, p_area_id: null, p_task_id: null })
  await api.act(switching, signal)
  assert.deepEqual(requests.at(-1).body, { p_work_day_id: id(1), p_expected_segment_id: id(11), p_expected_segment_count: 2, p_next_segment_id: id(12), p_area_id: id(2), p_task_id: id(3) })
  await api.act({ ...switching, nextId: null, areaId: null, taskId: null }, signal)
  assert.equal(requests.at(-1).body.p_next_segment_id, null)
  assert.ok(requests.every(r => !JSON.stringify(r.body).includes('user_id') && !JSON.stringify(r.body).includes('started_at')))
  fail = true
  await assert.rejects(api.load(signal, 'UTC'), /Kunne ikke hente Flow-dagen/)
  await assert.rejects(api.act(start, signal), /kunne ikke bekreftes/)
})

test('cutover error messages are curated: future legacy data and expired boundary, never raw SQL', async () => {
  let message = 'Review future-dated legacy work before cutover'
  const client = createClient('http://localhost:9999', 'sb_publishable_TEST_ONLY', {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    global: { fetch: async () => new Response(JSON.stringify({message}), {status:400,headers:{'Content-Type':'application/json'}}) },
  })
  const api = createFlowApi(client), signal = new AbortController().signal
  await assert.rejects(api.act(start,signal), /Korriger den i Historikk/)
  message = 'Flow boundary changed; refresh before starting'
  await assert.rejects(api.act(start,signal), /grense er endret/)
  message = 'Private SQL / credentials / server details'
  await assert.rejects(api.act(start,signal), error => !error.message.includes('Private SQL') && error.message.includes('kunne ikke bekreftes'))
})

function storeFixture(initial = null) {
  let value = state(initial), monotonic = 1000, failRead = false, failWrite = false, loseReply = false
  const commands = []
  const api = {
    snapshot: async () => fixture('ended'),
    load: async () => { if (failRead) throw new Error('network'); return structuredClone(value) },
    catalog: async () => structuredClone(catalog),
    act: async command => {
      commands.push(structuredClone(command))
      if (failWrite) throw new Error('write')
      if (command.kind === 'start') value = state(fixture())
      else if (!command.nextId) value = state(fixture('paused'))
      else {
        const current = fixture('paused')
        current.segments.push({ ...current.segments[1], id: command.nextId, started_at: time('10:00'), ended_at: null })
        value = state(current)
      }
      if (loseReply) throw new Error('committed response lost')
      return value.current
    },
  }
  const store = createFlowStore(api, { timezone: () => 'UTC', clock: () => monotonic })
  return { store, commands, set: next => { value = next }, advance: ms => { monotonic += ms },
    fails: (read, write = false, lost = false) => { failRead = read; failWrite = write; loseReply = lost } }
}

test('initial idle read never starts work; active running/paused recover with a monotonic server anchor', async () => {
  for (const [initial, phase] of [[null, 'idle'], [fixture(), 'running'], [fixture('paused'), 'paused']]) {
    const f = storeFixture(initial)
    f.store.connect(); await tick()
    assert.equal(f.store.getSnapshot().phase, phase)
    assert.equal(f.commands.length, 0)
    const now = f.store.now(); f.advance(5000)
    assert.equal(f.store.now(), now + 5000)
    assert.equal(f.store.getSnapshot().data.current?.work_day.id ?? null, initial?.work_day.id ?? null)
    f.store.disconnect()
  }
})

test('start/pause/resume/switch transitions keep native IDs; day details remain cumulative', async () => {
  const f = storeFixture(); f.store.connect(); await tick()
  await f.store.dispatch(start); assert.equal(f.store.getSnapshot().phase, 'running')
  await f.store.dispatch({ ...switching, nextId: null }); assert.equal(f.store.getSnapshot().phase, 'paused')
  await f.store.dispatch({ ...switching, expectedId: null }); assert.equal(f.store.getSnapshot().phase, 'running')
  assert.equal(f.commands.length, 3)
  assert.equal(f.store.getSnapshot().data.current.work_day.id, id(1))
  assert.equal(f.store.getSnapshot().data.current.segments.at(-1).id, switching.nextId)
  assert.equal(flowDurations(f.store.getSnapshot().data.current, f.store.now()).work, 90 * 60000)
  f.store.disconnect()
})

test('committed-but-lost reply is reconciled by READ, never auto-replayed with a new token', async () => {
  const f = storeFixture(); f.store.connect(); await tick(); f.fails(false, false, true)
  assert.equal(await f.store.dispatch(start), false)
  assert.equal(f.store.getSnapshot().phase, 'running')
  assert.equal(f.store.getSnapshot().pending, null)
  assert.match(f.store.getSnapshot().notice, /Status er hentet/)
  assert.equal(f.commands.length, 1)
  f.store.disconnect()
})

test('failed write + failed recovery preserves exact tokens; explicit retry never generates new IDs', async () => {
  const f = storeFixture(); f.store.connect(); await tick(); f.fails(true, true)
  await f.store.dispatch(start)
  assert.equal(f.store.getSnapshot().phase, 'error')
  assert.deepEqual(f.store.getSnapshot().pending, start)
  assert.equal(await f.store.dispatch({ ...start, segmentId: id(99) }), false)
  f.fails(false, false); await f.store.retry()
  assert.deepEqual(f.commands, [start, start])
  assert.equal(f.store.getSnapshot().phase, 'running')
  f.store.disconnect()
})

test('cutoff/open-tab/reload recovery goes idle without starting a new day', async () => {
  const f = storeFixture(fixture()); f.store.connect(); await tick()
  f.set({ ...state(), server_time: '2026-10-14T04:00:00Z', next_boundary_at: '2026-10-14T04:00:00Z', next_cutoff_at: '2026-10-15T04:00:00Z' })
  await f.store.refresh()
  assert.equal(f.store.getSnapshot().phase, 'idle'); assert.equal(f.commands.length, 0)
  assert.equal(f.store.getSnapshot().closed.work_day.ended_at, time('10:00'))
  assert.equal(flowDurations(f.store.getSnapshot().closed, f.store.now()).elapsed, 120 * 60000, 'Closed details use ended_at, not continuing clock time')
  f.store.disconnect(); f.store.connect(); await tick()
  assert.equal(f.store.getSnapshot().phase, 'idle'); assert.equal(f.commands.length, 0)
  f.store.disconnect()
})

test('stale transition replies reflect authoritative newer state, not optimistic activity', async () => {
  const newer = fixture(), store = createFlowStore({
    load: async () => state(newer), catalog: async () => catalog, act: async () => newer,
  }, { timezone: () => 'UTC' })
  store.connect(); await tick()
  assert.equal(await store.dispatch(switching), false)
  assert.equal(store.getSnapshot().data.current.segments.at(-1).id, id(11))
  assert.match(store.getSnapshot().notice, /annen fane/)
  store.disconnect()
})

test('disconnected/stale response cannot replace a new connection; double writes and focus reads are serialized', async () => {
  let resolve, reads = 0
  const api = { load: async () => ++reads === 1 ? new Promise(r => { resolve = r }) : state(), catalog: async () => catalog, act: async () => fixture() }
  const store = createFlowStore(api, { timezone: () => 'UTC' })
  store.connect(); await tick(); store.disconnect(); store.connect(); await tick()
  resolve(state(fixture())); await tick()
  assert.equal(store.getSnapshot().phase, 'idle')
  store.disconnect()
  const f = storeFixture(); f.store.connect(); await tick()
  const writing = f.store.dispatch(start)
  assert.equal(await f.store.dispatch(start), false)
  await f.store.refresh(); await writing; await tick()
  assert.equal(f.commands.length, 1)
  f.store.disconnect()
})

test('missing browser zone is never guessed; stored snapshot zone stays frozen', () => {
  const current = fixture(); current.work_day.timezone = 'Europe/Oslo'
  assert.equal(mapFlowSnapshot(current).work_day.timezone, 'Europe/Oslo')
  assert.ok(browserTimezone() === null || typeof browserTimezone() === 'string')
})

test('native UI uses accessible controls/panels, recovery events and no Stop; history is unified', async () => {
  const source = file => readFile(new URL('../' + file, import.meta.url), 'utf8')
  const timer = await source('src/components/FlowTimer.tsx'), hook = await source('src/hooks/useFlowWorkDay.ts')
  assert.match(timer, /Arbeid i dag/); assert.match(timer, /<button[^>]*type="button" className="flow-total"/)
  assert.match(timer, /aria-haspopup="dialog"/); assert.match(timer, /label htmlFor="flow-area"/)
  assert.match(timer, /activityUsable\(lastActivity/); assert.doesNotMatch(timer, />Stopp</)
  const events = await source('src/lib/flow-interruption.ts')
  assert.match(hook, /listenForFlowInterruptions/)
  for (const event of ['focus', 'online', 'visibilitychange']) assert.ok(events.includes(`'${event}'`))
  assert.match(hook, /setTimeout\(\(\) => void store.refresh\(\)/)
  const account = await source('src/components/Account.tsx')
  assert.match(account, /<FlowTimer/); assert.doesNotMatch(account, /<StudyTimer/)
  assert.match(account, /<FlowHistory/); assert.match(account, /<FlowStatistics/)
  assert.doesNotMatch(account, /Denne visningen viser tidligere registreringer/)
  assert.match(await source('src/components/FlowHistory.tsx'), /Eldre registrering/)
  assert.match(await source('src/components/DetailPanel.tsx'), /returnFocus\.focus/)
  assert.match(await source('src/components/DetailPanel.tsx'), /fallbackFocus\?\.focus/)
})
