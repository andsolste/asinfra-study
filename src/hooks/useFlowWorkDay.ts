import { useEffect, useState, useSyncExternalStore } from 'react'
import { supabase } from '../lib/supabase'
import { browserTimezone, createFlowApi } from '../lib/flow-work'
import { createFlowStore } from '../lib/flow-work-store'
import { createFlowInterruption, listenForFlowInterruptions } from '../lib/flow-interruption'

export type FlowWorkspaceData = ReturnType<typeof useFlowWorkDay>
export function useFlowWorkDay(owner: string) {
  const [store] = useState(() => createFlowStore(createFlowApi(supabase!), { timezone: browserTimezone }))
  const [monitor] = useState(() => createFlowInterruption(store, { owner }))
  const state = useSyncExternalStore(store.subscribe, store.getSnapshot)
  const interruption = useSyncExternalStore(monitor.subscribe, monitor.getSnapshot)
  const [now, setNow] = useState(0)
  useEffect(() => {
    monitor.connect()
    store.connect()
    const unlisten = listenForFlowInterruptions(monitor, window, document)
    return () => {
      unlisten()
      monitor.disconnect()
      store.disconnect()
    }
  }, [store, monitor])
  useEffect(() => {
    const tick = () => { monitor.observe(); setNow(store.now()) }
    tick()
    const interval = window.setInterval(tick, 1000)
    return () => window.clearInterval(interval)
  }, [store, monitor, state.anchor])
  useEffect(() => {
    const cutoff = state.data?.current?.work_day.cutoff_at
    if (!cutoff) return
    const timer = window.setTimeout(() => void store.refresh(), Math.max(250, Date.parse(cutoff) - store.now()))
    return () => window.clearTimeout(timer)
  }, [store, state.data])
  return { ...state, now, dispatch: store.dispatch, reload: store.refresh, retry: store.retry,
    interruption, dismissInterruption: monitor.dismiss, pauseInterruption: monitor.pause }
}
