import type { createFlowHistoryApi, AttributionEdit, FlowHistoryEntry, HistoryCursor } from './flow-history.ts'
import type { HistoryEdit } from './study-history.ts'
import type { createStatisticsApi, FlowPeriod, FlowStatistics, AreaStatistics } from './flow-statistics.ts'
import { browserTimezone } from './flow-work.ts'

type Status = 'loading' | 'ready' | 'error'
type State = {
  rows: FlowHistoryEntry[]; status: Status; listError: string | null; cursor: HistoryCursor | null; loadingMore: boolean
  period: FlowPeriod; timezone: string | null; statistics: FlowStatistics | null; statisticsStatus: Status; statisticsError: string | null
  selectedArea: { id: string | null } | null; area: AreaStatistics | null; areaStatus: Status; areaError: string | null
  mutation: 'saving' | 'deleting' | null; error: string | null; notice: string
}
type Api = ReturnType<typeof createFlowHistoryApi> & ReturnType<typeof createStatisticsApi>
type Lane = 'list' | 'statistics' | 'area' | 'write'
// Independent read lanes: changing a chart must never reorder history or let a
// late response replace a newer selection. Writes reconcile all affected views.
export function createFlowHistoryStore(api: Api, timezone: string | null = browserTimezone()) {
  let state: State = { rows: [], status: 'loading', listError: null, cursor: null, loadingMore: false,
    period: { kind: 'week', anchor: null }, timezone, statistics: null, statisticsStatus: 'loading', statisticsError: null,
    selectedArea: null, area: null, areaStatus: 'loading', areaError: null, mutation: null, error: null, notice: '' }
  let connected = false
  const requests: Record<Lane, AbortController | null> = { list: null, statistics: null, area: null, write: null }
  const listeners = new Set<() => void>()
  let anchor: { server: number; received: number } | null = null
  const update = (values: Partial<State>) => { state = { ...state, ...values }; listeners.forEach(fn => fn()) }
  function cancel(lane: Lane) { requests[lane]?.abort(); requests[lane] = null }
  function start(lane: Lane) { cancel(lane); const controller = new AbortController(); requests[lane] = controller; return controller }
  function syncClock(time: string) { anchor = { server: Date.parse(time), received: performance.now() } }
  async function list(more = false) {
    if (!connected || more && (requests.list || state.status !== 'ready' || !state.cursor || state.mutation)) return
    const controller = start('list'), cursor = more ? state.cursor : null, previous = more ? state.rows : []
    const timeout = setTimeout(() => controller.abort(), 15000)
    update(more ? { loadingMore: true, listError: null } : { status: 'loading', listError: null, cursor: null, loadingMore: false })
    try {
      const page = await api.list(cursor, controller.signal)
      if (requests.list !== controller) return
      const rows = [...previous, ...page.rows]
      if (new Set(rows.map(r => r.key)).size !== rows.length || previous.length && page.rows.some(r => Date.parse(r.started_at) > Date.parse(previous.at(-1)!.started_at))) throw new Error()
      syncClock(page.server_time); update({ rows, cursor: page.next_cursor, status: 'ready' })
    } catch {
      if (requests.list === controller) update({ status: more ? 'ready' : 'error', listError: 'Kunne ikke hente historikken. Hent på nytt for oppdatert rekkefølge.' })
    } finally { clearTimeout(timeout); if (requests.list === controller) { requests.list = null; update({ loadingMore: false }) } }
  }
  async function statistics() {
    if (!connected) return
    const controller = start('statistics'), period = state.period, zone = state.timezone
    const timeout = setTimeout(() => controller.abort(), 30000)
    update({ statistics: null, statisticsStatus: 'loading', statisticsError: null })
    try {
      const result = await api.statistics(period, zone, controller.signal)
      if (requests.statistics === controller) {
        syncClock(result.server_time)
        update({ statistics: result, period: { kind: result.period.kind, anchor: result.period.anchor }, statisticsStatus: 'ready' })
      }
    } catch (error) {
      if (requests.statistics === controller) update({ statisticsStatus: 'error', statisticsError: error instanceof Error ? error.message : 'Kunne ikke hente statistikken.' })
    } finally { clearTimeout(timeout); if (requests.statistics === controller) requests.statistics = null }
  }
  async function area() {
    if (!connected || !state.selectedArea) return
    const controller = start('area'), id = state.selectedArea.id, zone = state.timezone
    const timeout = setTimeout(() => controller.abort(), 30000)
    update({ area: null, areaStatus: 'loading', areaError: null })
    try {
      const result = await api.area(id, zone, controller.signal)
      if (requests.area === controller) { syncClock(result.total.server_time); update({ area: result, areaStatus: 'ready' }) }
    } catch {
      if (requests.area === controller) update({ areaStatus: 'error', areaError: 'Kunne ikke hente området. Kontroller visningstidssonen og prøv igjen.' })
    } finally { clearTimeout(timeout); if (requests.area === controller) requests.area = null }
  }
  async function refresh() { if (connected && !requests.write) await Promise.all([list(), statistics(), area()]) }
  async function mutate(operation: (signal: AbortSignal) => Promise<unknown>, kind: 'saving' | 'deleting') {
    if (!connected || requests.write || state.mutation || state.status !== 'ready' || requests.list) return false
    cancel('list'); cancel('statistics'); cancel('area')
    const controller = start('write'), timeout = setTimeout(() => controller.abort(), 15000)
    update({ mutation: kind, error: null, notice: '', statistics: null, statisticsStatus: 'loading', area: null })
    let confirmed = false
    try {
      await operation(controller.signal)
      if (requests.write !== controller) return false
      confirmed = true; update({ notice: kind === 'saving' ? 'Endringene er lagret.' : 'Den eldre registreringen er slettet.' })
    } catch {
      if (requests.write !== controller) return false
      update({ error: 'Handlingen kunne ikke bekreftes. Kontroller oppdaterte data før du prøver igjen. Korrigert arbeid må ikke overlappe andre registreringer.' })
    } finally {
      clearTimeout(timeout)
      if (requests.write === controller) { requests.write = null; await refresh(); if (connected) update({ mutation: null }) }
    }
    return confirmed
  }
  return {
    subscribe(fn: () => void) { listeners.add(fn); return () => { listeners.delete(fn) } }, getSnapshot: () => state,
    now: () => anchor ? anchor.server + Math.max(0, performance.now() - anchor.received) : Date.now(),
    connect() { connected = true; update({ mutation: null }); void refresh() },
    disconnect() { connected = false; (Object.keys(requests) as Lane[]).forEach(cancel) },
    refresh, more: () => list(true),
    async selectPeriod(period: FlowPeriod) { if (connected && !state.mutation) { update({ period }); await statistics() } },
    async selectArea(id: string | null | undefined) { if (connected && !state.mutation) { cancel('area'); update({ selectedArea: id === undefined ? null : { id }, area: null, areaError: null }); if (id !== undefined) await area() } },
    async setTimezone(zone: string | null) { if (connected && !state.mutation) { update({ timezone: zone }); await Promise.all([statistics(), area()]) } },
    editLegacy: (id: string, input: HistoryEdit) => mutate(signal => api.editLegacy(id, input, signal), 'saving'),
    removeLegacy: (id: string) => mutate(signal => api.removeLegacy(id, signal), 'deleting'),
    attribute: (input: AttributionEdit) => mutate(signal => api.attribute(input, signal), 'saving'),
  }
}
