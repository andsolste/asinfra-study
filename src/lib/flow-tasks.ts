import type { SupabaseClient } from '@supabase/supabase-js'
import type { FlowTask } from '../types/flow.ts'
import { fromLocalDateTime } from './history-time.ts'
import { mapFlowTask } from './flow-work.ts'
import type { FlowSnapshot } from './flow-work.ts'

export type TaskFields = { title: string; description: string; areaId: string | null; deadline: string | null }
export type TaskCommand =
  | ({ kind: 'save-task'; taskId: string; expected: string | null } & TaskFields)
  | { kind: 'status-task'; taskId: string; expected: string; status: 'active' | 'completed' }
export type TaskTime = { task_id: string; work_milliseconds: number; server_time: string }
export class TaskActionError extends Error {
  constructor(message: string) { super(message) }
}
export function taskFields(title: string, description: string, areaId: string, localDeadline: string, original?: string): TaskFields {
  const trimmed = title.trim()
  if (!trimmed || Array.from(trimmed).length > 200) throw new Error('Tittel må ha 1–200 tegn.')
  if (Array.from(description).length > 2000) throw new Error('Beskrivelsen kan ha høyst 2000 tegn.')
  return { title: trimmed, description, areaId: areaId || null, deadline: localDeadline ? fromLocalDateTime(localDeadline, original) : null }
}
export function taskQueue(tasks: readonly FlowTask[], now: number) {
  const group = (task: FlowTask) => task.deadline_at === null ? 2 : Date.parse(task.deadline_at) < now ? 0 : 1
  return tasks.filter(t => t.status === 'active').sort((a, b) => group(a) - group(b)
    || (a.deadline_at && b.deadline_at ? Date.parse(a.deadline_at) - Date.parse(b.deadline_at) : 0)
    || Date.parse(a.created_at) - Date.parse(b.created_at) || a.id.localeCompare(b.id))
}
export function deadlineLabel(task: FlowTask, now: number) {
  if (!task.deadline_at) return 'Ingen frist'
  const date = new Date(task.deadline_at), overdue = now - date.getTime()
  if (task.status === 'active' && overdue > 0) {
    const days = Math.floor(overdue / 86400000), hours = Math.floor(overdue / 3600000)
    return days ? `Forfalt med ${days} ${days === 1 ? 'dag' : 'dager'}` : hours ? `Forfalt med ${hours} t` : 'Forfalt med under 1 t'
  }
  const today = new Date(now), tomorrow = new Date(now)
  tomorrow.setDate(tomorrow.getDate() + 1)
  const sameDate = (d: Date) => d.getFullYear() === date.getFullYear() && d.getMonth() === date.getMonth() && d.getDate() === date.getDate()
  const clock = date.toLocaleTimeString('nb-NO', { hour: '2-digit', minute: '2-digit' })
  return sameDate(today) ? `Frist i dag ${clock}` : sameDate(tomorrow) ? `Frist i morgen ${clock}`
    : `Frist ${date.toLocaleDateString('nb-NO', { day: 'numeric', month: 'short', year: 'numeric' })} ${clock}`
}
export function taskDayTime(snapshot: FlowSnapshot | null, taskId: string, now: number) {
  if (!snapshot) return { work: 0, current: 0 }
  const end = Math.min(now, Date.parse(snapshot.work_day.cutoff_at), snapshot.work_day.ended_at ? Date.parse(snapshot.work_day.ended_at) : Infinity)
  let work = 0, current = 0
  for (const s of snapshot.segments.filter(s => s.task_id === taskId)) {
    const duration = Math.max(0, Math.min(end, s.ended_at ? Date.parse(s.ended_at) : end) - Date.parse(s.started_at))
    work += duration; if (s.ended_at === null) current = duration
  }
  return { work, current }
}
export function taskApplied(command: TaskCommand, tasks: readonly FlowTask[]) {
  const task = tasks.find(t => t.id === command.taskId)
  return task && (command.kind === 'status-task' ? task.status === command.status
    : task.title === command.title && task.description === command.description && task.area_id === command.areaId
      && (task.deadline_at === command.deadline || (task.deadline_at && command.deadline && Date.parse(task.deadline_at) === Date.parse(command.deadline))))
}
export function createTaskApi(client: Pick<SupabaseClient, 'rpc'>) {
  return {
    async mutate(command: TaskCommand, signal: AbortSignal) {
      const args = command.kind === 'save-task' ? { p_task_id: command.taskId, p_title: command.title, p_description: command.description,
        p_area_id: command.areaId, p_deadline_at: command.deadline, p_expected_updated_at: command.expected }
        : { p_task_id: command.taskId, p_status: command.status, p_expected_updated_at: command.expected }
      const { data, error } = await client.rpc(command.kind === 'save-task' ? 'flow_task_save' : 'flow_task_status', args).abortSignal(signal)
      if (error) throw new TaskActionError(error.message === 'Pause before moving the active task' ? 'Pause eller bytt aktivitet før du flytter oppgaven til et annet område.'
        : error.code === '40001' ? 'Oppgaven er endret i en annen fane. Åpne redigering på nytt før du lagrer.'
        : error.message === 'Area unavailable' ? 'Området er ikke tilgjengelig. Velg et aktivt område eller fjern området.'
        : 'Oppgaveendringen kunne ikke bekreftes.')
      const task = mapFlowTask(data)
      if (task.id !== command.taskId) throw new Error('Ugyldig oppgavesvar.')
      return task
    },
    async time(taskId: string, signal: AbortSignal): Promise<TaskTime> {
      const { data, error } = await client.rpc('flow_task_time', { p_task_id: taskId }).abortSignal(signal)
      if (error || !data || data.task_id !== taskId || typeof data.work_milliseconds !== 'number'
        || !Number.isFinite(data.work_milliseconds) || data.work_milliseconds < 0 || typeof data.server_time !== 'string'
        || !Number.isFinite(Date.parse(data.server_time))) throw new Error('Kunne ikke hente total oppgavetid. Prøv igjen.')
      return data as TaskTime
    },
  }
}
