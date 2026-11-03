import type { FlowSnapshot, FlowState } from './flow-work.ts'
import { timestampMicroseconds as micros, serverClockMicroseconds, segmentMicroseconds, durationMilliseconds } from './time-precision.ts'

export type FocusSettings = { enabled: boolean; focusMinutes: number; breakMinutes: number; notifications: boolean }
export const focusDefaults: FocusSettings = { enabled: false, focusMinutes: 25, breakMinutes: 5, notifications: false }
export const focusPresets = [[25, 5], [50, 10], [90, 15]] as const
export type FocusProgress = { kind: 'focus' | 'break'; remaining: number; due: boolean; eventId: string } | { kind: 'idle' }
export type FocusStorage = Pick<Storage, 'getItem' | 'setItem'>
export const focusSettingsKey = (owner: string) => `flow.focus.settings.v1:${owner}`
export const focusNoticesKey = (owner: string) => `flow.focus.notices.v1:${owner}`
export const focusStorage = (): FocusStorage | null => { try { return window.localStorage } catch { return null } }

export function validateFocusSettings(value: unknown): FocusSettings {
  const s = value as FocusSettings | null
  if (!s || typeof s.enabled !== 'boolean' || typeof s.notifications !== 'boolean'
    || !Number.isInteger(s.focusMinutes) || s.focusMinutes < 1 || s.focusMinutes > 240
    || !Number.isInteger(s.breakMinutes) || s.breakMinutes < 1 || s.breakMinutes > 60) {
    throw new Error('Velg hele minutter: fokus 1–240 og pause 1–60.')
  }
  return { enabled: s.enabled, focusMinutes: s.focusMinutes, breakMinutes: s.breakMinutes, notifications: s.notifications }
}

// No local elapsed time/phase is persisted. Reconstruct the current rhythm from
// canonical periods, including exact touching activity switches and corrections.
export function focusProgress(snapshot: FlowSnapshot | null, now: number, settings: FocusSettings): FocusProgress {
  if (!settings.enabled || !snapshot || snapshot.work_day.ended_at) return { kind: 'idle' }
  const clock = serverClockMicroseconds(now, snapshot.server_time), cutoff = micros(snapshot.work_day.cutoff_at)
  if (clock >= cutoff) return { kind: 'idle' }
  let work = 0n, edge: bigint | null = null, first = '', lastEnd: bigint | null = null, lastId = ''
  for (const s of snapshot.segments) {
    const start = micros(s.started_at), end = s.ended_at ? micros(s.ended_at) : clock
    if (s.ended_at && (lastEnd === null || end >= lastEnd)) { lastEnd = end; lastId = s.id }
    // Zero-length corrections contribute no work and do not split a block.
    if (start > clock || end === start && s.ended_at !== null) continue
    if (edge === null || start > edge) { work = 0n; first = s.id }
    work += segmentMicroseconds(s, clock)
    edge = end < clock ? end : clock
  }
  const running = snapshot.segments.some(s => s.ended_at === null)
  if (!running && lastEnd === null) return { kind: 'idle' }
  const elapsed = running ? work : clock > lastEnd! ? clock - lastEnd! : 0n
  const goal = BigInt(running ? settings.focusMinutes : settings.breakMinutes) * 60_000_000n
  const kind = running ? 'focus' : 'break', remaining = goal - elapsed
  return { kind, remaining: durationMilliseconds(remaining > 0n ? remaining + 999n : 0n), due: remaining <= 0n,
    eventId: `${snapshot.work_day.id}:${kind}:${running ? first : lastId}` }
}

export function focusForState(flow: { phase: string; pending: unknown; data: FlowState | null; now: number }, settings: FocusSettings): FocusProgress {
  if (!['running', 'paused', 'idle'].includes(flow.phase) || flow.pending) return { kind: 'idle' }
  return focusProgress(flow.data?.current ?? null, Math.max(flow.now, flow.data ? Date.parse(flow.data.server_time) : 0), settings)
}

export function focusClock(milliseconds: number): string {
  const seconds = Math.max(0, Math.ceil(milliseconds / 1000))
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`
}

export function createFocusPreferences(owner: string, access: () => FocusStorage | null = focusStorage) {
  function read() {
    try {
      const storage = access()
      if (!storage) return { settings: { ...focusDefaults }, persistent: false }
      const raw = storage.getItem(focusSettingsKey(owner))
      if (!raw) return { settings: { ...focusDefaults }, persistent: true }
      const value = raw.length <= 2048 ? JSON.parse(raw) : null
      return { settings: value?.version === 1 ? validateFocusSettings(value) : { ...focusDefaults }, persistent: true }
    } catch { return { settings: { ...focusDefaults }, persistent: false } }
  }
  let state = read()
  const listeners = new Set<() => void>()
  const publish = (next: typeof state) => {
    if (JSON.stringify(next) === JSON.stringify(state)) return
    state = next; listeners.forEach(fn => fn())
  }
  return {
    getSnapshot: () => state,
    subscribe(fn: () => void) { listeners.add(fn); return () => { listeners.delete(fn) } },
    refresh() { publish(read()) },
    update(value: FocusSettings) {
      const settings = validateFocusSettings(value)
      let persistent = false
      try {
        const storage = access(), raw = JSON.stringify({ version: 1, ...settings })
        if (storage) { storage.setItem(focusSettingsKey(owner), raw); persistent = storage.getItem(focusSettingsKey(owner)) === raw }
      } catch { /* Settings still work in memory; never interfere with Flow. */ }
      publish({ settings, persistent })
    },
  }
}

type NoticeOptions = {
  owner: string; event: Extract<FocusProgress, { kind: 'focus' | 'break' }>; eligible: () => boolean
  storage: () => FocusStorage | null; locks: Pick<LockManager, 'request'> | null
  show: (title: string, options: NotificationOptions) => void
}
// Web Locks serializes the durable claim across tabs. Claim BEFORE delivery:
// a killed tab may lose its OS notice, but cannot resend it after reload.
// Without reliable storage/locking, fail closed to in-app messages only.
export async function notifyFocusOnce({ owner, event, eligible, storage: access, locks, show }: NoticeOptions) {
  if (!locks) return 'unavailable'
  try {
    return await locks.request(`flow.focus.notify.v1:${owner}`, () => {
      if (!eligible()) return 'skipped'
      const storage = access()
      if (!storage) return 'unavailable'
      const raw = storage.getItem(focusNoticesKey(owner))
      const sent: unknown = raw === null ? [] : raw.length <= 32_768 ? JSON.parse(raw) : null
      if (!Array.isArray(sent) || sent.length > 128 || sent.some(id => typeof id !== 'string' || id.length > 300)) return 'unavailable'
      if (sent.includes(event.eventId)) return 'seen'
      const next = JSON.stringify([...sent.slice(-127), event.eventId])
      storage.setItem(focusNoticesKey(owner), next)
      if (storage.getItem(focusNoticesKey(owner)) !== next || !eligible()) return 'unavailable'
      show(event.kind === 'focus' ? 'Flow · Tid for pause' : 'Flow · Pausen er ferdig', {
        body: event.kind === 'focus' ? 'Fokusmålet er nådd. Velg Pause i Flow når det passer.' : 'Fortsett i Flow når du er klar.',
        tag: `flow-focus:${owner}:${event.eventId}`,
      })
      return 'sent'
    })
  } catch { return 'unavailable' }
}
