import { useEffect, useRef, useState, useSyncExternalStore } from 'react'
import type { FlowWorkspaceData } from './useFlowWorkDay'
import { createFocusPreferences, focusForState, focusSettingsKey, focusStorage, notifyFocusOnce } from '../lib/focus-rhythm'

const ready = (flow: FlowWorkspaceData) => ['running', 'paused', 'idle'].includes(flow.phase) && !flow.pending
const supported = () => typeof Notification !== 'undefined' && typeof navigator !== 'undefined' && !!navigator.locks

export function useFocusRhythm(owner: string, flow: FlowWorkspaceData) {
  const [preferences] = useState(() => createFocusPreferences(owner))
  const state = useSyncExternalStore(preferences.subscribe, preferences.getSnapshot, preferences.getSnapshot)
  const [permission, setPermission] = useState<NotificationPermission | 'unsupported'>(() => supported() ? Notification.permission : 'unsupported')
  const [noticeError, setNoticeError] = useState(false)
  const latest = useRef({ flow, settings: state.settings })
  latest.current = { flow, settings: state.settings }
  const candidate = useRef<{ id: string; afterRead: number } | null>(null)
  const handled = useRef(new Set<string>())
  const sending = useRef(false)
  const live = useRef(false)
  const progress = focusForState(flow, state.settings)
  const event = progress.kind !== 'idle' && progress.due ? progress : null

  useEffect(() => {
    live.current = true
    const storage = (e: StorageEvent) => { if (e.key === null || e.key === focusSettingsKey(owner)) preferences.refresh() }
    const returned = () => { if (supported()) setPermission(Notification.permission) }
    window.addEventListener('storage', storage); window.addEventListener('focus', returned)
    return () => { live.current = false; window.removeEventListener('storage', storage); window.removeEventListener('focus', returned) }
  }, [owner, preferences])

  useEffect(() => {
    if (!state.settings.notifications || !state.persistent || permission !== 'granted' || !ready(flow)) return
    if (!event) { candidate.current = null; return }
    if (handled.current.has(event.eventId) || sending.current) return
    if (candidate.current?.id !== event.eventId) {
      candidate.current = { id: event.eventId, afterRead: flow.latestRead() }
      // A background/woken tab must recheck canonical state before an OS notice.
      void flow.reload(); return
    }
    if (flow.readRevision <= candidate.current.afterRead) return
    sending.current = true
    void notifyFocusOnce({ owner, event, storage: focusStorage, locks: navigator.locks,
      eligible: () => {
        const { flow: current, settings } = latest.current
        const stored = createFocusPreferences(owner).getSnapshot()
        const next = focusForState(current, settings)
        return live.current && Notification.permission === 'granted' && stored.persistent && stored.settings.enabled && stored.settings.notifications
          && stored.settings.focusMinutes === settings.focusMinutes && stored.settings.breakMinutes === settings.breakMinutes
          && next.kind !== 'idle' && next.due && next.eventId === event.eventId
      },
      show: (title, options) => { new Notification(title, options) },
    }).then(result => {
      if (result !== 'skipped') handled.current.add(event.eventId)
      if (result === 'unavailable' && live.current) setNoticeError(true)
    }).finally(() => { sending.current = false })
  }, [owner, event, flow, permission, state])

  async function requestNotifications() {
    if (!supported()) return
    try {
      const next = Notification.permission === 'default' ? await Notification.requestPermission() : Notification.permission
      if (live.current) {
        setPermission(next)
        if (next === 'granted') preferences.update({ ...preferences.getSnapshot().settings, notifications: true })
      }
    } catch { if (live.current) setNoticeError(true) }
  }
  return { ...state, progress, checking: !ready(flow), permission, noticeError,
    update: preferences.update, requestNotifications }
}
