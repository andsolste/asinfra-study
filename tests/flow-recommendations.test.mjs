import assert from 'node:assert/strict'
import test from 'node:test'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { createServer } from 'vite'
import react from '@vitejs/plugin-react'
import { workRecommendations } from '../src/lib/flow-recommendations.ts'
import { taskQueue } from '../src/lib/flow-tasks.ts'
import { createFlowStore } from '../src/lib/flow-work-store.ts'
import { startActivityCommand } from '../src/lib/flow-activity.ts'

const id = n => `10000000-0000-4000-8000-${String(n).padStart(12, '0')}`
const at = '2026-10-21T12:00:00Z', now = Date.parse(at), tick = () => new Promise(resolve => setImmediate(resolve))
const areas = [{ id: id(100), name: 'Nettverk', code: 'DCST2001', is_archived: false, created_at: at },
  { id: id(101), name: 'Webutvikling', code: 'IT2810', is_archived: false, created_at: at },
  { id: id(102), name: 'Arkivert', code: null, is_archived: true, created_at: at }]
const task = (n, deadline = null, area = id(100)) => ({ id: id(n), title: `Oppgave ${n}`, description: '', area_id: area,
  deadline_at: deadline, status: 'active', completed_at: null, created_at: at, updated_at: at })
const catalog = tasks => ({ areas, tasks })
function snapshot(taskId = id(1), areaId = id(100), paused = false) {
  return { work_day: { id: id(200), logical_date: '2026-10-21', timezone: 'UTC', boundary_at: '2026-10-21T04:00:00Z',
    cutoff_at: '2026-10-22T04:00:00Z', started_at: '2026-10-21T08:00:00Z', ended_at: null, created_at: '2026-10-21T08:00:00Z' },
    segments: [{ id: id(201), work_day_id: id(200), area_id: areaId, task_id: taskId, started_at: '2026-10-21T08:00:00Z',
      ended_at: paused ? '2026-10-21T09:00:00Z' : null, created_at: '2026-10-21T08:00:00Z' }], server_time: at }
}
const state = current => ({ current, server_time: at, next_boundary_at: '2026-10-21T04:00:00Z', next_cutoff_at: '2026-10-22T04:00:00Z', legacy_active: false })

test('recommendations preserve base deadline order, do not mutate input and show one next plus three later', () => {
  const data = catalog([task(1), task(2, '2026-10-22T10:00:00Z'), task(3, '2026-10-20T10:00:00Z'),
    task(4, '2026-10-19T10:00:00Z'), task(5, '2026-10-21T13:00:00Z'), task(6)])
  const before = structuredClone(data), result = workRecommendations(data, null, 'idle', now)
  assert.equal(result.now, null); assert.equal(result.next.id, id(4))
  assert.deepEqual(result.later.map(t => t.id), [3, 5, 2].map(id))
  assert.equal(result.overdueCount, 2); assert.equal(result.activeCount, 6)
  assert.deepEqual(data, before)
  assert.deepEqual(taskQueue(data.tasks, now).map(t => t.id), [4, 3, 5, 2, 1, 6].map(id))
})

test('running A belongs to Now, never Next/Later; alternatives remain startable', () => {
  const result = workRecommendations(catalog([task(1), task(2), task(3)]), snapshot(), 'running', now)
  assert.equal(result.now.activity.taskId, id(1)); assert.equal(result.now.usable, true)
  assert.equal(result.next.id, id(2)); assert.deepEqual(result.later.map(t => t.id), [id(3)])
})

test('paused A stays Now and is excluded; Continue resumes A and not the recommendation B', () => {
  const data = catalog([task(1), task(2)]), current = snapshot(id(1), id(100), true)
  const result = workRecommendations(data, current, 'paused', now)
  assert.equal(result.now.activity.taskId, id(1)); assert.equal(result.next.id, id(2))
  const command = startActivityCommand(result.now.activity, state(current), data, () => id(500))
  assert.equal(command.kind, 'activity'); assert.equal(command.taskId, id(1)); assert.equal(command.expectedId, null)
  assert.equal(command.dayId, current.work_day.id)
})

test('work without a task keeps its area/Annet as Now but excludes no suggested task', () => {
  for (const areaId of [null, id(100)]) for (const phase of ['running', 'paused']) {
    const result = workRecommendations(catalog([task(1)]), snapshot(null, areaId, phase === 'paused'), phase, now)
    assert.deepEqual(result.now.activity, { areaId, taskId: null })
    assert.equal(result.next.id, id(1))
  }
})

test('archived, missing-area and completed tasks cannot consume recommendation slots', () => {
  const unavailable = Array.from({ length: 8 }, (_, i) => task(i + 10, '2026-10-20T10:00:00Z', i % 2 ? id(999) : id(102)))
  const completed = { ...task(40, '2026-10-19T10:00:00Z'), status: 'completed', completed_at: at }
  const data = catalog([...unavailable, completed, task(1), task(2)])
  const result = workRecommendations(data, null, 'idle', now)
  assert.equal(result.next.id, id(1)); assert.deepEqual(result.later.map(t => t.id), [id(2)])
  assert.equal(result.overdueCount, 8, 'Unavailable active overdue tasks still require attention in Tasks')
  assert.equal(taskQueue(data.tasks, now).length, 10, 'Full Tasks keeps the unavailable active records')
})

test('invalid paused activity is not Now; moving its task does not exclude that now-startable task', () => {
  for (const data of [catalog([task(1, null, id(102)), task(2)]), catalog([task(2)]),
    catalog([{ ...task(1), status: 'completed', completed_at: at }, task(2)])]) {
    const result = workRecommendations(data, snapshot(id(1), data.tasks[0]?.area_id ?? id(100), true), 'paused', now)
    assert.equal(result.now, null); assert.equal(result.next.id, id(2))
  }
  const moved = workRecommendations(catalog([task(1, null, id(101)), task(2)]), snapshot(id(1), id(100), true), 'paused', now)
  assert.equal(moved.now, null); assert.equal(moved.next.id, id(1), 'Task may start in its new area, but is not the resumable old activity')
})

test('actual running activity stays Now even if its area is archived; unresolved phases invent no Now', () => {
  const data = catalog([task(1, null, id(102)), task(2)])
  const current = snapshot(id(1), id(102))
  const result = workRecommendations(data, current, 'running', now)
  assert.equal(result.now.activity.taskId, id(1)); assert.equal(result.now.usable, false); assert.equal(result.next.id, id(2))
  for (const phase of ['loading', 'recovering', 'error']) assert.equal(workRecommendations(data, current, phase, now).now, null)
})

test('overdue indicator counts all active overdue tasks, including Now; exact deadline is not overdue', () => {
  const data = catalog([task(1, '2026-10-20T10:00:00Z'), task(2, at), task(3, '2026-10-19T10:00:00Z', id(102)),
    { ...task(4, '2026-10-18T10:00:00Z'), status: 'completed', completed_at: at }])
  const result = workRecommendations(data, snapshot(), 'running', now)
  assert.equal(result.overdueCount, 2); assert.equal(result.next.id, id(2))
})

test('empty/all completed/only current/only unavailable queues stay distinct', () => {
  for (const data of [catalog([]), catalog([{ ...task(1), status: 'completed', completed_at: at }])]) {
    assert.equal(workRecommendations(data, null, 'idle', now).activeCount, 0)
  }
  const onlyCurrent = workRecommendations(catalog([task(1)]), snapshot(), 'running', now)
  assert.equal(onlyCurrent.next, null); assert.deepEqual(onlyCurrent.later, []); assert.equal(onlyCurrent.activeCount, 1)
  const unavailable = workRecommendations(catalog([task(1, null, id(102))]), null, 'idle', now)
  assert.equal(unavailable.next, null); assert.equal(unavailable.activeCount, 1); assert.equal(unavailable.now, null)
})

test('queue command uses the same store/day for start, switch, pause and resume; never auto-starts next', async () => {
  let current = null, counter = 500
  const data = catalog([task(1), task(2)]), commands = []
  const store = createFlowStore({ load: async () => state(current), catalog: async () => data,
    act: async command => {
      commands.push(command)
      if (command.kind === 'start') { current = snapshot(command.taskId, command.areaId); current.work_day.id = command.dayId; current.segments[0].id = command.segmentId; current.segments[0].work_day_id = command.dayId }
      else {
        const open = current.segments.find(s => s.ended_at === null)
        if (open) open.ended_at = at
        if (command.nextId) current.segments.push({ id: command.nextId, work_day_id: command.dayId, area_id: command.areaId, task_id: command.taskId, started_at: at, ended_at: null, created_at: at })
      }
      return current
    } }, { timezone: () => 'UTC' })
  store.connect(); await tick()
  const start = () => {
    const state = store.getSnapshot(), queue = workRecommendations(state.catalog, state.data?.current ?? null, state.phase, now)
    return store.dispatch(startActivityCommand({ areaId: queue.next.area_id, taskId: queue.next.id }, state.data, data, () => id(counter++), () => 'UTC'))
  }
  assert.equal(await start(), true); assert.equal(store.getSnapshot().phase, 'running')
  const dayId = current.work_day.id
  assert.equal(await start(), true); assert.equal(current.work_day.id, dayId); assert.equal(current.segments.at(-1).task_id, id(2))
  await store.dispatch({ kind: 'activity', dayId, expectedId: current.segments.at(-1).id, expectedCount: current.segments.length, nextId: null, areaId: null, taskId: null })
  assert.equal(store.getSnapshot().phase, 'paused'); assert.equal(commands.length, 3)
  const queue = workRecommendations(data, current, 'paused', now)
  assert.equal(queue.next.id, id(1)); assert.equal(queue.now.activity.taskId, id(2))
  await store.dispatch(startActivityCommand(queue.now.activity, state(current), data, () => id(counter++)))
  assert.equal(current.segments.at(-1).task_id, id(2)); assert.equal(current.work_day.id, dayId)
  store.disconnect()
})

test('real Work components render Next/Later/actions and put the current period ahead of day total', { timeout: 30000 }, async t => {
  const server = await createServer({ configFile: false, envFile: false, appType: 'custom', logLevel: 'silent', server: { middlewareMode: true, hmr: false }, plugins: [react()] })
  t.after(() => server.close())
  const { default: Queue } = await server.ssrLoadModule('/src/components/TaskQueue.tsx')
  const { default: Timer } = await server.ssrLoadModule('/src/components/FlowTimer.tsx')
  const workspace = (phase, current, tasks = [task(1), task(2), task(3)]) => ({ phase, data: state(current), closed: null, catalog: catalog(tasks), now, pending: null,
    reload: () => {}, dispatch: () => assert.fail('Rendering must never mutate work'), notice: null, error: null })
  const renderQueue = data => renderToStaticMarkup(createElement(Queue, { data, onOpen: () => {}, onCreate: () => {} }))
  const running = workspace('running', snapshot()), queue = renderQueue(running)
  assert.match(queue, />Neste</); assert.match(queue, />Etterpå</); assert.match(queue, />Bytt til</)
  assert.doesNotMatch(queue, /Oppgave 1|>Pågår<|>Fullfør</)
  assert.match(renderQueue(workspace('paused', snapshot(id(1), id(100), true))), />Start</)
  assert.match(renderQueue(workspace('idle', null, [])), />Opprett oppgave</)
  for (const phase of ['loading', 'recovering', 'error']) assert.doesNotMatch(renderQueue(workspace(phase, snapshot())), /queue-next-title/)
  const timer = renderToStaticMarkup(createElement(Timer, { data: running, organizationVersion: [], onCutover: () => {} }))
  assert.ok(timer.indexOf('Oppgave 1') < timer.indexOf('denne arbeidsperioden'))
  assert.ok(timer.indexOf('denne arbeidsperioden') < timer.indexOf('Arbeid totalt i dag'))
  assert.ok(timer.indexOf('>Pause<') < timer.indexOf('>Bytt aktivitet<'))
  const invalid = renderToStaticMarkup(createElement(Timer, { data: workspace('paused', snapshot(id(1), id(102), true), [task(1, null, id(102)), task(2)]), organizationVersion: [], onCutover: () => {} }))
  assert.match(invalid, />Siste aktivitet</); assert.match(invalid, /Velg ny aktivitet/); assert.doesNotMatch(invalid, />Fortsett</)
  const paused = renderToStaticMarkup(createElement(Timer, { data: workspace('paused', snapshot(id(1), id(100), true)), organizationVersion: [], onCutover: () => {} }))
  assert.match(paused, /Nå · pauset/); assert.match(paused, />1 t</); assert.match(paused, /siste arbeidsperiode/)
})
