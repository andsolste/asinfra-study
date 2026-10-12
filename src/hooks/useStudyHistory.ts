import { useEffect, useState, useSyncExternalStore } from 'react'
import { supabase } from '../lib/supabase'
import { createHistoryApi } from '../lib/study-history'
import { createHistoryStore } from '../lib/history-store'

export function useStudyHistory() {
  const [store] = useState(() => createHistoryStore(createHistoryApi(supabase!)))
  const state = useSyncExternalStore(store.subscribe, store.getSnapshot)
  useEffect(() => { store.connect(); return () => store.disconnect() }, [store])
  return { ...state, reload: store.refresh, more: store.more, selectPeriod: store.selectPeriod, edit: store.edit, remove: store.remove }
}
