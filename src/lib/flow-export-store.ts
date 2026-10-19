import type { createExportApi, CsvFile } from './flow-export.ts'
import { csvHeader, csvRow, exportFilename } from './flow-export.ts'
import type { createStatisticsApi, FlowPeriod, FlowStatistics } from './flow-statistics.ts'

type State = { phase: 'idle' | 'csv' | 'report' | 'ready' | 'error'; count: number; total: number | null; error: string | null; notice: string; report: FlowStatistics | null; resolvedPeriod: FlowPeriod | null }
type Api = ReturnType<typeof createExportApi> & Pick<ReturnType<typeof createStatisticsApi>, 'statistics'>
export function createExportStore(api: Api, save: (file: CsvFile) => void) {
  let state: State = { phase: 'idle', count: 0, total: null, error: null, notice: '', report: null, resolvedPeriod: null }
  let connected = false, request: AbortController | null = null
  const listeners = new Set<() => void>()
  const update = (values: Partial<State>) => { state = { ...state, ...values }; listeners.forEach(fn => fn()) }
  function cancel() { request?.abort(); request = null; update({ phase: 'idle', report: null, resolvedPeriod: null, notice: '', error: null, count: 0, total: null }) }
  async function run(kind: 'csv' | 'report', period: FlowPeriod, zone: string | null) {
    if (!connected) return
    cancel(); const controller = new AbortController(); request = controller
    update({ phase: kind })
    let job: string | null = null
    const current = () => connected && request === controller && !controller.signal.aborted
    async function timed<T>(read: () => Promise<T>) {
      const timeout = setTimeout(() => controller.abort(), 30000)
      try { return await read() } finally { clearTimeout(timeout) }
    }
    try {
      if (kind === 'report') {
        const report = await timed(() => api.statistics(period, zone, controller.signal))
        if (!current()) return
        if (report.legacy_timezone_error) throw new Error('Velg en gyldig visningstidssone før rapporten genereres. Ingen delvis rapport vises.')
        update({ phase: 'ready', report, resolvedPeriod: report.period })
      } else {
        let page = await timed(() => api.start(period, zone, controller.signal)); job = page.job_id
        if (!current()) return
        const first = page, parts = [csvHeader], seen = new Set<string>()
        update({ resolvedPeriod: first.period })
        let count = 0, microseconds = 0n
        while (true) {
          if (!current()) return
          if (page.job_id !== first.job_id || page.server_time !== first.server_time || page.total_rows !== first.total_rows
            || JSON.stringify(page.period) !== JSON.stringify(first.period)) throw new Error('Eksportgrunnlaget endret seg. Start på nytt.')
          for (const row of page.rows) {
            const key = `${row.source}:${row.segment_id}:${row.flow_date}`
            if (seen.has(key) || row.ordinal !== count + 1) throw new Error('Ufullstendig eksport. Start på nytt.')
            seen.add(key); count++; microseconds += BigInt(row.work_microseconds); parts.push(csvRow(row))
          }
          update({ count, total: first.total_rows })
          if (!page.next_cursor) break
          if (!page.rows.length || page.next_cursor.after !== count || count >= first.total_rows) throw new Error('Ugyldig eksportmarkør. Start på nytt.')
          const cursor = page.next_cursor
          page = await timed(() => api.page(cursor, controller.signal))
        }
        if (count !== first.total_rows || !first.statistics || Math.abs(Number(microseconds) / 1000 - first.statistics.total) > Math.max(.01, first.statistics.total * 1e-12)) {
          throw new Error('CSV og statistikk stemmer ikke. Ingen fil er lastet ned.')
        }
        if (!current()) return
        save({ content: parts.join(''), filename: exportFilename(first.period), count })
        update({ phase: 'ready', notice: `CSV er klar: ${count} arbeidsrader.`, count, total: count })
      }
    } catch (error) {
      if (connected && request === controller) update({ phase: 'error', report: null, error: controller.signal.aborted
        ? 'Eksporten tok for lang tid. Prøv igjen. Ingen delvis fil er lastet ned.' : error instanceof Error ? error.message : 'Eksporten feilet. Prøv igjen.' })
    } finally {
      if (request === controller) request = null
      if (job) void api.discard(job)
    }
  }
  return {
    subscribe(fn: () => void) { listeners.add(fn); return () => { listeners.delete(fn) } }, getSnapshot: () => state,
    connect() { connected = true }, disconnect() { connected = false; cancel() }, cancel,
    csv: (period: FlowPeriod, zone: string | null) => run('csv', period, zone),
    report: (period: FlowPeriod, zone: string | null) => run('report', period, zone),
  }
}
