import { activityUsable } from './flow-work.ts'
import type { FlowActivity, FlowCatalog, FlowSnapshot } from './flow-work.ts'
import type { FlowPhase } from './flow-work-store.ts'
import { taskQueue } from './flow-tasks.ts'

// Derived presentation only: no persisted priority or changes to taskQueue().
export function workRecommendations(catalog: FlowCatalog, current: FlowSnapshot | null, phase: FlowPhase, time: number) {
  const open = current?.segments.find(segment => segment.ended_at === null)
  const segment = phase === 'running' ? open : phase === 'paused' && !open ? current?.segments.at(-1) : undefined
  const activity: FlowActivity | null = segment ? { areaId: segment.area_id, taskId: segment.task_id } : null
  const usable = activity !== null && activityUsable(activity, catalog)
  // A running activity is actual work even if its metadata was archived elsewhere.
  // A paused activity is "Now" only when Continue can still resume exactly it.
  const now = segment && activity && (phase === 'running' || usable) ? { segment, activity, usable } : null
  const ordered = taskQueue(catalog.tasks, time)
  const candidates = ordered.filter(task => task.id !== now?.activity.taskId
    && activityUsable({ areaId: task.area_id, taskId: task.id }, catalog))
  return { now, next: candidates[0] ?? null, later: candidates.slice(1, 4),
    // Count ALL active overdue tasks, including current work and unavailable areas.
    // They still need attention in Tasks even when they cannot be recommended here.
    overdueCount: ordered.filter(task => task.deadline_at !== null && Date.parse(task.deadline_at) < time).length,
    activeCount: ordered.length }
}
