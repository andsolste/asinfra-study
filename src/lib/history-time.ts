import type { WorkSegment } from './study-sessions.ts'
import { timestampMicroseconds, durationMilliseconds, segmentMicroseconds } from './time-precision.ts'

export type TimeInterval = { from: string; to: string }

// Calendar arithmetic (not seven 24-hour days) preserves local midnight across DST.
export function localWeek(date = new Date()): TimeInterval {
  const start = new Date(date)
  start.setHours(0, 0, 0, 0)
  start.setDate(start.getDate() - (start.getDay() + 6) % 7)
  const end = new Date(start)
  end.setDate(end.getDate() + 7)
  return { from: start.toISOString(), to: end.toISOString() }
}

export function shiftWeek(week: TimeInterval, direction: -1 | 1) {
  const date = new Date(week.from)
  date.setDate(date.getDate() + direction * 7)
  return localWeek(date)
}

export function weekLabel(week: TimeInterval) {
  const format = (date: Date) => date.toLocaleDateString('nb-NO', { day: 'numeric', month: 'long', year: 'numeric' })
  return format(new Date(week.from)) + ' – ' + format(new Date(Date.parse(week.to) - 1))
}

export function workMilliseconds(segments: WorkSegment[], interval?: TimeInterval) {
  return durationMilliseconds(workMicroseconds(segments, interval))
}
export function workMicroseconds(segments: WorkSegment[], interval?: TimeInterval): bigint {
  const from = interval ? timestampMicroseconds(interval.from) : undefined
  const to = interval ? timestampMicroseconds(interval.to) : undefined
  return segments.reduce((sum, segment) => sum + (segment.ended_at === null ? 0n
    : segmentMicroseconds(segment, to ?? timestampMicroseconds(segment.ended_at), from)), 0n)
}

const pad = (value: number, width = 2) => String(value).padStart(width, '0')
export function toLocalDateTime(iso: string) {
  const date = new Date(iso)
  if (!Number.isFinite(date.getTime())) throw new Error('Ugyldig tidspunkt.')
  return `${pad(date.getFullYear(), 4)}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`
}

export function fromLocalDateTime(value: string, original?: string) {
  // Native inputs may omit :00. New values use whole seconds, never fractions.
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2}))?$/.exec(value)
  if (!match) throw new Error('Fyll inn en gyldig lokal dato og tid.')
  const [, year, month, day, hour, minute, second = '0'] = match
  const parts = [+year, +month - 1, +day, +hour, +minute, +second, 0]
  const date = new Date(0)
  date.setFullYear(parts[0], parts[1], parts[2])
  date.setHours(parts[3], parts[4], parts[5], parts[6])
  const actual = [date.getFullYear(), date.getMonth(), date.getDate(), date.getHours(), date.getMinutes(), date.getSeconds(), date.getMilliseconds()]
  if (!Number.isFinite(date.getTime()) || actual.some((part, index) => part !== parts[index])) {
    throw new Error('Tidspunktet finnes ikke i din lokale tidssone. Kontroller dato og klokkeslett.')
  }
  const normalized = toLocalDateTime(date.toISOString())
  // Compare only the precision actually shown by the editor. An untouched
  // minute field must retain its original seconds/microseconds AND DST occurrence.
  if (original && (match[6] === undefined ? toLocalDateTime(original).slice(0, 16) === value
    : toLocalDateTime(original) === normalized)) return original
  const offsets = new Set([-86400000, 86400000].map(delta => new Date(date.getTime() + delta).getTimezoneOffset()))
  for (const offset of offsets) {
    const alternative = new Date(date.getTime() + (offset - date.getTimezoneOffset()) * 60000)
    if (alternative.getTime() !== date.getTime() && toLocalDateTime(alternative.toISOString()) === normalized) {
      throw new Error('Klokkeslettet forekommer to ganger ved tidsomstilling. Velg et entydig tidspunkt.')
    }
  }
  return date.toISOString()
}
