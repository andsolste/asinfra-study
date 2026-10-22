import assert from 'node:assert/strict'
import test from 'node:test'
import { readFile } from 'node:fs/promises'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { createServer } from 'vite'
import react from '@vitejs/plugin-react'
import { timestampMicroseconds as us, durationMilliseconds as ms, clockMicroseconds } from '../src/lib/time-precision.ts'
import { formatDuration, formatMicrosecondDuration } from '../src/lib/duration.ts'
import { flowDurations } from '../src/lib/flow-work.ts'
import { taskDayTime } from '../src/lib/flow-tasks.ts'
import { nativeHistoryWork, dayTimeline } from '../src/lib/flow-history.ts'
import { sessionDurations } from '../src/lib/study-sessions.ts'
import { workMilliseconds, workMicroseconds, fromLocalDateTime, toLocalDateTime } from '../src/lib/history-time.ts'
import { summarizeStatistics, localPeriod } from '../src/lib/statistics.ts'
import { createHistoryDraft, prepareHistoryEdit } from '../src/lib/study-history.ts'
import { durationClock, durationSeconds, csvRow } from '../src/lib/flow-export.ts'
import { mapFlowStatistics } from '../src/lib/flow-statistics.ts'
import { reportModel } from '../src/lib/flow-report.ts'

const id = n => `10000000-0000-4000-8000-${String(n).padStart(12, '0')}`
const at = clock => `2026-10-20T${clock}:00Z`, cutoff = '2026-10-21T04:00:00Z'
const area = { id: id(1), name: 'Nettverk', code: 'NETT', is_archived: false, created_at: at('04:00') }
const task = { id: id(2), area_id: area.id, title: 'Lab', description: '', status: 'active', deadline_at: null,
  completed_at: null, created_at: at('04:00'), updated_at: at('04:00') }
function snapshot(ranges, end = null, server = at('11:00')) {
  return { server_time: server, work_day: { id: id(3), logical_date: '2026-10-20', timezone: 'UTC',
    boundary_at: at('04:00'), cutoff_at: cutoff, started_at: ranges[0][0], ended_at: end, created_at: ranges[0][0] },
    segments: ranges.map(([started_at, ended_at], i) => ({ id: id(10 + i), work_day_id: id(3), area_id: area.id,
      task_id: task.id, started_at, ended_at, created_at: started_at })) }
}
function legacy(s) {
  return { server_time: s.server_time, subject: area, session: { id: id(4), subject_id: area.id, description: 'Lesing',
    started_at: s.work_day.started_at, ended_at: s.work_day.ended_at }, segments: s.segments.map(x => ({ ...x, session_id: id(4) })) }
}
function statistics(work, server = cutoff) {
  return mapFlowStatistics({ period: { kind: 'day', anchor: '2026-10-20', from_date: '2026-10-20', to_date: '2026-10-21', timezone: 'UTC' },
    server_time: server, total: work, areas: [{ ...area, work }], days: [{ date: '2026-10-20', total: work, areas: [{ id: area.id, work }] }],
    contributions: [{ source: 'flow', area_id: area.id, task_id: task.id, title: task.title, status: task.status, work }],
    task_date: '2026-10-20', task_today: work, task_current: 0, legacy_timezone_error: null })
}

test('absolute ISO microseconds are exact across offsets, fraction lengths and the Unix epoch', () => {
  assert.equal(us('2026-10-20T10:00:00.123456+02:00'), us('2026-10-20T08:00:00.123456Z'))
  assert.equal(us('2026-10-20T03:00:00.1-05:00'), us('2026-10-20T08:00:00.100000Z'))
  assert.equal(us('1969-12-31T23:59:59.999999Z'), -1n)
  assert.equal(us('1970-01-01T00:00:00Z'), 0n)
  for (const value of ['yesterday', '2026-10-20T08:00:00', '2026-10-20T08:00:00.1234567Z']) assert.throws(() => us(value))
  assert.equal(clockMicroseconds(1.234), 1234n)
  assert.equal(ms(59999999n), 59999)
  assert.throws(() => ms((BigInt(Number.MAX_SAFE_INTEGER) + 1n) * 1000n))
})

test('one shared completed-minute rule for numeric aggregates and exact BigInt CSV durations', () => {
  for (const [microseconds, expected] of [[0n, '0 min'], [31000000n, '0 min'], [59999999n, '0 min'],
    [60000000n, '1 min'], [60000001n, '1 min'], [2579000000n, '42 min'], [3540000000n, '59 min'],
    [3600000000n, '1 t'], [3947000000n, '1 t 5 min'], [45299000000n, '12 t 34 min']]) {
    assert.equal(formatDuration(ms(microseconds)), expected)
    assert.equal(formatDuration(Number(microseconds) / 1000), expected, 'SQL millisecond contract uses the same minute rule')
    assert.equal(formatMicrosecondDuration(microseconds), expected)
    assert.equal(durationClock(microseconds), expected)
  }
  const huge = (BigInt(Number.MAX_SAFE_INTEGER) + 9n) * 60000000n
  assert.equal(durationClock(huge), `${(huge / 60000000n) / 60n} t ${(huge / 60000000n) % 60n} min`)
})

for (const [name, ranges, now, expected] of [
  ['A: work/pause/resume', [[at('08:00'), at('09:00')], [at('10:00'), at('11:00')]], at('11:00'), [120, 60, 180]],
  ['B: paused until cutoff', [[at('08:00'), at('09:00')]], cutoff, [60, 1140, 1200]],
  ['C: actual open work until cutoff', [[at('08:00'), null]], cutoff, [1200, 0, 1200]],
]) test(name + ' preserves segment-only work across task/history/report/CSV and later recovery', () => {
  const s = snapshot(ranges, null, now), totals = flowDurations(s, Date.parse(now))
  assert.deepEqual([totals.work, totals.pause, totals.elapsed], expected.map(x => x * 60000))
  assert.equal(taskDayTime(s, task.id, Date.parse(now)).work, totals.work)
  assert.equal(sessionDurations(legacy(s), Date.parse(now)).work, totals.work)
  const closed = structuredClone(s)
  closed.work_day.ended_at = now
  closed.segments.forEach(x => { if (!x.ended_at) x.ended_at = cutoff })
  closed.server_time = '2026-10-21T05:00:00Z'
  assert.equal(nativeHistoryWork(closed), totals.work)
  assert.equal(flowDurations(closed, Date.parse(closed.server_time)).work, totals.work)
  assert.equal(workMilliseconds(closed.segments), totals.work)
  const raw = workMicroseconds(closed.segments)
  assert.equal(raw, BigInt(totals.work) * 1000n)
  assert.equal(reportModel(statistics(totals.work)).total, formatDuration(totals.work))
  assert.equal(durationClock(raw), formatDuration(totals.work))
  assert.equal(dayTimeline(closed).filter(x => x.kind === 'pause').reduce((sum, p) => sum + us(p.end) - us(p.start), 0n), BigInt(totals.pause) * 1000n)
})

test('microsecond edge: below/exactly/above a minute in native, legacy, task, history and open server snapshot', () => {
  const start = '2026-10-20T08:00:00.123456Z'
  for (const [fraction, exact, displayed] of [['123455', 59999999n, '0 min'], ['123456', 60000000n, '1 min'], ['123457', 60000001n, '1 min']]) {
    const end = `2026-10-20T08:01:00.${fraction}Z`, s = snapshot([[start, end]], end, end)
    assert.equal(us(end) - us(start), exact)
    for (const work of [flowDurations(s, Date.parse(end)).work, taskDayTime(s, task.id, Date.parse(end)).work,
      nativeHistoryWork(s), sessionDurations(legacy(s)).work, workMilliseconds(s.segments)]) {
      assert.equal(work, ms(exact)); assert.equal(formatDuration(work), displayed)
    }
    const running = snapshot([[start, null]], null, end)
    assert.equal(flowDurations(running, Date.parse(end)).current, ms(exact), 'restore the known server anchor remainder')
    assert.equal(taskDayTime(running, task.id, Date.parse(end)).current, ms(exact))
    assert.equal(sessionDurations(legacy(running), Date.parse(end)).work, ms(exact))
    assert.equal(durationClock(exact), displayed)
  }
})

test('aggregate exact microseconds before flooring: short segments, multiple entries, days and areas', () => {
  const previous = process.env.TZ
  process.env.TZ = 'UTC'
  try {
    for (const ranges of [
      [[at('08:00'), '2026-10-20T08:00:30Z'], [at('09:00'), '2026-10-20T09:00:30Z']],
      [[at('08:00'), '2026-10-20T08:00:29.999999Z'], [at('09:00'), '2026-10-20T09:00:30.000001Z']],
    ]) {
      const s = snapshot(ranges, ranges.at(-1)[1]), work = flowDurations(s, Date.parse(s.server_time)).work
      assert.equal(work, 60000); assert.equal(formatDuration(work), '1 min')
      assert.equal(taskDayTime(s, task.id, Date.parse(s.server_time)).work, work)
      assert.equal(workMilliseconds(s.segments), work)
      const entries = ranges.map(range => legacy(snapshot([range], range[1])))
      assert.equal(summarizeStatistics(entries, localPeriod('day', new Date(at('11:00')))).total, work)
    }
    const a = legacy(snapshot([[at('08:00'), '2026-10-20T08:00:59.999999Z']], at('09:00')))
    const b = legacy(snapshot([[at('09:00'), '2026-10-20T09:00:00.000001Z']], at('10:00')))
    b.session.subject_id = id(99); b.subject = { ...area, id: id(99) }
    const summary = summarizeStatistics([a, b], localPeriod('day', new Date(at('11:00'))))
    assert.equal(summary.total, 60000, 'do not floor entries/areas before the total')
    b.segments[0].started_at = '2026-10-21T09:00:00Z'
    b.segments[0].ended_at = '2026-10-21T09:00:00.000001Z'
    assert.equal(summarizeStatistics([a, b], localPeriod('week', new Date(at('11:00')))).total, 60000,
      'do not floor daily buckets before the weekly total')
  } finally { if (previous === undefined) delete process.env.TZ; else process.env.TZ = previous }
})

test('timeline preserves microsecond pause endpoints; CSV only changes its human-readable column', () => {
  const start = '2026-10-20T08:00:00.123456Z', end = '2026-10-20T08:00:30.123455Z'
  const next = '2026-10-20T08:01:30.123454Z', stop = '2026-10-20T08:02:00.123454Z'
  const s = snapshot([[start, end], [next, stop]], stop)
  const gap = dayTimeline(s).find(x => x.kind === 'pause')
  assert.equal(gap.start, end); assert.equal(gap.end, next)
  assert.equal(formatDuration(ms(us(gap.end) - us(gap.start))), '0 min')
  const csv = csvRow({ source: 'flow', flow_date: '2026-10-20', timezone: 'UTC', started_at: start,
    ended_at: '2026-10-20T08:01:00.123455Z', work_microseconds: '59999999', area_id: null, area_name: 'Annet',
    area_code: null, area_archived: false, task_id: null, task_title: null, task_status: null, task_deadline: next, description: '=1+1' })
  assert.ok(csv.includes(`"${start}"`)); assert.ok(csv.includes('"2026-10-20T08:01:00.123455Z"'))
  assert.ok(csv.includes(`"${next}"`)); assert.ok(csv.includes(',"0 min",59.999999,'))
  assert.ok(csv.includes('"\'\t=1+1"')); assert.ok(csv.endsWith('\r\n'))
  assert.equal(durationSeconds(59999999n), '59.999999')
})

test('minute-only legacy edits preserve original seconds/microseconds and both repeated DST occurrences', () => {
  const previous = process.env.TZ
  try {
    for (const zone of ['UTC', 'Europe/Oslo', 'America/New_York']) {
      process.env.TZ = zone
      const s = snapshot([['2026-10-20T08:00:45.123456Z', '2026-10-20T09:00:46.654321Z']], '2026-10-20T09:00:46.654321Z')
      const original = legacy(s), draft = createHistoryDraft(original)
      const payload = prepareHistoryEdit({ ...draft, description: 'Ny tekst', subjectId: '' }, [area])
      assert.equal(payload.startedAt, original.session.started_at); assert.equal(payload.endedAt, original.session.ended_at)
      assert.deepEqual(payload.segments, s.segments.map(({ started_at, ended_at }) => ({ started_at, ended_at })))
      draft.segments[0].end = toLocalDateTime('2026-10-20T09:00:00Z').slice(0, 16)
      // Same displayed minute is deliberately untouched, not silently rounded to :00.
      assert.equal(prepareHistoryEdit(draft, [area]).segments[0].ended_at, original.segments[0].ended_at)
      draft.segments[0].end = toLocalDateTime('2026-10-20T08:59:00Z').slice(0, 16)
      assert.equal(prepareHistoryEdit(draft, [area]).segments[0].ended_at, '2026-10-20T08:59:00.000Z')
    }
    process.env.TZ = 'Europe/Oslo'
    for (const original of ['2026-10-25T00:30:45.123456Z', '2026-10-25T01:30:45.654321Z']) {
      assert.equal(fromLocalDateTime(toLocalDateTime(original).slice(0, 16), original), original)
      assert.throws(() => fromLocalDateTime('2026-10-25T02:31', original), /to ganger/)
    }
    assert.throws(() => fromLocalDateTime('2026-03-29T02:30'), /finnes ikke/)
  } finally { if (previous === undefined) delete process.env.TZ; else process.env.TZ = previous }
})

test('real UI renders minute durations consistently and ordinary clocks without seconds', { timeout: 30000 }, async t => {
  const vite = await createServer({ configFile: false, envFile: false, appType: 'custom', logLevel: 'silent',
    server: { middlewareMode: true, hmr: false }, plugins: [react()] })
  t.after(() => vite.close())
  const [Timer, Tasks, Statistics, History, Report, Examples, Form] = await Promise.all([
    'FlowTimer', 'Tasks', 'FlowStatistics', 'FlowHistory', 'FlowReport', 'FlowExamples', 'HistoryForm',
  ].map(name => vite.ssrLoadModule(`/src/components/${name}.tsx`)))
  const render = (Component, props) => renderToStaticMarkup(createElement(Component, props))
  const s = snapshot([[at('08:00'), at('09:00')], [at('10:00'), at('11:00')]], at('11:00'))
  const catalog = { areas: [area], tasks: [task] }, totals = statistics(7200000)
  const data = { phase: 'paused', data: { current: s, server_time: s.server_time }, catalog, now: Date.parse(s.server_time), reload() {} }
  const timer = render(Timer.default, { data, organizationVersion: [], onCutover() {} })
  assert.match(timer, /Arbeid i dag 2 t/); assert.match(timer, />1 t</); assert.doesNotMatch(timer, /Total klokketid|02:00:00/)
  const tasks = render(Tasks.default, { data, initialId: task.id })
  assert.match(tasks, /Oppgaven i dag<\/dt><dd>2 t/)
  const historyData = { period: totals.period, statistics: totals, statisticsStatus: 'ready', timezone: 'UTC',
    selectedArea: null, areaStatus: 'ready', mutation: null, status: 'ready', rows: [{ key: 'flow:' + id(3), source: 'flow', id: id(3), started_at: at('08:00'), snapshot: s }] }
  for (const html of [render(Statistics.default, { data: historyData, catalog }), render(History.default, { data: historyData, catalog, subjects: { subjects: [area], status: 'ready' } }), render(Report.default, { data: totals })]) {
    assert.match(html, />2 t</)
    const text = html.replace(/<[^>]*>/g, '')
    assert.doesNotMatch(text, /\d\d:\d\d:\d\d|timer:minutter:sekunder/)
  }
  for (const name of ['TimerExample', 'StatisticsExample', 'HistoryExample']) {
    assert.doesNotMatch(render(Examples[name], {}).replace(/<[^>]*>/g, ''), /\d\d:\d\d:\d\d/)
  }
  const form = render(Form.default, { entry: legacy(s), subjects: [area], busy: false, disabled: false })
  assert.equal((form.match(/step="60"/g) ?? []).length, 6)
  assert.doesNotMatch(form, /value="\d{4}-\d\d-\d\dT\d\d:\d\d:/)
  const hook = await readFile(new URL('../src/hooks/useFlowWorkDay.ts', import.meta.url), 'utf8')
  assert.match(hook, /setInterval\(tick, 1000\)/)
})
