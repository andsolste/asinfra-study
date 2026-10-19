import { useEffect, useState, useSyncExternalStore } from 'react'
import { supabase } from '../lib/supabase'
import { createExportApi, downloadCsv } from '../lib/flow-export'
import { createExportStore } from '../lib/flow-export-store'
import { createStatisticsApi } from '../lib/flow-statistics'

export function useFlowExport() {
  const [store] = useState(() => createExportStore({ ...createExportApi(supabase!), ...createStatisticsApi(supabase!) }, downloadCsv))
  const state = useSyncExternalStore(store.subscribe, store.getSnapshot)
  useEffect(() => { store.connect(); return () => store.disconnect() }, [store])
  return { ...state, csv: store.csv, preview: store.report, cancel: store.cancel }
}
