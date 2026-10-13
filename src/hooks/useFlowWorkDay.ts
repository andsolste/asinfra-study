import { useEffect, useState, useSyncExternalStore } from 'react'
import { supabase } from '../lib/supabase'
import { browserTimezone, createFlowApi } from '../lib/flow-work'
import { createFlowStore } from '../lib/flow-work-store'

export type FlowWorkspaceData = ReturnType<typeof useFlowWorkDay>
export function useFlowWorkDay() {
  const [store] = useState(() => createFlowStore(createFlowApi(supabase!), { timezone: browserTimezone }))
  const state = useSyncExternalStore(store.subscribe, store.getSnapshot)
  const [now, setNow] = useState(0)
  useEffect(() => {
    store.connect()
    const refresh = () => { if (document.visibilityState === 'visible') void store.refresh() }
    window.addEventListener('focus', refresh)
    window.addEventListener('online', refresh)
    document.addEventListener('visibilitychange', refresh)
    return () => {
      store.disconnect()
      window.removeEventListener('focus', refresh)
      window.removeEventListener('online', refresh)
      document.removeEventListener('visibilitychange', refresh)
    }
  }, [store])
  useEffect(() => {
    const tick = () => setNow(store.now())
    tick()
    const interval = window.setInterval(tick, 1000)
    return () => window.clearInterval(interval)
  }, [store, state.anchor])
  useEffect(() => {
    const cutoff = state.data?.current?.work_day.cutoff_at
    if (!cutoff) return
    const timer = window.setTimeout(() => void store.refresh(), Math.max(250, Date.parse(cutoff) - store.now()))
    return () => window.clearTimeout(timer)
  }, [store, state.data])
  return { ...state, now, dispatch: store.dispatch, reload: store.refresh, retry: store.retry }
}
