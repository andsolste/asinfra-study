import { useEffect, useState, useSyncExternalStore } from 'react'
import { supabase } from '../lib/supabase'
import { createFlowHistoryApi } from '../lib/flow-history'
import { createStatisticsApi } from '../lib/flow-statistics'
import { createFlowHistoryStore } from '../lib/flow-history-store'

export type FlowHistoryData = ReturnType<typeof useFlowHistory>
export function useFlowHistory() {
  const [store] = useState(() => createFlowHistoryStore({ ...createFlowHistoryApi(supabase!), ...createStatisticsApi(supabase!) }))
  const state = useSyncExternalStore(store.subscribe, store.getSnapshot)
  useEffect(() => { store.connect(); return () => store.disconnect() }, [store])
  return { ...state, now: store.now, reload: store.refresh, more: store.more, selectPeriod: store.selectPeriod,
    selectArea: store.selectArea, setTimezone: store.setTimezone, editLegacy: store.editLegacy, removeLegacy: store.removeLegacy, attribute: store.attribute }
}
