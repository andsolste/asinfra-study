import assert from 'node:assert/strict'
import test from 'node:test'
import { readFile } from 'node:fs/promises'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { createServer } from 'vite'
import react from '@vitejs/plugin-react'
import { createFlowStore } from '../src/lib/flow-work-store.ts'
import { pauseActivityCommand } from '../src/lib/flow-activity.ts'
import { createFlowInterruption, listenForFlowInterruptions, FLOW_GAP_MS, FLOW_CHECKPOINT_KEY, FLOW_CHECKPOINT_MAX_AGE_MS } from '../src/lib/flow-interruption.ts'

const id = n => `10000000-0000-4000-8000-${String(n).padStart(12, '0')}`
const initial = Date.parse('2026-10-21T08:00:00Z')
const tick = () => new Promise(setImmediate)
function running() {
  return { work_day: { id: id(1), logical_date: '2026-10-21', timezone: 'UTC', started_at: new Date(initial).toISOString(),
    boundary_at: '2026-10-21T04:00:00Z', cutoff_at: '2026-10-22T04:00:00Z', ended_at: null },
  segments: [{ id: id(2), work_day_id: id(1), area_id: null, task_id: null, started_at: new Date(initial).toISOString(), ended_at: null }] }
}
function fixture({ mode = 'running', checkpoint = null, brokenStorage = false } = {}) {
  let wall = initial, monotonic = 1000, server = initial, current = running(), failRead = false, failWrite = false, loseReply = false
  let reads = 0, saves = 0, removals = 0, hold = false, holdWrite = false, writeRelease
  const held = [], commands = [], values = new Map(checkpoint === null ? [] : [[FLOW_CHECKPOINT_KEY, checkpoint]])
  const storage = {
    getItem: key => { if (brokenStorage) throw Error('blocked'); return values.get(key) ?? null },
    setItem: (key, value) => { if (brokenStorage) throw Error('full'); saves++; values.set(key, value) },
    removeItem: key => { if (brokenStorage) throw Error('blocked'); removals++; values.delete(key) },
  }
  if (mode === 'idle') current = null
  if (mode === 'paused') current.segments[0].ended_at = new Date(initial).toISOString()
  const state = () => structuredClone({ current, server_time: new Date(server).toISOString(), next_boundary_at: '2026-10-21T04:00:00Z', next_cutoff_at: '2026-10-22T04:00:00Z', legacy_active: false })
  const api = {
    load: async () => {
      reads++
      if (failRead) throw Error('network')
      const result = state()
      return hold ? new Promise(resolve => held.push(() => resolve(result))) : result
    },
    catalog: async () => ({ areas: [], tasks: [] }), snapshot: async () => ({ ...running(), work_day: { ...running().work_day, ended_at: '2026-10-22T04:00:00Z' } }),
    act: async command => {
      commands.push(structuredClone(command))
      if (holdWrite) await new Promise(resolve => { writeRelease = resolve })
      if (failWrite) throw Error('write failed')
      const open = current?.segments.find(s => !s.ended_at)
      if (current?.work_day.id === command.dayId && open?.id === command.expectedId && current?.segments.length === command.expectedCount) {
        open.ended_at = new Date(server).toISOString()
        if (command.nextId) current.segments.push({ ...open, id: command.nextId, started_at: open.ended_at, ended_at: null })
      }
      if (loseReply) throw Error('lost reply')
    },
  }
  const store = createFlowStore(api, { timezone: () => 'UTC', clock: () => monotonic })
  const monitor = createFlowInterruption(store, { owner: id(9), wall: () => wall, monotonic: () => monotonic, storage: () => storage })
  return { store, monitor, commands, values, held, state, storage,
    connect: async () => { monitor.connect(); store.connect(); await tick() },
    close: () => { monitor.disconnect(); store.disconnect() },
    advance(ms, mono = ms) { wall += ms; monotonic += mono; server += ms },
    setCurrent(value) { current = value }, get current() { return current },
    holdReads(value = true) { hold = value }, holdWrites() { holdWrite = true }, releaseWrite() { writeRelease() },
    fail(read, write = false, lost = false) { failRead = read; failWrite = write; loseReply = lost },
    get reads() { return reads }, get saves() { return saves }, get removals() { return removals },
  }
}
const checkpoint = (extra = {}) => JSON.stringify({ version: 1, owner: id(9), dayId: id(1), segmentId: id(2), count: 1, wall: initial - FLOW_GAP_MS - 1, ...extra })

test('normal 1s callbacks, short gaps and two hours hidden with callbacks never prompt or write', async t => {
  const f = fixture(); t.after(f.close); await f.connect()
  for (let i = 0; i < 7200; i++) { f.advance(1000); f.monitor.observe() }
  assert.equal(f.reads, 1); assert.equal(f.monitor.getSnapshot(), null); assert.equal(f.commands.length, 0)
  assert.ok(f.saves < 125, 'periodic checkpoint is not written each second')
  f.advance(5 * 60000); f.monitor.observe(); assert.equal(f.reads, 1)
})

for (const [name, wallDelta, monoDelta] of [
  ['both clocks advance', FLOW_GAP_MS, FLOW_GAP_MS],
  ['monotonic excludes sleep', FLOW_GAP_MS + 1, 1000],
  ['wall clock moved back', -3600000, FLOW_GAP_MS + 1],
]) test(name + ': gap requests read and only same confirmed segment can prompt', async t => {
  const f = fixture(); t.after(f.close); await f.connect(); f.holdReads()
  f.advance(wallDelta, monoDelta)
  assert.equal(f.monitor.observe(), true)
  assert.equal(f.monitor.getSnapshot(), null, 'no message before server read')
  assert.equal(f.commands.length, 0)
  f.held.shift()(); await tick()
  assert.deepEqual(f.monitor.getSnapshot(), { dayId: id(1), segmentId: id(2), count: 1 })
  const reads = f.reads
  for (let i = 0; i < 10; i++) { f.advance(1000); f.monitor.observe() }
  assert.equal(f.reads, reads, 'no refresh loop')
})

test('a queued refresh return and older in-flight read do NOT satisfy the new-read barrier', async t => {
  const f = fixture(); t.after(f.close); await f.connect(); f.holdReads()
  const oldRead = f.store.refresh(); assert.equal(f.reads, 2)
  f.advance(FLOW_GAP_MS + 1); f.monitor.observe()
  assert.equal(await f.store.refresh(), false)
  f.held.shift()(); await oldRead
  assert.equal(f.store.getSnapshot().readRevision, 2)
  assert.equal(f.monitor.getSnapshot(), null, 'old read cannot confirm a gap seen after it started')
  assert.equal(f.reads, 3)
  f.held.shift()(); await tick()
  assert.equal(f.monitor.getSnapshot().segmentId, id(2))
})

for (const mode of ['idle', 'paused']) test(mode + ' before a gap never starts, prompts or auto-resumes', async t => {
  const f = fixture({ mode }); t.after(f.close); await f.connect()
  f.advance(3 * 3600000); f.monitor.observe(); await tick()
  for (let i = 0; i < 120; i++) { f.advance(1000); f.monitor.observe() }
  assert.equal(f.monitor.getSnapshot(), null); assert.equal(f.reads, 1); assert.equal(f.commands.length, 0)
  assert.equal(f.values.has(FLOW_CHECKPOINT_KEY), false)
  assert.ok(f.removals <= 1, 'idle/paused ticks must not repeatedly mutate storage')
})

for (const change of ['paused', 'new segment', 'count changed', 'new day', 'cutoff']) test(change + ' after gap discards old identity, never retargets Pause now', async t => {
  const f = fixture(); t.after(f.close); await f.connect()
  const value = running()
  if (change === 'paused') value.segments[0].ended_at = new Date(initial).toISOString()
  if (change === 'new segment') value.segments[0].id = id(3)
  if (change === 'count changed') value.segments.unshift({ ...value.segments[0], id: id(4), ended_at: new Date(initial).toISOString() })
  if (change === 'new day') value.work_day.id = id(5)
  f.setCurrent(change === 'cutoff' ? null : value)
  f.advance(change === 'cutoff' ? 24 * 3600000 : FLOW_GAP_MS + 1); f.monitor.observe(); await tick()
  assert.equal(f.monitor.getSnapshot(), null)
  assert.equal(await f.monitor.pause(), false); assert.equal(f.commands.length, 0)
})

test('dismiss does not write; new long gap can prompt and reload does not reuse the dismissed observation', async t => {
  const f = fixture(); t.after(f.close); await f.connect(); f.advance(FLOW_GAP_MS); f.monitor.observe(); await tick()
  f.monitor.dismiss(); assert.equal(f.monitor.getSnapshot(), null); assert.equal(f.commands.length, 0)
  assert.equal(JSON.parse(f.values.get(FLOW_CHECKPOINT_KEY)).wall, initial + FLOW_GAP_MS)
  for (let i = 0; i < 3; i++) { f.advance(1000); f.monitor.observe() }
  assert.equal(f.monitor.getSnapshot(), null)
  f.advance(FLOW_GAP_MS); f.monitor.observe(); await tick(); assert.ok(f.monitor.getSnapshot())
})

test('Pause now shares ordinary Pause command, server path and double-click guard', async t => {
  const f = fixture(); t.after(f.close); await f.connect(); f.advance(FLOW_GAP_MS); f.monitor.observe(); await tick()
  const expected = pauseActivityCommand(f.store.getSnapshot().data)
  const first = f.monitor.pause(), second = f.monitor.pause()
  assert.equal(await second, false); assert.equal(await first, true)
  assert.deepEqual(f.commands, [expected])
  assert.deepEqual(expected, { kind: 'activity', dayId: id(1), expectedId: id(2), expectedCount: 1, nextId: null, areaId: null, taskId: null })
  assert.equal(f.store.getSnapshot().phase, 'paused'); assert.equal(f.monitor.getSnapshot(), null)
  assert.equal(f.values.has(FLOW_CHECKPOINT_KEY), false)
})

test('another tab changes or pauses after prompt: stale Pause now cannot close its newer segment', async t => {
  for (const mode of ['new', 'paused']) {
    const f = fixture(); t.after(f.close); await f.connect(); f.advance(FLOW_GAP_MS); f.monitor.observe(); await tick()
    const value = running(); if (mode === 'new') value.segments[0].id = id(3); else value.segments[0].ended_at = new Date(initial).toISOString()
    f.setCurrent(value)
    assert.equal(await f.monitor.pause(), true, 'existing store accepts authoritative absence of expected open segment')
    assert.equal(f.current.segments[0].ended_at, value.segments[0].ended_at)
    assert.equal(f.commands[0].expectedId, id(2)); assert.equal(f.monitor.getSnapshot(), null)
  }
})

test('lost pause response reads canonical paused state; failed recovery retains exact retry, no assist write', async t => {
  const f = fixture(); t.after(f.close); await f.connect(); f.advance(FLOW_GAP_MS); f.monitor.observe(); await tick()
  f.fail(false, false, true); await f.monitor.pause()
  assert.equal(f.store.getSnapshot().phase, 'paused'); assert.equal(f.monitor.getSnapshot(), null); assert.equal(f.commands.length, 1)
  const g = fixture(); t.after(g.close); await g.connect(); g.advance(FLOW_GAP_MS); g.monitor.observe(); await tick()
  g.fail(true, true); await g.monitor.pause()
  assert.equal(g.store.getSnapshot().phase, 'error'); assert.deepEqual(g.store.getSnapshot().pending, g.commands[0])
  assert.equal(await g.monitor.pause(), false); assert.equal(g.commands.length, 1)
  g.fail(false); await g.store.retry()
  assert.deepEqual(g.commands, [g.commands[0], g.commands[0]])
  assert.equal(g.store.getSnapshot().phase, 'paused'); assert.equal(g.monitor.getSnapshot(), null)
})

test('gap during pending/recovering queues read only; failed reads never authorize a message/write', async t => {
  const f = fixture(); t.after(f.close); await f.connect(); f.holdWrites()
  const writing = f.store.dispatch({ ...pauseActivityCommand(f.store.getSnapshot().data), nextId: id(3) })
  f.advance(FLOW_GAP_MS); f.monitor.observe()
  assert.equal(f.monitor.getSnapshot(), null); assert.equal(await f.monitor.pause(), false); assert.equal(f.commands.length, 1)
  f.releaseWrite(); await writing; await tick()
  assert.equal(f.monitor.getSnapshot(), null); assert.equal(f.current.segments.at(-1).id, id(3))
  const g = fixture(); t.after(g.close); await g.connect(); g.fail(true)
  g.advance(FLOW_GAP_MS); g.monitor.observe(); await tick()
  assert.equal(g.monitor.getSnapshot(), null); assert.equal(g.store.getSnapshot().phase, 'error'); assert.equal(g.commands.length, 0)
  const reads = g.reads
  g.advance(1000); g.monitor.observe(); assert.equal(g.reads, reads, 'no retry storm while offline')
  g.fail(false); await g.store.refresh(); assert.ok(g.monitor.getSnapshot())
})

for (const [name, value, prompt] of [
  ['valid old checkpoint', checkpoint(), true],
  ['fresh reload', checkpoint({ wall: initial - 1000 }), false],
  ['expired >48h', checkpoint({ wall: initial - FLOW_CHECKPOINT_MAX_AGE_MS - 1 }), false],
  ['another owner', checkpoint({ owner: id(8) }), false],
  ['another day', checkpoint({ dayId: id(5) }), false],
  ['another segment', checkpoint({ segmentId: id(5) }), false],
  ['wrong count', checkpoint({ count: 2 }), false],
  ['bad version', checkpoint({ version: 2 }), false],
  ['future clock', checkpoint({ wall: initial + 1000 }), false],
  ['invalid ID', checkpoint({ segmentId: 'bad' }), false],
  ['invalid count', checkpoint({ count: 0 }), false],
  ['corrupt JSON', '{', false],
  ['no checkpoint / discarded document alone', null, false],
]) test('reload: ' + name, async t => {
  const f = fixture({ checkpoint: value }); t.after(f.close); await f.connect()
  assert.equal(Boolean(f.monitor.getSnapshot()), prompt); assert.equal(f.commands.length, 0)
  assert.equal(f.reads, 1, 'initial server read can validate a restored candidate')
})

test('checkpoint ignored for already paused server; blocked storage and logout/StrictMode are safe', async t => {
  const f = fixture({ mode: 'paused', checkpoint: checkpoint() }); t.after(f.close); await f.connect()
  assert.equal(f.monitor.getSnapshot(), null); assert.equal(f.values.has(FLOW_CHECKPOINT_KEY), false)
  const g = fixture({ brokenStorage: true }); t.after(g.close); await g.connect(); g.advance(FLOW_GAP_MS); g.monitor.observe(); await tick()
  assert.ok(g.monitor.getSnapshot()); await g.monitor.pause(); assert.equal(g.store.getSnapshot().phase, 'paused')
  const h = fixture({ checkpoint: checkpoint() }); t.after(h.close)
  h.monitor.connect(); h.store.connect(); h.close(); await h.connect()
  assert.ok(h.monitor.getSnapshot(), 'StrictMode reconnect retains the in-memory restored candidate')
  assert.ok(h.values.has(FLOW_CHECKPOINT_KEY)); h.close(); assert.equal(h.values.has(FLOW_CHECKPOINT_KEY), false)
})

test('browser events coalesce reads; hidden/pagehide/freeze only checkpoint; no unsupported/unload/input handlers', async t => {
  const f = fixture(); t.after(f.close); await f.connect(); f.holdReads()
  const win = new EventTarget(), doc = new EventTarget()
  doc.visibilityState = 'visible'; doc.onresume = null; doc.onfreeze = null; doc.wasDiscarded = true
  const off = listenForFlowInterruptions(f.monitor, win, doc); t.after(off)
  for (const event of ['focus', 'online', 'pageshow']) win.dispatchEvent(Object.assign(new Event(event), { persisted: true }))
  doc.dispatchEvent(new Event('resume')); doc.dispatchEvent(new Event('visibilitychange'))
  assert.equal(f.reads, 2); assert.equal(f.commands.length, 0)
  f.held.shift()(); await tick(); assert.equal(f.reads, 3)
  f.held.shift()(); await tick(); assert.equal(f.reads, 3, 'one queued read, not a loop')
  doc.visibilityState = 'hidden'
  doc.dispatchEvent(new Event('visibilitychange')); win.dispatchEvent(new Event('pagehide')); doc.dispatchEvent(new Event('freeze'))
  assert.equal(f.reads, 3); assert.equal(f.commands.length, 0); assert.equal(f.monitor.getSnapshot(), null)
  f.advance(FLOW_GAP_MS); doc.visibilityState = 'visible'
  win.dispatchEvent(new Event('pageshow')); doc.dispatchEvent(new Event('resume'))
  assert.equal(f.monitor.getSnapshot(), null)
  f.held.shift()(); await tick(); assert.ok(f.monitor.getSnapshot())
  if (f.held.length) { f.held.shift()(); await tick() }
  off(); const reads = f.reads; win.dispatchEvent(new Event('focus')); assert.equal(f.reads, reads)
  const source = await readFile(new URL('../src/lib/flow-interruption.ts', import.meta.url), 'utf8')
  assert.doesNotMatch(source, /addEventListener\('(unload|keydown|mousemove|touchstart)'|IdleDetector|BroadcastChannel/)
  const plainDoc = new EventTarget(); plainDoc.visibilityState = 'visible'
  const detach = listenForFlowInterruptions(f.monitor, win, plainDoc); detach()
})

test('notice uses real accessible TSX, no automatic modal/focus; busy/error actions are disabled across views', { timeout: 30000 }, async t => {
  const vite = await createServer({ configFile: false, envFile: false, appType: 'custom', logLevel: 'silent',
    server: { middlewareMode: true, hmr: false }, plugins: [react()] })
  t.after(() => vite.close())
  const { default: Notice } = await vite.ssrLoadModule('/src/components/FlowInterruption.tsx')
  const render = data => renderToStaticMarkup(createElement(Notice, { data, history: { mutation: null }, onCorrect: async () => true }))
  assert.equal(render({ interruption: null }), '')
  const data = { interruption: { dayId: id(1), segmentId: id(2), count: 1 }, phase: 'running', pending: null }
  const html = render(data)
  assert.match(html, /role="status" aria-atomic="true"/)
  assert.match(html, /Kontroller timeren/); assert.match(html, /Jeg jobbet videre/); assert.match(html, /Pause nå/); assert.match(html, /Korriger tid/)
  assert.match(html, /Tid som allerede er registrert, endres ikke/)
  assert.doesNotMatch(html, /dialog|autofocus|disabled=/)
  for (const phase of ['loading', 'recovering', 'error', 'paused', 'idle']) assert.equal((render({ ...data, phase }).match(/disabled=""/g) ?? []).length, 3)
  assert.equal((render({ ...data, pending: {} }).match(/disabled=""/g) ?? []).length, 3)
  const account = await readFile(new URL('../src/components/Account.tsx', import.meta.url), 'utf8')
  assert.ok(account.indexOf('<FlowInterruption') < account.indexOf('<div className="work-layout"'))
  const timer = await readFile(new URL('../src/components/FlowTimer.tsx', import.meta.url), 'utf8')
  assert.match(timer, /pauseActivityCommand\(data.data\)/)
})
