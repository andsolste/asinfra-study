import type { FlowSnapshot, FlowCatalog } from './flow-work.ts'
import type { FlowWorkSegment } from '../types/flow.ts'
import { timestampMicroseconds as micros, durationMilliseconds } from './time-precision.ts'

export type NativeValues = Pick<FlowWorkSegment, 'started_at' | 'ended_at' | 'area_id' | 'task_id'>
export type NativeSegmentCorrection = { dayId: string; segmentId: string; expected: NativeValues; desired: NativeValues & { ended_at: string } }
export const nativeValues = (s: NativeValues): NativeValues => ({ started_at: s.started_at, ended_at: s.ended_at, area_id: s.area_id, task_id: s.task_id })
export function sameNativeValues(a: NativeValues, b: NativeValues) {
  return micros(a.started_at) === micros(b.started_at) &&
    (a.ended_at === null ? b.ended_at === null : b.ended_at !== null && micros(a.ended_at) === micros(b.ended_at)) &&
    a.area_id === b.area_id && a.task_id === b.task_id
}
export function correctionMatches(snapshot: FlowSnapshot | null, input: NativeSegmentCorrection) {
  const segment = snapshot?.segments.find(s => s.id === input.segmentId)
  return Boolean(segment && snapshot?.work_day.id === input.dayId && sameNativeValues(segment, input.desired))
}
export function interruptedPeriod(snapshot: FlowSnapshot | null | undefined, notice: { dayId: string; segmentId: string; count: number } | null) {
  if (!snapshot || !notice || snapshot.work_day.ended_at || snapshot.work_day.id !== notice.dayId || snapshot.segments.length !== notice.count) return null
  return snapshot.segments.find(s => s.id === notice.segmentId && s.ended_at === null) ?? null
}

// Explicit IANA-zone conversion, independent of the browser's current timezone.
// Preserve the original absolute instant BEFORE resolving a newly chosen minute.
const formats = new Map<string, Intl.DateTimeFormat>()
function parts(at: number, zone: string) {
  let format = formats.get(zone)
  if (!format) {
    try { format = new Intl.DateTimeFormat('en-CA-u-ca-gregory-nu-latn', { timeZone: zone, hourCycle: 'h23',
      year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' }) }
    catch { throw new Error('Arbeidsdagens lagrede tidssone kan ikke brukes.') }
    formats.set(zone, format)
  }
  return Object.fromEntries(format.formatToParts(at).filter(p => p.type !== 'literal').map(p => [p.type, p.value]))
}
export function nativeLocalMinute(iso: string, zone: string) {
  const p = parts(Date.parse(iso), zone)
  return `${p.year.padStart(4, '0')}-${p.month}-${p.day}T${p.hour}:${p.minute}`
}
function utc(year: number, month: number, day: number, hour: number, minute: number, second = 0) {
  const date = new Date(0); date.setUTCFullYear(year, month - 1, day); date.setUTCHours(hour, minute, second, 0)
  return date.getTime()
}
export function nativeMinuteInstant(value: string, zone: string, original?: string | null) {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(value)) throw new Error('Fyll inn dato og klokkeslett med hele minutter.')
  if (original && nativeLocalMinute(original, zone) === value) return original
  const [year, month, day, hour, minute] = value.split(/[-T:]/).map(Number)
  const naive = utc(year, month, day, hour, minute)
  if (year < 1 || year > 9998 || new Date(naive).toISOString().slice(0, 16) !== value) throw new Error('Ugyldig dato eller klokkeslett.')
  const offsets = new Set<number>()
  for (let hours = -36; hours <= 36; hours++) {
    const at = naive + hours * 3600000, p = parts(at, zone)
    offsets.add(utc(+p.year, +p.month, +p.day, +p.hour, +p.minute, +p.second) - at)
  }
  const candidates = [...offsets].map(offset => naive - offset).filter(at => nativeLocalMinute(new Date(at).toISOString(), zone) === value)
  if (!candidates.length) throw new Error('Klokkeslettet finnes ikke i arbeidsdagens tidssone ved tidsomstilling.')
  if (candidates.length > 1) throw new Error('Klokkeslettet forekommer to ganger ved tidsomstilling. Velg et entydig tidspunkt; urørte felt beholder riktig forekomst.')
  return new Date(candidates[0]).toISOString()
}
export type NativeDraft = { from: string; to: string; area: string; task: string }
export function nativeDraft(snapshot: FlowSnapshot, segment: FlowWorkSegment): NativeDraft {
  return { from: nativeLocalMinute(segment.started_at, snapshot.work_day.timezone),
    to: segment.ended_at ? nativeLocalMinute(segment.ended_at, snapshot.work_day.timezone) : '',
    area: segment.area_id ?? '', task: segment.task_id ?? '' }
}
export function buildNativeCorrection(snapshot: FlowSnapshot, segment: FlowWorkSegment, draft: NativeDraft, now: number, catalog: FlowCatalog): NativeSegmentCorrection {
  const zone = snapshot.work_day.timezone
  const desired = { started_at: nativeMinuteInstant(draft.from, zone, segment.started_at),
    ended_at: nativeMinuteInstant(draft.to, zone, segment.ended_at), area_id: draft.area || null, task_id: draft.task || null }
  const from = micros(desired.started_at), to = micros(desired.ended_at), day = snapshot.work_day
  if (from < micros(day.started_at) || from >= micros(day.cutoff_at) || to < from || to > micros(day.ended_at ?? day.cutoff_at)) {
    throw new Error('Perioden må ligge innenfor arbeidsdagen, med Til lik eller etter Fra.')
  }
  if (Date.parse(desired.ended_at) > now) throw new Error('Sluttid kan ikke være i fremtiden.')
  if (to > from && snapshot.segments.some(s => s.id !== segment.id &&
    (s.ended_at === null || micros(s.ended_at) > micros(s.started_at)) && from < micros(s.ended_at ?? day.cutoff_at) && to > micros(s.started_at))) {
    throw new Error('Perioden overlapper en annen arbeidsperiode.')
  }
  if ((desired.area_id !== segment.area_id || desired.task_id !== segment.task_id) && desired.task_id !== null &&
    !catalog.tasks.some(t => t.id === desired.task_id && t.area_id === desired.area_id)) throw new Error('Oppgaven må tilhøre valgt område.')
  return { dayId: day.id, segmentId: segment.id, expected: nativeValues(segment), desired }
}
export const nativeCorrectionWork = (input: NativeSegmentCorrection) => durationMilliseconds(micros(input.desired.ended_at) - micros(input.desired.started_at))
