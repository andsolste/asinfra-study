import assert from 'node:assert/strict'
import test from 'node:test'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { createServer } from 'vite'
import react from '@vitejs/plugin-react'
import { taskDeadlineInput } from '../src/lib/flow-tasks.ts'

test('TaskForm renders optional date and minute-only time without changing an existing deadline', { timeout: 30000 }, async t => {
  const server = await createServer({ configFile: false, envFile: false, appType: 'custom', logLevel: 'silent',
    server: { middlewareMode: true, hmr: false }, plugins: [react()] })
  t.after(() => server.close())
  const { default: TaskForm } = await server.ssrLoadModule('/src/components/TaskForm.tsx')
  const render = (task = null) => renderToStaticMarkup(createElement(TaskForm, {
    task, data: { phase: 'idle', data: null, catalog: { areas: [], tasks: [] } },
    onSaved: () => assert.fail('Opening the form must not save'), onCancel: () => {},
  }))
  const input = (html, id) => html.match(new RegExp(`<input\\b[^>]*id="${id}"[^>]*>`))?.[0] ?? assert.fail('Missing input ' + id)
  const empty = render()
  assert.match(input(empty, 'task-deadline'), /type="date"/)
  assert.match(input(empty, 'task-deadline'), /value=""/)
  assert.match(input(empty, 'task-deadline-time'), /type="time" step="60"/)
  assert.match(input(empty, 'task-deadline-time'), /value="23:00"/)
  assert.match(input(empty, 'task-deadline-time'), /disabled=""/)
  const exact = '2026-11-12T12:34:56.123456Z'
  const row = { id: '10000000-0000-4000-8000-000000000001', title: 'Read', description: '', area_id: null, deadline_at: exact }
  const editing = render(row), local = taskDeadlineInput(exact)
  assert.ok(input(editing, 'task-deadline').includes(`value="${local.slice(0, 10)}"`))
  assert.ok(input(editing, 'task-deadline-time').includes(`value="${local.slice(11)}"`))
  assert.doesNotMatch(input(editing, 'task-deadline-time'), /disabled|value="\d{2}:\d{2}:/)
  assert.equal(row.deadline_at, exact)
})
