import assert from 'node:assert/strict'
import test from 'node:test'
import { createClient } from '@supabase/supabase-js'
import { createHistoryApi, mapHistoryEntry, mapHistoryPage, createHistoryDraft, prepareHistoryEdit,
  addDraftSegment, removeDraftSegment } from '../src/lib/study-history.ts'
import { localWeek, shiftWeek, workMilliseconds, toLocalDateTime, fromLocalDateTime } from '../src/lib/history-time.ts'
import { summarizeStatistics } from '../src/lib/statistics.ts'
import { createHistoryStore } from '../src/lib/history-store.ts'
import { createSessionStore } from '../src/lib/session-store.ts'

const sessionId = '10000000-0000-4000-8000-000000000001'
const subjectId = '20000000-0000-4000-8000-000000000001'
const otherId = '20000000-0000-4000-8000-000000000002'
const segmentId = '30000000-0000-4000-8000-000000000001'
const subject = { id: subjectId, name: 'OS', code: 'IDATT2202', is_archived: false, created_at: '2026-10-07T00:00:00Z' }
const time = value => '2026-10-07T' + value + ':00Z'
const interval = { kind: 'week', from: '2026-10-05T00:00:00Z', to: '2026-10-12T00:00:00Z' }
const tick = () => new Promise(resolve => setImmediate(resolve))
function fixture(id = sessionId) {
  return { session: { id, subject_id: subjectId, description: 'Lesing', started_at: time('10:00'), ended_at: time('12:00') },
    subject: { ...subject }, segments: [
      { id: segmentId, session_id: id, started_at: time('10:00'), ended_at: time('10:30') },
      { id: '30000000-0000-4000-8000-000000000002', session_id: id, started_at: time('11:00'), ended_at: time('12:00') },
    ] }
}
const entry = () => mapHistoryEntry(fixture())

test('history mapper reuses timer validation but rejects unfinished sessions/segments and duplicate rows', () => {
  assert.equal(entry().session.id, sessionId)
  const legacy = fixture()
  legacy.subject = null; legacy.session.subject_id = null; legacy.segments = []
  assert.equal(mapHistoryEntry(legacy).subject, null)
  assert.equal(workMilliseconds(mapHistoryEntry(legacy).segments), 0)
  for (const change of [
    value => { value.session.ended_at = null },
    value => { value.segments[1].ended_at = null },
    value => { value.session.started_at = 'invalid' },
    value => { value.session.started_at = '2026-02-30T10:00:00Z' },
    value => { value.segments[0].ended_at = 'invalid' },
    value => { value.session.ended_at = '2026-10-07T12:00:00' },
    value => { value.segments[0].session_id = otherId },
    value => { value.segments[1].started_at = time('10:15') },
    value => { value.subject.id = otherId },
    value => { value.subject = null },
  ]) {
    const value = fixture(); change(value)
    assert.throws(() => mapHistoryEntry(value))
  }
  assert.throws(() => mapHistoryPage(null))
  assert.throws(() => mapHistoryPage([fixture(), fixture()]))
})

test('work comes only from closed segments; pauses and session envelopes are not work', () => {
  assert.equal(workMilliseconds(entry().segments), 90 * 60000)
  assert.equal(workMilliseconds([]), 0)
  assert.equal(workMilliseconds([{ ...entry().segments[0], ended_at: null }]), 0)
  const summary = summarizeStatistics([entry()], interval)
  assert.equal(summary.total, 90 * 60000)
  assert.equal(summary.subjects[0].work, summary.total)
})

test('week clipping handles Sunday/Monday, half-open boundaries and periods entirely outside the week', () => {
  const segment = { ...entry().segments[0], started_at: '2026-10-04T23:50:00Z', ended_at: '2026-10-05T00:20:00Z' }
  assert.equal(workMilliseconds([segment], interval), 20 * 60000)
  assert.equal(workMilliseconds([segment], { from: '2026-09-28T00:00:00Z', to: interval.from }), 10 * 60000)
  assert.equal(workMilliseconds([{ ...segment, ended_at: interval.from }], interval), 0)
  assert.equal(workMilliseconds([{ ...segment, started_at: interval.to, ended_at: '2026-10-12T01:00:00Z' }], interval), 0)
  assert.equal(workMilliseconds([segment], { from: '2026-10-06T00:00:00Z', to: interval.to }), 0)
})

test('weekly totals group by subject ID, distinguish equal names and collect deleted/null subjects', () => {
  const a = entry()
  const b = mapHistoryEntry({ ...fixture(otherId), subject: { ...subject, id: otherId },
    session: { ...fixture(otherId).session, subject_id: otherId } })
  const c = mapHistoryEntry({ ...fixture(segmentId), subject: null,
    session: { ...fixture(segmentId).session, subject_id: null } })
  const summary = summarizeStatistics([a, b, c], interval)
  assert.equal(summary.total, 270 * 60000)
  assert.equal(summary.subjects.length, 3)
  assert.equal(summary.subjects.find(row => row.id === null).name, 'Uten fag')
  assert.equal(summary.subjects.find(row => row.id === otherId).work, 90 * 60000)
})

test('local weeks start Monday at midnight and use calendar arithmetic across DST', () => {
  const oldZone = process.env.TZ
  try {
    for (const zone of ['UTC', 'Europe/Oslo', 'America/New_York']) {
      process.env.TZ = zone
      const week = localWeek(new Date(2026, 9, 8, 16, 34))
      const start = new Date(week.from), end = new Date(week.to)
      assert.equal(start.getDay(), 1); assert.equal(start.getHours(), 0)
      assert.equal(start.getDate(), 5); assert.equal(end.getDate(), 12)
      assert.equal(shiftWeek(shiftWeek(week, -1), 1).from, week.from)
      assert.equal(localWeek(new Date(2026, 9, 11, 23, 59)).from, week.from)
    }
    process.env.TZ = 'Europe/Oslo'
    for (const [date, hours] of [[new Date(2026, 2, 29), 167], [new Date(2026, 9, 25), 169]]) {
      const week = localWeek(date)
      assert.equal((Date.parse(week.to) - Date.parse(week.from)) / 3600000, hours)
      assert.equal(new Date(week.to).getHours(), 0)
    }
  } finally {
    if (oldZone === undefined) delete process.env.TZ
    else process.env.TZ = oldZone
  }
})

test('datetime-local conversions preserve local time, microseconds and unchanged repeated DST hours', () => {
  const oldZone = process.env.TZ
  try {
    process.env.TZ = 'Europe/Oslo'
    assert.equal(toLocalDateTime('2026-10-07T10:00:00Z'), '2026-10-07T12:00:00')
    assert.equal(fromLocalDateTime('2026-10-07T12:00'), '2026-10-07T10:00:00.000Z')
    const precise = '2026-10-07T10:00:00.123456Z'
    assert.equal(fromLocalDateTime(toLocalDateTime(precise), precise), precise)
    for (const iso of ['2026-10-25T00:30:00.971234Z', '2026-10-25T01:30:00.971234Z']) {
      assert.equal(fromLocalDateTime(toLocalDateTime(iso), iso), iso)
      assert.throws(() => fromLocalDateTime('2026-10-25T02:30:01', iso), /to ganger/)
    }
    assert.throws(() => fromLocalDateTime('2026-10-25T02:30'), /to ganger/)
    assert.throws(() => fromLocalDateTime('2026-03-29T02:30'), /finnes ikke/)
    assert.throws(() => fromLocalDateTime('2026-02-30T10:00'), /finnes ikke/)
    assert.throws(() => fromLocalDateTime(''), /gyldig/)
  } finally {
    if (oldZone === undefined) delete process.env.TZ
    else process.env.TZ = oldZone
  }
})

test('second-precision inputs preserve unchanged absolute timestamps and convert changed values in multiple zones', () => {
  const oldZone = process.env.TZ
  try {
    const original = '2026-10-09T06:28:19.971234Z'
    for (const zone of ['UTC', 'Europe/Oslo', 'America/New_York']) {
      process.env.TZ = zone
      const displayed = toLocalDateTime(original)
      assert.match(displayed, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}$/)
      assert.equal(fromLocalDateTime(displayed, original), original)
      const changed = toLocalDateTime('2026-10-09T06:28:20Z')
      assert.equal(fromLocalDateTime(changed, original), '2026-10-09T06:28:20.000Z')
      assert.throws(() => fromLocalDateTime(displayed + '.500', original), /gyldig/)
      const zeroSeconds = '2026-10-09T06:28:00.123456Z'
      assert.equal(fromLocalDateTime(toLocalDateTime(zeroSeconds).slice(0, -3), zeroSeconds), zeroSeconds)
    }
    process.env.TZ = 'Europe/Oslo'
    assert.equal(toLocalDateTime(original), '2026-10-09T08:28:19')
    const offsetOriginal = '2026-10-09T08:28:19.971234+02:00'
    assert.equal(fromLocalDateTime('2026-10-09T08:28:19', offsetOriginal), offsetOriginal)
  } finally {
    if (oldZone === undefined) delete process.env.TZ
    else process.env.TZ = oldZone
  }
})

function preciseEntry() {
  const row = fixture()
  row.session.started_at = row.session.started_at.replace('Z', '.971234Z')
  row.session.ended_at = row.session.ended_at.replace('Z', '.123456Z')
  row.segments.forEach(segment => {
    segment.started_at = segment.started_at.replace('Z', '.971234Z')
    segment.ended_at = segment.ended_at.replace('Z', '.123456Z')
  })
  return mapHistoryEntry(row)
}

test('description/subject edits preserve every original session/segment timestamp despite second-only UI', () => {
  const row = preciseEntry(), draft = createHistoryDraft(row)
  const otherSubject = { ...subject, id: otherId, is_archived: true }
  const input = prepareHistoryEdit({ ...draft, subjectId: otherId, description: 'Korrigert tekst' }, [subject, otherSubject])
  assert.equal(input.subjectId, otherId)
  assert.equal(input.description, 'Korrigert tekst')
  assert.equal(input.startedAt, row.session.started_at)
  assert.equal(input.endedAt, row.session.ended_at)
  assert.deepEqual(input.segments, row.segments.map(({ started_at, ended_at }) => ({ started_at, ended_at })))
  assert.ok([draft.start, draft.end, ...draft.segments.flatMap(segment => [segment.start, segment.end])]
    .every(value => !value.includes('.')))
})

test('changing one session/segment field uses whole seconds and leaves all other fields precise', () => {
  const row = preciseEntry(), draft = createHistoryDraft(row)
  draft.start = toLocalDateTime(time('09:59'))
  const changedEnd = '2026-10-07T10:30:01Z'
  draft.segments[0].end = toLocalDateTime(changedEnd)
  const input = prepareHistoryEdit(draft, [subject])
  assert.equal(input.startedAt, '2026-10-07T09:59:00.000Z')
  assert.equal(input.endedAt, row.session.ended_at)
  assert.equal(input.segments[0].started_at, row.segments[0].started_at)
  assert.equal(input.segments[0].ended_at, '2026-10-07T10:30:01.000Z')
  assert.deepEqual(input.segments[1], { started_at: row.segments[1].started_at, ended_at: row.segments[1].ended_at })
})

test('edit drafts support add/remove, archived subjects and timestamp-only replacement payloads', () => {
  let draft = createHistoryDraft(entry())
  draft = addDraftSegment(draft)
  assert.equal(draft.segments.length, 3)
  assert.equal(draft.segments[2].end, '')
  draft = removeDraftSegment(draft, draft.segments[2].key)
  const payload = prepareHistoryEdit(draft, [{ ...subject, is_archived: true }])
  assert.equal(payload.description, 'Lesing')
  assert.equal(payload.startedAt, time('10:00'))
  assert.equal(payload.endedAt, time('12:00'))
  assert.deepEqual(Object.keys(payload.segments[0]), ['started_at', 'ended_at'])
  assert.equal(payload.segments.length, 2)
  assert.equal(prepareHistoryEdit({ ...draft, subjectId: '', segments: [] }, []).subjectId, null)
  assert.equal(prepareHistoryEdit({ ...draft, description: '😀'.repeat(500) }, [subject]).description.length, 1000)
})

test('edit validation rejects long descriptions, negative/overlapping/unordered/out-of-bounds/open periods', () => {
  const draft = createHistoryDraft(entry())
  const local = toLocalDateTime
  for (const changes of [
    { description: 'x'.repeat(501) }, { subjectId: otherId },
    { end: local(time('09:00')) }, { start: '' },
    { segments: [{ ...draft.segments[0], end: '' }] },
    { segments: [{ ...draft.segments[0], end: local(time('09:00')) }] },
    { segments: [{ ...draft.segments[0], start: local(time('09:00')) }] },
    { segments: [{ ...draft.segments[0], end: local(time('12:01')) }] },
    { segments: [draft.segments[0], { ...draft.segments[1], start: local(time('10:15')) }] },
    { segments: [...draft.segments].reverse() },
  ]) assert.throws(() => prepareHistoryEdit({ ...draft, ...changes }, [subject]))
})

test('SDK API sends exact pagination, absolute week bounds and sanitized edit/delete payloads; errors stay private', async () => {
  let fail = false
  const requests = []
  const client = createClient('http://localhost:9999', 'sb_publishable_TEST_ONLY', {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    global: { fetch: async (url, options) => {
      const path = String(url)
      requests.push({ path, body: JSON.parse(options.body), signal: options.signal })
      const data = path.endsWith('_delete') ? sessionId : path.endsWith('_edit') ? fixture() : [fixture()]
      return new Response(JSON.stringify(fail ? { message: 'private SQL info', code: '42501' } : data),
        { status: fail ? 403 : 200, headers: { 'Content-Type': 'application/json' } })
    } },
  })
  const api = createHistoryApi(client), signal = new AbortController().signal
  assert.equal((await api.list({}, signal))[0].session.id, sessionId)
  assert.deepEqual(requests[0].body, { p_from: null, p_to: null, p_limit: 25, p_offset: 0 })
  assert.ok(requests[0].signal)
  await api.list({ interval, limit: 20, offset: 40 }, signal)
  assert.deepEqual(requests.at(-1).body, { p_from: interval.from, p_to: interval.to, p_limit: 20, p_offset: 40 })
  assert.ok(requests.at(-1).path.endsWith('/rpc/study_session_history'))
  const payload = prepareHistoryEdit(createHistoryDraft(entry()), [subject])
  payload.segments[0].user_id = 'not trusted'; payload.segments[0].id = segmentId
  await api.edit(sessionId, payload, signal)
  assert.deepEqual(requests.at(-1).body, { p_session_id: sessionId, p_subject_id: subjectId,
    p_description: 'Lesing', p_started_at: time('10:00'), p_ended_at: time('12:00'),
    p_segments: entry().segments.map(row => ({ started_at: row.started_at, ended_at: row.ended_at })) })
  await api.remove(sessionId, signal)
  assert.deepEqual(requests.at(-1).body, { p_session_id: sessionId })
  assert.ok(requests.at(-1).path.endsWith('/rpc/study_session_history_delete'))
  for (const query of [{ limit: 201 }, { offset: -1 }, { interval: { from: interval.to, to: interval.from } }]) {
    await assert.rejects(api.list(query, signal))
  }
  fail = true
  await assert.rejects(api.list({}, signal), { message: 'Kunne ikke hente historikken.' })
  await assert.rejects(api.edit(sessionId, payload, signal), { message: 'Kunne ikke bekrefte lagringen.' })
  await assert.rejects(api.remove(sessionId, signal), { message: 'Kunne ikke bekrefte slettingen.' })
  const aborted = new AbortController(); aborted.abort()
  const count = requests.length
  await assert.rejects(api.list({}, aborted.signal))
  assert.equal(requests.length, count, 'An already aborted read does not reach the network')
})

test('range API fetches every bounded page, not just the first 200 sessions', async () => {
  const calls = []
  const client = { rpc: (_name, args) => ({ abortSignal: async () => {
    calls.push(args)
    const count = args.p_offset === 0 ? 200 : 1
    return { error: null, data: Array.from({ length: count }, (_, i) =>
      fixture('10000000-0000-4000-8000-' + String(args.p_offset + i).padStart(12, '0'))) }
  } }) }
  const rows = await createHistoryApi(client).range(interval, new AbortController().signal)
  assert.equal(rows.length, 201)
  assert.deepEqual(calls.map(row => row.p_offset), [0, 200])
  assert.ok(calls.every(row => row.p_limit === 200 && row.p_from === interval.from && row.p_to === interval.to))
})

function server() {
  let rows = [entry()]
  const calls = []
  const api = {
    list: async query => { calls.push(['list', query]); return rows.slice(query.offset, query.offset + query.limit) },
    range: async range => { calls.push(['range', range]); return [...rows] },
    edit: async (_id, input) => { rows = [{ ...rows[0], session: { ...rows[0].session, description: input.description },
      segments: rows[0].segments.slice(0, 1) }]; return rows[0] },
    remove: async () => { rows = [] },
  }
  return { api, calls, getRows: () => rows, setRows: value => { rows = value } }
}

test('store paginates 25 at a time, guards duplicate loads and resets pages on refresh', async () => {
  const data = server()
  data.setRows(Array.from({ length: 27 }, (_, i) =>
    mapHistoryEntry(fixture('10000000-0000-4000-8000-' + String(i).padStart(12, '0')))))
  const store = createHistoryStore(data.api, interval)
  store.connect(); await tick()
  assert.equal(store.getSnapshot().rows.length, 25)
  assert.equal(store.getSnapshot().hasMore, true)
  await Promise.all([store.more(), store.more()])
  assert.equal(store.getSnapshot().rows.length, 27)
  assert.equal(store.getSnapshot().hasMore, false)
  assert.deepEqual(data.calls.filter(row => row[0] === 'list').map(row => row[1].offset), [0, 25])
  await store.refresh()
  assert.equal(store.getSnapshot().rows.length, 25)
  store.disconnect()
})

test('edit/delete refresh both history and statistics without optimistic state changes', async () => {
  const data = server(), store = createHistoryStore(data.api, interval)
  store.connect(); await tick()
  assert.equal(summarizeStatistics(store.getSnapshot().statisticsRows, interval).total, 90 * 60000)
  const input = prepareHistoryEdit(createHistoryDraft(entry()), [subject]); input.description = 'Changed'
  assert.equal(await store.edit(sessionId, input), true)
  assert.equal(store.getSnapshot().rows[0].session.description, 'Changed')
  assert.equal(summarizeStatistics(store.getSnapshot().statisticsRows, interval).total, 30 * 60000)
  assert.equal(await store.remove(sessionId), true)
  assert.deepEqual(store.getSnapshot().rows, [])
  assert.equal(summarizeStatistics(store.getSnapshot().statisticsRows, interval).total, 0)
  assert.equal(store.getSnapshot().notice, 'Økten er slettet.')
  assert.equal(data.calls.filter(row => row[0] === 'range').length, 3)
  store.disconnect()
})

test('uncertain writes reconcile committed edits/deletes; failed reload blocks blindly retrying', async () => {
  for (const kind of ['edit', 'remove']) {
    const data = server()
    const operation = data.api[kind]
    data.api[kind] = async (...args) => { await operation(...args); throw new Error('Lost reply after commit') }
    const store = createHistoryStore(data.api, interval)
    store.connect(); await tick()
    if (kind === 'edit') await store.edit(sessionId, { ...prepareHistoryEdit(createHistoryDraft(entry()), [subject]), description: 'Committed' })
    else await store.remove(sessionId)
    assert.deepEqual(store.getSnapshot().rows, data.getRows())
    assert.deepEqual(store.getSnapshot().statisticsRows, data.getRows())
    assert.ok(store.getSnapshot().error.includes('kan ha blitt'))
    assert.equal(store.getSnapshot().mutation, null)
    data.api.list = async () => { throw new Error('Offline') }
    await store.refresh()
    assert.equal(store.getSnapshot().status, 'error')
    assert.equal(await store.remove(sessionId), false)
    store.disconnect()
  }
})

test('independent loading/errors, retry and out-of-order weeks cannot overwrite a newer selection', async () => {
  const data = server(), pending = []
  data.api.range = (range, signal) => new Promise(resolve => pending.push({ range, signal, resolve }))
  const store = createHistoryStore(data.api, interval)
  store.connect(); await tick()
  assert.equal(store.getSnapshot().status, 'ready')
  const next = { kind: 'week', from: '2026-10-12T00:00:00Z', to: '2026-10-19T00:00:00Z' }
  const changing = store.selectPeriod(next)
  pending[1].resolve([]); await changing
  pending[0].resolve([entry()]); await tick()
  assert.equal(pending[0].signal.aborted, true)
  assert.equal(store.getSnapshot().period.from, next.from)
  assert.deepEqual(store.getSnapshot().statisticsRows, [])
  data.api.range = async () => { throw new Error('Offline') }
  await store.selectPeriod(interval)
  assert.equal(store.getSnapshot().statisticsStatus, 'error')
  data.api.range = async () => [entry()]
  await store.selectPeriod(interval)
  assert.equal(store.getSnapshot().statisticsStatus, 'ready')
  store.disconnect()
})

test('disconnected requests cannot replace another account state; double writes are guarded', async () => {
  const data = server()
  let finish
  data.api.remove = () => new Promise(resolve => { finish = resolve })
  const store = createHistoryStore(data.api, interval)
  store.connect(); await tick()
  const deleting = store.remove(sessionId)
  assert.equal(await store.remove(sessionId), false)
  store.disconnect(); finish(); await deleting
  assert.equal(store.getSnapshot().rows.length, 1)
  const fresh = createHistoryStore(server().api, interval)
  fresh.connect(); await tick()
  assert.equal(fresh.getSnapshot().mutation, null)
  fresh.disconnect()
})

test('a confirmed timer stop/recovery explicitly reloads finished history and the chosen week', async () => {
  for (const lostReply of [false, true]) {
    const data = server(); data.setRows([])
    const history = createHistoryStore(data.api, interval)
    history.connect(); await tick()
    const running = { ...fixture(), session: { ...fixture().session, ended_at: null }, server_time: time('12:00') }
    let timerRows = running, notified
    const timer = createSessionStore({
      load: async (_signal, id) => id ? { ...fixture(), server_time: time('12:00') } : timerRows,
      transition: async () => {
        timerRows = null; data.setRows([entry()])
        if (lostReply) throw new Error('Lost reply after committed stop')
        return { ...fixture(), server_time: time('12:00') }
      },
    })
    timer.subscribe(() => {
      const saved = timer.getSnapshot().saved
      // Same confirmed-saved-ID guard used by StudyTimer's onFinished callback.
      if (saved && notified !== saved.session.id) { notified = saved.session.id; void history.refresh() }
    })
    timer.connect(); await tick()
    await timer.dispatch({ action: 'stop', sessionId })
    if (lostReply) {
      assert.equal(history.getSnapshot().rows.length, 0, 'Unconfirmed stop is not shown as saved yet')
      await timer.refresh()
    }
    await tick()
    assert.equal(history.getSnapshot().rows.length, 1)
    assert.equal(summarizeStatistics(history.getSnapshot().statisticsRows, interval).total, 90 * 60000)
    assert.equal(timer.getSnapshot().current, null)
    timer.disconnect(); history.disconnect()
  }
})
