import type { createFlowStore } from './flow-work-store.ts'
import { pauseActivityCommand } from './flow-activity.ts'

export const FLOW_GAP_MS = 30 * 60 * 1000
export const FLOW_CHECKPOINT_MAX_AGE_MS = 48 * 60 * 60 * 1000
export const FLOW_CHECKPOINT_KEY = 'flow.interruption.v1'
const CHECKPOINT_INTERVAL_MS = 60 * 1000
type Identity = { dayId: string; segmentId: string; count: number }
type Observation = Identity & { wall: number; monotonic: number | null }
type Candidate = Identity & { afterRead: number }
type Store = ReturnType<typeof createFlowStore>
type StorageAccess = () => Pick<Storage, 'getItem' | 'setItem' | 'removeItem'> | null
type Options = { owner: string; wall?: () => number; monotonic?: () => number; storage?: StorageAccess }
const same = (a: Identity | null, b: Identity | null) => Boolean(a && b && a.dayId === b.dayId && a.segmentId === b.segmentId && a.count === b.count)
const ready = (state: ReturnType<Store['getSnapshot']>) => ['running', 'paused', 'idle'].includes(state.phase) && !state.pending
function identity(store: Store): Identity | null {
  const current = store.getSnapshot().data?.current, open = current?.segments.find(s => s.ended_at === null)
  return current && !current.work_day.ended_at && open ? { dayId: current.work_day.id, segmentId: open.id, count: current.segments.length } : null
}

// Observations are local hints only. No time calculation, input monitoring or
// automatic write belongs here. Both clocks can independently reveal a gap.
export function createFlowInterruption(store: Store, options: Options) {
  const wall = options.wall ?? Date.now, monotonic = options.monotonic ?? (() => performance.now())
  const storage = options.storage ?? (() => window.sessionStorage)
  let previous: Observation | null = null, candidate: Candidate | null = null, notice: Identity | null = null
  let unsubscribe: (() => void) | null = null, initialized = false, lastWritten: number | null = null
  let checkpointCleared = false
  const listeners = new Set<() => void>()
  function publish(next: Identity | null) {
    if (same(notice, next) || (!notice && !next)) return
    notice = next; listeners.forEach(fn => fn())
  }
  function clearCheckpoint() {
    if (!checkpointCleared) { try { storage()?.removeItem(FLOW_CHECKPOINT_KEY) } catch { /* Storage is optional. */ } }
    checkpointCleared = true; lastWritten = null
  }
  function restore() {
    try {
      const raw = storage()?.getItem(FLOW_CHECKPOINT_KEY)
      if (!raw) return
      const value = raw.length <= 1024 ? JSON.parse(raw) : null
      const uuid = /^[\da-f]{8}-[\da-f]{4}-[\da-f]{4}-[\da-f]{4}-[\da-f]{12}$/i
      if (!value || value.version !== 1 || value.owner !== options.owner ||
        !uuid.test(value.dayId) || !uuid.test(value.segmentId) || !Number.isSafeInteger(value.count) || value.count < 1 ||
        !Number.isFinite(value.wall) || value.wall < 0 || wall() < value.wall || wall() - value.wall > FLOW_CHECKPOINT_MAX_AGE_MS) {
        clearCheckpoint(); return
      }
      previous = { dayId: value.dayId, segmentId: value.segmentId, count: value.count, wall: value.wall, monotonic: null }
      if (wall() - value.wall >= FLOW_GAP_MS) candidate = { ...previous, afterRead: store.latestRead() }
    } catch { clearCheckpoint() }
  }
  function persist(force = false) {
    if (!previous || candidate || !ready(store.getSnapshot())) return
    if (!force && lastWritten !== null && previous.wall - lastWritten < CHECKPOINT_INTERVAL_MS && previous.wall >= lastWritten) return
    try {
      storage()?.setItem(FLOW_CHECKPOINT_KEY, JSON.stringify({ version: 1, owner: options.owner,
        dayId: previous.dayId, segmentId: previous.segmentId, count: previous.count, wall: previous.wall }))
      lastWritten = previous.wall; checkpointCleared = false
    } catch { /* A blocked/full sessionStorage must never stop the timer. */ }
  }
  function observe() {
    const state = store.getSnapshot(), current = identity(store), at = wall(), tick = monotonic()
    if (candidate && ready(state) && state.readRevision > candidate.afterRead) {
      publish(same(candidate, current) ? current : null)
      candidate = null
      // The accepted read resolves the old observation. Never reinterpret it as
      // a new gap when resetting the server anchor/tick effect.
      previous = current ? { ...current, wall: at, monotonic: tick } : null
    }
    if (ready(state) && !same(current, notice)) publish(null)
    if (ready(state) && !current) {
      previous = null; candidate = null; clearCheckpoint(); return false
    }
    let refresh = false
    if (current && previous && same(current, previous) && !candidate &&
      (at - previous.wall >= FLOW_GAP_MS || (previous.monotonic !== null && tick - previous.monotonic >= FLOW_GAP_MS))) {
      candidate = { ...current, afterRead: store.latestRead() }; publish(null); refresh = true
    }
    if (ready(state) && current) {
      if (!same(current, previous)) {
        previous = null; candidate = null; clearCheckpoint()
      }
      previous = { ...current, wall: at, monotonic: tick }
      persist()
    }
    if (refresh) void store.refresh()
    return refresh
  }
  return {
    subscribe(fn: () => void) { listeners.add(fn); return () => { listeners.delete(fn) } },
    getSnapshot: () => notice,
    connect() {
      if (!initialized) { initialized = true; restore() }
      unsubscribe ??= store.subscribe(observe)
    },
    disconnect() { unsubscribe?.(); unsubscribe = null; clearCheckpoint() },
    observe,
    checkpoint() { observe(); persist(true) },
    refresh() { void store.refresh() },
    dismiss() {
      if (!ready(store.getSnapshot()) || !same(notice, identity(store))) return
      publish(null); previous = null; observe(); persist(true)
    },
    pause() {
      const state = store.getSnapshot()
      if (!notice || candidate || !ready(state) || !same(notice, identity(store))) return Promise.resolve(false)
      const command = pauseActivityCommand(state.data)
      return command ? store.dispatch(command) : Promise.resolve(false)
    },
  }
}

// One event bridge, shared by the hook and deterministic EventTarget tests.
export function listenForFlowInterruptions(monitor: ReturnType<typeof createFlowInterruption>, win: Window, doc: Document) {
  const returned = () => { const requested = monitor.observe(); if (doc.visibilityState === 'visible' && !requested) monitor.refresh() }
  const checkpoint = () => monitor.checkpoint()
  const visibility = () => { if (doc.visibilityState === 'visible') returned(); else checkpoint() }
  for (const event of ['focus', 'online', 'pageshow']) win.addEventListener(event, returned)
  win.addEventListener('pagehide', checkpoint)
  doc.addEventListener('visibilitychange', visibility)
  if ('onresume' in doc) doc.addEventListener('resume', returned)
  if ('onfreeze' in doc) doc.addEventListener('freeze', checkpoint)
  return () => {
    for (const event of ['focus', 'online', 'pageshow']) win.removeEventListener(event, returned)
    win.removeEventListener('pagehide', checkpoint)
    doc.removeEventListener('visibilitychange', visibility)
    doc.removeEventListener('resume', returned)
    doc.removeEventListener('freeze', checkpoint)
  }
}
