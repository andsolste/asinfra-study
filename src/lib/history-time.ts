import type { WorkSegment } from './study-sessions.ts'

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
  const from = interval ? Date.parse(interval.from) : -Infinity
  const to = interval ? Date.parse(interval.to) : Infinity
  return segments.reduce((sum, segment) => sum + (segment.ended_at === null ? 0 : Math.max(0,
    Math.min(Date.parse(segment.ended_at), to) - Math.max(Date.parse(segment.started_at), from))), 0)
}

const pad = (value: number, width = 2) => String(value).padStart(width, '0')
export function toLocalDateTime(iso: string) {
  const date = new Date(iso)
  if (!Number.isFinite(date.getTime())) throw new Error('Ugyldig tidspunkt.')
  return `${pad(date.getFullYear(), 4)}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}.${pad(date.getMilliseconds(), 3)}`
}

export function fromLocalDateTime(value: string, original?: string) {
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2})(?:\.(\d{1,3}))?)?$/.exec(value)
  if (!match) throw new Error('Fyll inn en gyldig lokal dato og tid.')
  const [, year, month, day, hour, minute, second = '0', fraction = '0'] = match
  const parts = [+year, +month - 1, +day, +hour, +minute, +second, +fraction.padEnd(3, '0')]
  const date = new Date(0)
  date.setFullYear(parts[0], parts[1], parts[2])
  date.setHours(parts[3], parts[4], parts[5], parts[6])
  const actual = [date.getFullYear(), date.getMonth(), date.getDate(), date.getHours(), date.getMinutes(), date.getSeconds(), date.getMilliseconds()]
  if (!Number.isFinite(date.getTime()) || actual.some((part, index) => part !== parts[index])) {
    throw new Error('Tidspunktet finnes ikke i din lokale tidssone. Kontroller dato og klokkeslett.')
  }
  const normalized = toLocalDateTime(date.toISOString())
  // Preserve microseconds AND the original occurrence in a repeated DST hour.
  if (original && toLocalDateTime(original) === normalized) return original
  const offsets = new Set([-86400000, 86400000].map(delta => new Date(date.getTime() + delta).getTimezoneOffset()))
  for (const offset of offsets) {
    const alternative = new Date(date.getTime() + (offset - date.getTimezoneOffset()) * 60000)
    if (alternative.getTime() !== date.getTime() && toLocalDateTime(alternative.toISOString()) === normalized) {
      throw new Error('Klokkeslettet forekommer to ganger ved tidsomstilling. Velg et entydig tidspunkt.')
    }
  }
  return date.toISOString()
}
