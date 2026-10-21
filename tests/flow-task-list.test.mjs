import assert from 'node:assert/strict'
import test from 'node:test'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { createServer } from 'vite'
import react from '@vitejs/plugin-react'
import { activeAreaTasks, taskArea, taskOverview } from '../src/lib/flow-task-list.ts'
import { taskOverdue } from '../src/lib/flow-tasks.ts'
import { activityUsable } from '../src/lib/flow-work.ts'
import { createFlowStore } from '../src/lib/flow-work-store.ts'

const id = n => `10000000-0000-4000-8000-${String(n).padStart(12, '0')}`
const at = '2026-10-21T12:00:00Z', now = Date.parse(at)
const task = (n, deadline = null, area = null) => ({ id: id(n), title: `Oppgave ${n}`, description: 'Beskrivelse', area_id: area,
  deadline_at: deadline, status: 'active', completed_at: null, created_at: at, updated_at: at })
const areas = [{ id: id(100), name: 'Webutvikling', code: 'IT2810', is_archived: false, created_at: at },
  { id: id(101), name: 'Tidligere arbeid', code: null, is_archived: true, created_at: at }]
const tasks = [task(1, '2026-10-20T12:00:00Z'), task(2, '2026-10-22T12:00:00Z', id(100)), task(3),
  task(4, '2026-10-20T13:00:00Z', id(101)), task(5, null, id(999)),
  { ...task(6), status: 'completed', completed_at: '2026-10-20T12:00:00Z' },
  { ...task(7), status: 'completed', completed_at: at }]
const catalog = { areas, tasks }
const state = current => ({ current, server_time: at, next_boundary_at: '2026-10-21T04:00:00Z', next_cutoff_at: '2026-10-22T04:00:00Z', legacy_active: false })

test('deadline groups include every active task once, also archived and missing areas; completed sorts by actual completion', () => {
  const before = structuredClone(tasks), result = taskOverview(tasks, now)
  assert.deepEqual(result.groups.map(group => [group.title, group.tasks.map(t => t.id)]), [
    ['Forfalt', [id(1), id(4)]], ['Kommende frister', [id(2)]], ['Uten frist', [id(3), id(5)]],
  ])
  assert.deepEqual(result.completed.map(t => t.id), [id(7), id(6)])
  assert.equal(result.activeCount, 5); assert.deepEqual(tasks, before)
  assert.deepEqual(taskOverview([...tasks].reverse(), now), result)
})

test('exact deadline is upcoming, only strictly passed active deadlines are overdue', () => {
  assert.equal(taskOverdue(task(1, at), now), false)
  assert.equal(taskOverdue(task(1, at), now + 1), true)
  assert.equal(taskOverdue({ ...task(1, at), status: 'completed' }, now + 1), false)
  assert.equal(taskOverview([task(1, at)], now).groups[1].tasks.length, 1)
})

test('area filter defaults to all and retains access to archived, unassigned and missing IDs without mutation', () => {
  assert.equal(taskOverview(tasks, now).activeCount, 5)
  for (const [area, expected] of [[id(100), [id(2)]], [id(101), [id(4)]], [id(999), [id(5)]], ['none', [id(1), id(3)]]]) {
    assert.deepEqual(taskOverview(tasks, now, area).groups.flatMap(group => group.tasks.map(t => t.id)), expected)
  }
  assert.deepEqual(taskOverview([], now).completed, [])
})

test('area labels distinguish Annet, archived and missing; archive warning counts active tasks only', () => {
  assert.deepEqual(taskArea(tasks[0], catalog), { name: 'Annet', unavailable: false, archived: false })
  assert.deepEqual(taskArea(tasks[3], catalog), { name: 'Tidligere arbeid', unavailable: true, archived: true })
  assert.deepEqual(taskArea(tasks[4], catalog), { name: 'Utilgjengelig område', unavailable: true, archived: false })
  assert.equal(activeAreaTasks([...tasks, { ...task(9, null, id(100)), status: 'completed' }], id(100)), 1)
})

test('area refresh preserves task identity/revision and stops archived tasks being startable; reactivation restores eligibility', async () => {
  let rows = structuredClone(areas)
  const store = createFlowStore({ load: async () => state(null), catalog: async () => ({ areas: rows, tasks }) }, { timezone: () => 'UTC' })
  store.connect(); await new Promise(resolve => setImmediate(resolve))
  const activity = { areaId: id(100), taskId: id(2) }
  assert.equal(activityUsable(activity, store.getSnapshot().catalog), true)
  rows = rows.map(area => ({ ...area, is_archived: true })); await store.refresh()
  assert.equal(activityUsable(activity, store.getSnapshot().catalog), false)
  assert.deepEqual(store.getSnapshot().catalog.tasks, tasks)
  rows = structuredClone(areas); await store.refresh()
  assert.equal(activityUsable(activity, store.getSnapshot().catalog), true)
  store.disconnect()
})

test('real task/area components expose grouped headings, compact actions and no start for current/unavailable/completed', { timeout: 30000 }, async t => {
  const server = await createServer({ configFile: false, envFile: false, appType: 'custom', logLevel: 'silent', server: { middlewareMode: true, hmr: false }, plugins: [react()] })
  t.after(() => server.close())
  const { default: Tasks } = await server.ssrLoadModule('/src/components/Tasks.tsx')
  const { default: List } = await server.ssrLoadModule('/src/components/TaskList.tsx')
  const { default: Subjects } = await server.ssrLoadModule('/src/components/Subjects.tsx')
  const { default: Form } = await server.ssrLoadModule('/src/components/TaskForm.tsx')
  const workspace = (phase = 'idle', current = null) => ({ phase, data: state(current), catalog, now, pending: null,
    notice: null, error: null, dispatch: () => assert.fail('Rendering cannot mutate tasks') })
  const renderList = data => renderToStaticMarkup(createElement(List, { data, tasks, label: 'Testoppgaver', onDetails: () => {} }))
  const idle = renderList(workspace())
  assert.match(idle, /aria-label="Start Oppgave 2"/)
  for (const n of [4, 5, 6, 7]) assert.doesNotMatch(idle, new RegExp(`aria-label="Start Oppgave ${n}"`))
  const running = renderList(workspace('running', { segments: [{ task_id: id(2), ended_at: null }] }))
  assert.match(running, />Pågår</); assert.doesNotMatch(running, /aria-label="(?:Start|Bytt til) Oppgave 2"/)
  assert.match(running, /aria-label="Bytt til Oppgave 1"/)
  const paused = renderList(workspace('paused', { segments: [{ task_id: id(2), ended_at: at }] }))
  assert.match(paused, /aria-label="Start Oppgave 2"/)
  const html = renderToStaticMarkup(createElement(Tasks, { data: workspace(), initialId: null }))
  for (const title of ['Forfalt', 'Kommende frister', 'Uten frist']) assert.match(html, new RegExp(`<h3[^>]*>${title}`))
  assert.match(html, /<h4><button/); assert.match(html, /Fullførte oppgaver \(2\)/)
  assert.match(html, /Vis område/); assert.doesNotMatch(html, /Nå ·|>Neste<|>Etterpå</)
  const missingForm = renderToStaticMarkup(createElement(Form, { data: workspace(), task: tasks[4], onSaved: () => {}, onCancel: () => {} }))
  assert.match(missingForm, new RegExp(`<option value="${id(999)}" selected="">Utilgjengelig område`))
  const areaHtml = renderToStaticMarkup(createElement(Subjects, { tasks, data: { subjects: areas, status: 'ready', busy: false, notice: '', error: null } }))
  assert.match(areaHtml, /Arkivering sletter ikke tidligere arbeid eller oppgaver/)
  assert.match(areaHtml, /Arkiverte områder \(1\)/); assert.match(areaHtml, /Aktiver igjen/)
})
