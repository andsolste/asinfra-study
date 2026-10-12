import assert from 'node:assert/strict'
import test from 'node:test'
import { localPeriod, shiftPeriod, changePeriodKind, periodLabel, localDays, summarizeStatistics,
  subjectAppearance, subjectPalette, chartScale, axisTime, dayAxisLabel } from '../src/lib/statistics.ts'
import { createHistoryApi, mapHistoryEntry } from '../src/lib/study-history.ts'
import { createHistoryStore } from '../src/lib/history-store.ts'
import { createSessionStore } from '../src/lib/session-store.ts'
import { workMilliseconds } from '../src/lib/history-time.ts'

const tick = () => new Promise(resolve => setImmediate(resolve))
const id = number => `10000000-0000-4000-8000-${String(number).padStart(12, '0')}`
const iso = (month, day, hour = 0, minute = 0, second = 0, ms = 0, year = 2026) => new Date(year, month - 1, day, hour, minute, second, ms).toISOString()
function inZone(zone, operation) {
  const old = process.env.TZ
  try { process.env.TZ = zone; return operation() }
  finally { if (old === undefined) delete process.env.TZ; else process.env.TZ = old }
}
function row(number, ranges = [[iso(10, 7, 9), iso(10, 7, 10)]], subjectId = id(100)) {
  const sessionId = id(number)
  return mapHistoryEntry({
    session: { id: sessionId, subject_id: subjectId, description: 'Test', started_at: ranges[0][0], ended_at: ranges.at(-1)[1] },
    subject: subjectId ? { id: subjectId, code: 'CODE', name: 'Samme navn', is_archived: false, created_at: iso(1, 1) } : null,
    segments: ranges.map(([started_at, ended_at], i) => ({ id: id(1000 + i), session_id: sessionId, started_at, ended_at })),
  })
}

test('day/week/month use local midnights in several browser zones, never UTC date assumptions', () => {
  for (const zone of ['UTC', 'Europe/Oslo', 'America/New_York', 'Asia/Tokyo']) inZone(zone, () => {
    for (const kind of ['day', 'week', 'month']) {
      const period = localPeriod(kind, new Date(2026, 9, 9, 16, 45))
      const start = new Date(period.from), end = new Date(period.to)
      assert.equal(start.getHours(), 0); assert.equal(end.getHours(), 0)
      assert.equal(start.getMinutes(), 0); assert.match(period.from, /Z$/)
      assert.equal(start.getDate(), kind === 'day' ? 9 : kind === 'week' ? 5 : 1)
      assert.equal(end.getDate(), kind === 'day' ? 10 : kind === 'week' ? 12 : 1)
      assert.equal(localDays(period).length, kind === 'day' ? 1 : kind === 'week' ? 7 : 31)
    }
  })
})

test('months enumerate 28/29/30/31 days and shift safely through February and year boundaries', () => inZone('Europe/Oslo', () => {
  for (const [year, month, count] of [[2026, 1, 31], [2026, 2, 28], [2028, 2, 29], [2026, 4, 30]]) {
    const period = localPeriod('month', new Date(year, month - 1, count, 23))
    const days = localDays(period)
    assert.equal(days.length, count)
    assert.equal(new Date(days.at(-1).from).getDate(), count)
    assert.equal(days.at(-1).to, period.to)
    assert.deepEqual(shiftPeriod(shiftPeriod(period, 1), -1), period)
  }
  const december = localPeriod('month', new Date(2026, 11, 31))
  const january = shiftPeriod(december, 1)
  assert.equal(new Date(january.from).getFullYear(), 2027)
  assert.equal(new Date(january.from).getMonth(), 0)
  assert.deepEqual(shiftPeriod(january, -1), december)
  for (const kind of ['day', 'week']) {
    const period = localPeriod(kind, new Date(2026, 11, 31))
    assert.deepEqual(shiftPeriod(shiftPeriod(period, 1), -1), period)
  }
}))

test('DST keeps 23/25-hour local days and 167/169-hour weeks; daily buckets meet without gaps', () => inZone('Europe/Oslo', () => {
  for (const [date, hours] of [[new Date(2026, 2, 29), 23], [new Date(2026, 9, 25), 25]]) {
    const day = localPeriod('day', date), week = localPeriod('week', date), month = localPeriod('month', date)
    assert.equal((Date.parse(day.to) - Date.parse(day.from)) / 3600000, hours)
    assert.equal((Date.parse(week.to) - Date.parse(week.from)) / 3600000, 144 + hours)
    for (const period of [week, month]) {
      const days = localDays(period)
      assert.equal(days[0].from, period.from); assert.equal(days.at(-1).to, period.to)
      days.forEach((value, i) => {
        assert.equal(new Date(value.from).getHours(), 0)
        if (i) assert.equal(days[i - 1].to, value.from)
      })
    }
    const summary = summarizeStatistics([row(1, [[day.from, day.to]])], week)
    assert.equal(summary.total, hours * 3600000)
    assert.equal(summary.busiestDay.from, day.from)
    assert.equal(summary.days.filter(value => value.total > 0).length, 1)
  }
}))

test('period labels and switching preserve historical selections but current views anchor on today', () => inZone('Europe/Oslo', () => {
  const now = new Date(2026, 9, 9, 16)
  const week = localPeriod('week', now)
  assert.equal(changePeriodKind(week, 'day', now).from, localPeriod('day', now).from)
  const previous = shiftPeriod(week, -1)
  assert.equal(changePeriodKind(previous, 'day', now).from, previous.from)
  assert.equal(changePeriodKind(previous, 'month', now).from, localPeriod('month', new Date(previous.from)).from)
  assert.match(periodLabel(week), /5.*oktober.*11.*oktober/)
  assert.match(periodLabel(localPeriod('day', now)), /9.*oktober.*2026/)
  assert.match(periodLabel(localPeriod('month', now)), /oktober.*2026/)
}))

test('aggregation splits midnight work and multiple subjects while excluding long pauses and session envelopes', () => inZone('UTC', () => {
  const period = localPeriod('week', new Date(2026, 9, 7))
  const entries = [row(1, [[iso(10, 6, 23, 30), iso(10, 7, 0, 30)], [iso(10, 7, 9), iso(10, 7, 10)]]),
    row(2, [[iso(10, 7, 10), iso(10, 7, 11)]], id(101)), row(3, [[iso(10, 7, 12), iso(10, 7, 12, 15)]], null)]
  const summary = summarizeStatistics(entries, period)
  assert.equal(summary.total, 195 * 60000)
  assert.deepEqual(summary.days.map(value => value.total / 60000), [0, 30, 165, 0, 0, 0, 0])
  assert.deepEqual(summary.subjects.map(value => value.work / 60000), [120, 60, 15])
  assert.equal(summary.mostStudied.id, id(100))
  assert.equal(summary.busiestDay.from, iso(10, 7))
  assert.equal(summary.subjects.at(-1).name, 'Uten fag')
  assert.equal(summary.days[2].subjects.length, 3)
  assert.equal(summary.total, summary.subjects.reduce((sum, value) => sum + value.work, 0))
  for (const value of summary.days) assert.equal(value.total, value.subjects.reduce((sum, subject) => sum + subject.work, 0))
}))

test('day/week/month clip half-open boundaries, including a segment spanning the whole month', () => inZone('UTC', () => {
  const crossing = row(1, [[iso(9, 30, 23, 45), iso(10, 1, 0, 15)], [iso(10, 31, 23, 50), iso(11, 1, 0, 20)]])
  const month = localPeriod('month', new Date(2026, 9, 9))
  assert.equal(summarizeStatistics([crossing], month).total, 25 * 60000)
  assert.equal(summarizeStatistics([crossing], localPeriod('day', new Date(2026, 9, 1))).total, 15 * 60000)
  assert.equal(summarizeStatistics([crossing], localPeriod('week', new Date(2026, 9, 1))).total, 30 * 60000)
  const spanning = row(2, [[iso(9, 30), iso(11, 2)]])
  assert.equal(summarizeStatistics([spanning], month).total, Date.parse(month.to) - Date.parse(month.from))
  const exactEdges = [row(3, [[iso(9, 30, 23), month.from]]), row(4, [[month.to, iso(11, 1, 1)]])]
  assert.equal(summarizeStatistics(exactEdges, month).total, 0)
}))

test('empty/zero periods have no winners; busiest ties choose earliest day and same-name subjects stay separate', () => inZone('UTC', () => {
  const period = localPeriod('week', new Date(2026, 9, 7))
  const empty = summarizeStatistics([], period)
  assert.equal(empty.total, 0); assert.equal(empty.mostStudied, null); assert.equal(empty.busiestDay, null)
  assert.equal(empty.days.length, 7); assert.deepEqual(empty.subjects, [])
  const summary = summarizeStatistics([row(2, [[iso(10, 8, 10), iso(10, 8, 11)]], id(101)), row(1)], period)
  assert.equal(summary.busiestDay.from, iso(10, 7))
  assert.equal(summary.subjects.length, 2)
  assert.equal(summary.mostStudied.id, id(100), 'Equal subject totals use stable name/ID tie breaking')
  assert.deepEqual(summarizeStatistics([row(3, [[iso(10, 7), iso(10, 7)]])], period).subjects, [])
}))

test('aggregation retains fractional milliseconds until presentation, rather than rounding each segment', () => inZone('UTC', () => {
  const summary = summarizeStatistics([row(1, [[iso(10, 7, 9, 0, 0, 100), iso(10, 7, 9, 0, 0, 700)],
    [iso(10, 7, 10, 0, 0, 100), iso(10, 7, 10, 0, 0, 700)]])], localPeriod('day', new Date(2026, 9, 7)))
  assert.equal(summary.total, 1200); assert.equal(summary.subjects[0].work, 1200)
}))

test('subject colors/textures are stable across filtering/order, neutral for null and avoid ordinary red', () => {
  const ids = Array.from({ length: 80 }, (_, i) => id(i))
  const appearances = ids.map(subjectAppearance)
  assert.deepEqual([...ids].reverse().map(subjectAppearance).reverse(), appearances)
  assert.deepEqual(subjectAppearance(null), { color: '#94A3B8', pattern: 0 })
  assert.ok(appearances.every(value => subjectPalette.includes(value.color) && value.pattern >= 0 && value.pattern <= 3))
  assert.equal(new Set(appearances.map(value => value.color)).size, 8)
  assert.ok(new Set(appearances.map(value => `${value.color}/${value.pattern}`)).size > 8, 'Textures distinguish palette collisions')
  assert.ok(!subjectPalette.includes('#EF4444'))
})

test('chart scale adapts to seconds, minutes and long work days; all weekday and month-end labels are supported', () => inZone('UTC', () => {
  for (const maximum of [0, 1234, 5 * 60000, 90 * 60000, 12 * 3600000, 30 * 3600000]) {
    const scale = chartScale(maximum)
    assert.ok(scale.max >= maximum && scale.max > 0)
    assert.equal(scale.ticks[0], 0); assert.equal(scale.ticks.at(-1), scale.max)
    assert.ok(scale.ticks.length >= 2 && scale.ticks.length <= 6)
  }
  assert.equal(axisTime(30 * 60000), '30 min'); assert.equal(axisTime(90 * 60000), '1.5 t')
  const week = localDays(localPeriod('week', new Date(2026, 9, 7)))
  assert.equal(week.map((day, i) => dayAxisLabel(day, 'week', i, 7)).length, 7)
  const days = localDays(localPeriod('month', new Date(2026, 1, 7)))
  assert.deepEqual(days.map((day, i) => dayAxisLabel(day, 'month', i, days.length)).filter(Boolean), ['1', '5', '10', '15', '20', '25', '28'])
}))

test('range API uses absolute day/week/month bounds and fetches >200 rows for every kind', async () => {
  for (const kind of ['day', 'week', 'month']) {
    const period = localPeriod(kind, new Date(2026, 9, 7)), calls = []
    const client = { rpc: (name, args) => ({ abortSignal: async () => {
      calls.push({ name, args })
      return { error: null, data: Array.from({ length: args.p_offset === 0 ? 200 : 3 }, (_, i) => row(args.p_offset + i)) }
    } }) }
    const entries = await createHistoryApi(client).range(period, new AbortController().signal)
    assert.equal(entries.length, 203)
    assert.deepEqual(calls.map(value => value.args.p_offset), [0, 200])
    assert.ok(calls.every(value => value.name === 'study_session_history' && value.args.p_from === period.from
      && value.args.p_to === period.to && value.args.p_limit === 200))
  }
})

test('range pagination rejects duplicate, failed and aborted later pages instead of showing partial totals', async () => {
  for (const failure of ['duplicate', 'network', 'abort']) {
    const controller = new AbortController(), period = localPeriod('month')
    const client = { rpc: (_name, args) => ({ abortSignal: async () => {
      if (args.p_offset === 0) return { error: null, data: Array.from({ length: 200 }, (_, i) => row(i)) }
      if (failure === 'abort') controller.abort()
      return failure === 'network' ? { error: { message: 'private' }, data: null } : { error: null, data: [row(1)] }
    } }) }
    await assert.rejects(createHistoryApi(client).range(period, controller.signal))
  }
})

function server() {
  let rows = [row(1)]
  const calls = []
  const api = {
    list: async query => { calls.push(['list', query]); return rows.slice(query.offset, query.offset + query.limit) },
    range: async period => { calls.push(['range', period]); return rows.filter(value => workMilliseconds(value.segments, period) > 0) },
    edit: async () => rows[0], remove: async () => {},
  }
  return { api, calls, setRows: value => { rows = value } }
}

test('fast day/week/month switches clear stale numbers immediately; old replies cannot replace selected period', async () => {
  const data = server(), pending = [], base = new Date(2026, 9, 7)
  data.api.range = (period, signal) => new Promise((resolve, reject) => pending.push({ period, signal, resolve, reject }))
  const store = createHistoryStore(data.api, localPeriod('week', base))
  store.connect(); await tick(); pending[0].resolve([row(1)]); await tick()
  const day = store.selectPeriod(localPeriod('day', base))
  assert.equal(store.getSnapshot().statisticsStatus, 'loading'); assert.deepEqual(store.getSnapshot().statisticsRows, [])
  const month = store.selectPeriod(localPeriod('month', base))
  pending[2].resolve([]); await month
  pending[1].resolve([row(2)]); await day
  assert.equal(pending[1].signal.aborted, true)
  assert.equal(store.getSnapshot().period.kind, 'month')
  assert.deepEqual(store.getSnapshot().statisticsRows, [])
  assert.equal(store.getSnapshot().rows.length, 1, 'Statistics selection never replaces the independent 25-row history')
  const staleFailure = store.selectPeriod(localPeriod('day', base))
  const latest = store.selectPeriod(localPeriod('month', base))
  pending[4].resolve([row(4)]); await latest
  pending[3].reject(new Error('Stale offline reply')); await staleFailure
  assert.equal(store.getSnapshot().statisticsError, null)
  assert.equal(store.getSnapshot().statisticsRows[0].session.id, id(4))
  const week = store.selectPeriod(localPeriod('week', base))
  pending[5].reject(new Error('Offline')); await week
  assert.equal(store.getSnapshot().statisticsStatus, 'error')
  assert.deepEqual(store.getSnapshot().statisticsRows, [])
  data.api.range = async () => [row(3)]
  await store.selectPeriod(store.getSnapshot().period)
  assert.equal(store.getSnapshot().statisticsStatus, 'ready')
  assert.equal(store.getSnapshot().statisticsError, null)
  assert.equal(store.getSnapshot().statisticsRows[0].session.id, id(3))
  store.disconnect()
})

test('confirmed and recovered timer stops refresh every selected period without resetting past selections', async () => {
  for (const kind of ['day', 'week', 'month']) for (const past of [false, true]) for (const lost of [false, true]) {
    const data = server(); data.setRows([])
    const period = localPeriod(kind, new Date(2026, past ? 7 : 9, 7))
    const history = createHistoryStore(data.api, period)
    history.connect(); await tick()
    const finished = row(1), running = { ...finished, session: { ...finished.session, ended_at: null }, server_time: finished.session.ended_at }
    let current = running, notified
    const timer = createSessionStore({
      load: async (_signal, sessionId) => sessionId ? { ...finished, server_time: finished.session.ended_at } : current,
      transition: async () => {
        current = null; data.setRows([finished])
        if (lost) throw new Error('Lost reply after commit')
        return { ...finished, server_time: finished.session.ended_at }
      },
    })
    timer.subscribe(() => {
      const saved = timer.getSnapshot().saved
      if (saved && notified !== saved.session.id) { notified = saved.session.id; void history.refresh() }
    })
    timer.connect(); await tick(); await timer.dispatch({ action: 'stop', sessionId: finished.session.id })
    if (lost) await timer.refresh()
    await tick()
    assert.deepEqual(history.getSnapshot().period, period)
    assert.equal(history.getSnapshot().rows.length, 1)
    assert.equal(history.getSnapshot().statisticsRows.length, past ? 0 : 1)
    assert.deepEqual(data.calls.filter(value => value[0] === 'range').at(-1)[1], period)
    timer.disconnect(); history.disconnect()
  }
})
