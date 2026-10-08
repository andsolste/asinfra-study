import type { SupabaseClient } from '@supabase/supabase-js'
import { mapSessionRecord } from './study-sessions.ts'
import type { SessionRecord, StudySession, WorkSegment } from './study-sessions.ts'
import type { Subject } from './subjects.ts'
import { fromLocalDateTime, toLocalDateTime, workMilliseconds } from './history-time.ts'
import type { TimeInterval } from './history-time.ts'

export type HistoryEntry = Omit<SessionRecord, 'session' | 'segments'> & {
  session: StudySession & { ended_at: string }
  segments: (WorkSegment & { ended_at: string })[]
}
export type HistoryEdit = {
  subjectId: string | null; description: string; startedAt: string; endedAt: string
  segments: { started_at: string; ended_at: string }[]
}
export type HistoryDraft = {
  subjectId: string; description: string; start: string; end: string
  originalStart: string; originalEnd: string
  segments: { key: string; start: string; end: string; originalStart?: string; originalEnd?: string }[]
}
export type HistoryQuery = { interval?: TimeInterval; limit?: number; offset?: number }

export function mapHistoryEntry(value: unknown): HistoryEntry {
  const row = mapSessionRecord(value)
  if (row.session.ended_at === null || row.segments.some(segment => segment.ended_at === null)) {
    throw new Error('Historikken inneholder en uavsluttet økt eller arbeidsperiode.')
  }
  if (row.session.subject_id !== null && row.subject === null) throw new Error('Ugyldig fagkobling.')
  return row as HistoryEntry
}

export function mapHistoryPage(value: unknown) {
  if (!Array.isArray(value)) throw new Error('Ugyldige historikkdata.')
  const entries = value.map(mapHistoryEntry)
  if (new Set(entries.map(entry => entry.session.id)).size !== entries.length) throw new Error('Dupliserte økter.')
  return entries
}

export function createHistoryDraft(entry: HistoryEntry): HistoryDraft {
  return {
    subjectId: entry.session.subject_id ?? '', description: entry.session.description,
    start: toLocalDateTime(entry.session.started_at), end: toLocalDateTime(entry.session.ended_at),
    originalStart: entry.session.started_at, originalEnd: entry.session.ended_at,
    segments: entry.segments.map(segment => ({ key: segment.id,
      start: toLocalDateTime(segment.started_at), end: toLocalDateTime(segment.ended_at),
      originalStart: segment.started_at, originalEnd: segment.ended_at })),
  }
}
export function addDraftSegment(draft: HistoryDraft): HistoryDraft {
  return { ...draft, segments: [...draft.segments, { key: crypto.randomUUID(), start: '', end: '' }] }
}
export function removeDraftSegment(draft: HistoryDraft, key: string): HistoryDraft {
  return { ...draft, segments: draft.segments.filter(segment => segment.key !== key) }
}
export function prepareHistoryEdit(draft: HistoryDraft, subjects: Subject[]): HistoryEdit {
  const description = draft.description.trim()
  if (Array.from(description).length > 500) throw new Error('Beskrivelsen kan ha maks 500 tegn.')
  if (draft.subjectId && !subjects.some(subject => subject.id === draft.subjectId)) throw new Error('Velg et av dine egne fag.')
  const startedAt = fromLocalDateTime(draft.start, draft.originalStart)
  const endedAt = fromLocalDateTime(draft.end, draft.originalEnd)
  if (Date.parse(endedAt) < Date.parse(startedAt)) throw new Error('Økten kan ikke slutte før den starter.')
  let previousEnd = Date.parse(startedAt)
  const segments = draft.segments.map((segment, index) => {
    let start: string, end: string
    try {
      start = fromLocalDateTime(segment.start, segment.originalStart)
      end = fromLocalDateTime(segment.end, segment.originalEnd)
    } catch (error) { throw new Error(`Arbeidsperiode ${index + 1}: ${error instanceof Error ? error.message : 'Kontroller tidspunktene.'}`) }
    if (Date.parse(end) < Date.parse(start)) throw new Error(`Arbeidsperiode ${index + 1} slutter før den starter.`)
    if (Date.parse(start) < Date.parse(startedAt) || Date.parse(end) > Date.parse(endedAt)) {
      throw new Error(`Arbeidsperiode ${index + 1} må ligge innenfor øktens start og slutt.`)
    }
    if (Date.parse(start) < previousEnd) throw new Error('Arbeidsperiodene må stå i kronologisk rekkefølge og ikke overlappe.')
    previousEnd = Date.parse(end)
    return { started_at: start, ended_at: end }
  })
  return { subjectId: draft.subjectId || null, description, startedAt, endedAt, segments }
}

export function summarizeWeek(entries: HistoryEntry[], interval: TimeInterval) {
  const subjects = new Map<string, { id: string | null; name: string; code: string | null; work: number }>()
  let total = 0
  for (const entry of entries) {
    const work = workMilliseconds(entry.segments, interval)
    if (!work) continue
    const key = entry.session.subject_id ?? ''
    const subject = subjects.get(key) ?? { id: entry.session.subject_id, name: entry.subject?.name ?? 'Uten fag',
      code: entry.subject?.code ?? null, work: 0 }
    subject.work += work; total += work; subjects.set(key, subject)
  }
  return { total, subjects: [...subjects.values()].sort((a, b) => b.work - a.work || a.name.localeCompare(b.name)) }
}

export function createHistoryApi(client: Pick<SupabaseClient, 'rpc'>) {
  const api = {
    async list(query: HistoryQuery, signal: AbortSignal): Promise<HistoryEntry[]> {
      const { interval, limit = 25, offset = 0 } = query
      if (!Number.isInteger(limit) || limit < 1 || limit > 200 || !Number.isInteger(offset) || offset < 0) {
        throw new Error('Ugyldig paginering.')
      }
      if (interval && (!/(Z|[+-]\d{2}:\d{2})$/.test(interval.from) || !/(Z|[+-]\d{2}:\d{2})$/.test(interval.to)
        || !Number.isFinite(Date.parse(interval.from)) || !Number.isFinite(Date.parse(interval.to))
        || Date.parse(interval.to) <= Date.parse(interval.from))) throw new Error('Ugyldig tidsintervall.')
      try {
        signal.throwIfAborted()
        const { data, error } = await client.rpc('study_session_history', {
          p_from: interval?.from ?? null, p_to: interval?.to ?? null, p_limit: limit, p_offset: offset,
        }).abortSignal(signal)
        signal.throwIfAborted()
        if (error) throw new Error()
        const rows = mapHistoryPage(data)
        if (rows.length > limit) throw new Error()
        return rows
      } catch { throw new Error('Kunne ikke hente historikken.') }
    },
    async week(interval: TimeInterval, signal: AbortSignal) {
      const result: HistoryEntry[] = []
      const seen = new Set<string>()
      for (let offset = 0; ; offset += 200) {
        const rows = await api.list({ interval, limit: 200, offset }, signal)
        for (const row of rows) {
          if (seen.has(row.session.id)) throw new Error('Historikken endret seg under henting. Prøv igjen.')
          seen.add(row.session.id); result.push(row)
        }
        if (rows.length < 200) return result
      }
    },
    async edit(sessionId: string, input: HistoryEdit, signal: AbortSignal) {
      try {
        signal.throwIfAborted()
        const { data, error } = await client.rpc('study_session_history_edit', {
          p_session_id: sessionId, p_subject_id: input.subjectId, p_description: input.description,
          p_started_at: input.startedAt, p_ended_at: input.endedAt,
          p_segments: input.segments.map(segment => ({ started_at: segment.started_at, ended_at: segment.ended_at })),
        }).abortSignal(signal)
        signal.throwIfAborted()
        if (error) throw new Error()
        const row = mapHistoryEntry(data)
        if (row.session.id !== sessionId) throw new Error()
        return row
      } catch { throw new Error('Kunne ikke bekrefte lagringen.') }
    },
    async remove(sessionId: string, signal: AbortSignal) {
      try {
        signal.throwIfAborted()
        const { data, error } = await client.rpc('study_session_history_delete', { p_session_id: sessionId }).abortSignal(signal)
        signal.throwIfAborted()
        if (error || data !== sessionId) throw new Error()
      } catch { throw new Error('Kunne ikke bekrefte slettingen.') }
    },
  }
  return api
}
