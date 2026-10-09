import type { createHistoryApi, HistoryEdit, HistoryEntry } from './study-history.ts'
import { localPeriod } from './statistics.ts'
import type { StatisticsPeriod } from './statistics.ts'

type Status = 'loading' | 'ready' | 'error'
type State = {
  rows: HistoryEntry[]; status: Status; listError: string | null; hasMore: boolean; loadingMore: boolean
  period: StatisticsPeriod; statisticsRows: HistoryEntry[]; statisticsStatus: Status; statisticsError: string | null
  mutation: 'saving' | 'deleting' | null; error: string | null; notice: string
}
type Api = ReturnType<typeof createHistoryApi>
const pageSize = 25

// Shared by React and tests. Each read has its own cancellation lane.
// Confirmed AND uncertain writes re-fetch both views; no optimistic deletion.
export function createHistoryStore(api: Api, initialPeriod = localPeriod('week')) {
  let state: State = { rows: [], status: 'loading', listError: null, hasMore: false, loadingMore: false,
    period: initialPeriod, statisticsRows: [], statisticsStatus: 'loading', statisticsError: null, mutation: null, error: null, notice: '' }
  let connected = false
  const requests: { list: AbortController | null; statistics: AbortController | null; write: AbortController | null } =
    { list: null, statistics: null, write: null }
  const listeners = new Set<() => void>()
  function update(values: Partial<State>) { state = { ...state, ...values }; listeners.forEach(listener => listener()) }
  function cancel(lane: keyof typeof requests) { requests[lane]?.abort(); requests[lane] = null }

  async function loadList(more = false) {
    if (!connected || (more && (requests.list || !state.hasMore || state.status !== 'ready' || state.mutation))) return
    cancel('list')
    const controller = new AbortController()
    requests.list = controller
    const offset = more ? state.rows.length : 0
    const previous = more ? state.rows : []
    const timeout = setTimeout(() => controller.abort(), 15000)
    update(more ? { loadingMore: true, listError: null } : {
      status: 'loading', listError: null, hasMore: false, loadingMore: false,
    })
    try {
      const rows = await api.list({ limit: pageSize, offset }, controller.signal)
      if (requests.list !== controller) return
      const combined = [...previous, ...rows]
      if (new Set(combined.map(row => row.session.id)).size !== combined.length) throw new Error()
      update({ rows: combined, status: 'ready', hasMore: rows.length === pageSize })
    } catch {
      if (requests.list === controller) update({ status: more ? 'ready' : 'error',
        listError: 'Kunne ikke hente historikken. Prøv å hente den på nytt.' })
    } finally {
      clearTimeout(timeout)
      if (requests.list === controller) { requests.list = null; update({ loadingMore: false }) }
    }
  }
  async function loadStatistics() {
    if (!connected) return
    cancel('statistics')
    const controller = new AbortController()
    requests.statistics = controller
    const interval = state.period
    const timeout = setTimeout(() => controller.abort(), 30000)
    update({ statisticsRows: [], statisticsStatus: 'loading', statisticsError: null })
    try {
      const rows = await api.range(interval, controller.signal)
      if (requests.statistics === controller) update({ statisticsRows: rows, statisticsStatus: 'ready' })
    } catch {
      if (requests.statistics === controller) update({ statisticsStatus: 'error', statisticsError: 'Kunne ikke hente statistikken. Prøv igjen.' })
    } finally {
      clearTimeout(timeout)
      if (requests.statistics === controller) requests.statistics = null
    }
  }
  async function refresh() {
    if (!connected || requests.write) return
    await Promise.all([loadList(), loadStatistics()])
  }
  async function mutate(operation: (signal: AbortSignal) => Promise<unknown>, kind: 'saving' | 'deleting') {
    if (!connected || requests.write || state.mutation || state.status !== 'ready' || requests.list) return false
    cancel('list'); cancel('statistics')
    const controller = new AbortController()
    requests.write = controller
    const timeout = setTimeout(() => controller.abort(), 15000)
    update({ mutation: kind, error: null, notice: '', statisticsStatus: 'loading', statisticsRows: [] })
    let confirmed = false
    try {
      await operation(controller.signal)
      if (requests.write !== controller) return false
      confirmed = true
      update({ notice: kind === 'saving' ? 'Endringene er lagret.' : 'Økten er slettet.' })
    } catch {
      if (requests.write !== controller) return false
      update({ error: kind === 'saving'
        ? 'Kunne ikke bekrefte lagringen. Endringen kan ha blitt lagret. Kontroller oppdaterte data før du prøver igjen.'
        : 'Kunne ikke bekrefte slettingen. Økten kan ha blitt slettet. Kontroller oppdaterte data før du prøver igjen.' })
    } finally {
      clearTimeout(timeout)
      if (requests.write === controller) {
        requests.write = null
        await refresh()
        if (connected) update({ mutation: null })
      }
    }
    return confirmed
  }
  return {
    getSnapshot: () => state,
    subscribe(listener: () => void) { listeners.add(listener); return () => { listeners.delete(listener) } },
    connect() { connected = true; update({ mutation: null }); void refresh() },
    disconnect() { connected = false; cancel('list'); cancel('statistics'); cancel('write') },
    refresh, more: () => loadList(true),
    async selectPeriod(period: StatisticsPeriod) {
      if (connected && !state.mutation) {
        update({ period, statisticsRows: [], statisticsStatus: 'loading', statisticsError: null })
        await loadStatistics()
      }
    },
    edit: (sessionId: string, input: HistoryEdit) => mutate(signal => api.edit(sessionId, input, signal), 'saving'),
    remove: (sessionId: string) => mutate(signal => api.remove(sessionId, signal), 'deleting'),
  }
}
