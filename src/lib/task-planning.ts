import type { FlowTask, TaskPriority } from '../types/flow.ts'
import type { TaskCommand } from './flow-tasks.ts'

export const priorityLabels: Record<TaskPriority, string> = { high: 'Høy', normal: 'Normal', low: 'Lav' }
const priorityOrder = { high: 0, normal: 1, low: 2 }
const day = 86400000

function calendarDate(value: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) throw new Error('Velg en gyldig uke.')
  const date = new Date(value + 'T00:00:00Z')
  if (!Number.isFinite(date.getTime()) || date.toISOString().slice(0, 10) !== value || date.getUTCFullYear() < 1) throw new Error('Velg en gyldig uke.')
  return date
}
const isoDate = (date: Date) => date.toISOString().slice(0, 10)
export function weekStartForDate(value: string) {
  const date = calendarDate(value)
  date.setUTCDate(date.getUTCDate() - (date.getUTCDay() + 6) % 7)
  return isoDate(date)
}
export function validWeekStart(value: unknown): value is string {
  try { return typeof value === 'string' && weekStartForDate(value) === value } catch { return false }
}
export function weekInput(start: string) {
  const date = calendarDate(start)
  date.setUTCDate(date.getUTCDate() + 3) // Thursday decides the ISO week-year.
  const year = date.getUTCFullYear()
  const first = weekStartForDate(`${String(year).padStart(4, '0')}-01-04`)
  const number = 1 + Math.round((calendarDate(start).getTime() - calendarDate(first).getTime()) / (7 * day))
  return `${String(year).padStart(4, '0')}-W${String(number).padStart(2, '0')}`
}
export function weekStartFromInput(input: string): string | null {
  if (!input) return null
  const match = /^(\d{4})-W(\d{2})$/.exec(input)
  if (!match || +match[1] < 1 || +match[2] < 1 || +match[2] > 53) throw new Error('Velg en gyldig ISO-uke, for eksempel 2026-W45.')
  const first = calendarDate(weekStartForDate(`${match[1]}-01-04`))
  first.setUTCDate(first.getUTCDate() + (+match[2] - 1) * 7)
  const start = isoDate(first)
  if (!validWeekStart(start) || weekInput(start) !== input) throw new Error('Denne ISO-uken finnes ikke i det valgte året.')
  return start
}
export function currentWeek(now: number): string | null {
  if (!Number.isFinite(now) || now <= 0) return null
  const date = new Date(now)
  // Planning follows the browser's calendar week, not the timer's frozen 04:00 day.
  return weekStartForDate(`${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`)
}
export function shiftWeek(start: string, amount: number) {
  const date = calendarDate(start)
  date.setUTCDate(date.getUTCDate() + amount * 7)
  const result = isoDate(date)
  if (!validWeekStart(result)) throw new Error('Uken er utenfor støttet datointervall.')
  return result
}
export function weekLabel(start: string) {
  const [year, number] = weekInput(start).split('-W')
  return `Uke ${Number(number)} · ${year}`
}
export function weekRange(start: string) {
  const end = calendarDate(start); end.setUTCDate(end.getUTCDate() + 6)
  const format = (date: Date) => date.toLocaleDateString('nb-NO', { day: 'numeric', month: 'short', timeZone: 'UTC' })
  return `${format(calendarDate(start))}–${format(end)}`
}
export function planningFields(input: string, priority: string) {
  if (!Object.hasOwn(priorityLabels, priority)) throw new Error('Velg høy, normal eller lav prioritet.')
  return { weekStart: weekStartFromInput(input), priority: priority as TaskPriority }
}
export function weeklyTasks(tasks: readonly FlowTask[], start: string) {
  const sort = (a: FlowTask, b: FlowTask) => priorityOrder[a.priority ?? 'normal'] - priorityOrder[b.priority ?? 'normal']
    || a.created_at.localeCompare(b.created_at) || a.id.localeCompare(b.id)
  const selected = tasks.filter(task => task.week_start === start).sort(sort)
  const previous = tasks.filter(task => task.week_start && task.week_start < start && task.status === 'active')
    .sort((a, b) => a.week_start!.localeCompare(b.week_start!) || sort(a, b))
  return { tasks: selected, previous, total: selected.length, completed: selected.filter(task => task.status === 'completed').length }
}
export function moveToWeek(task: FlowTask, start: string): TaskCommand {
  if (!validWeekStart(start)) throw new Error('Velg en gyldig uke.')
  return { kind: 'save-task', taskId: task.id, expected: task.updated_at, title: task.title, description: task.description,
    areaId: task.area_id, deadline: task.deadline_at, weekStart: start, priority: task.priority }
}
