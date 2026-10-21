import type { FlowTask } from '../types/flow.ts'
import type { FlowCatalog } from './flow-work.ts'
import { taskOverdue, taskQueue } from './flow-tasks.ts'

export function taskArea(task: FlowTask, catalog: FlowCatalog) {
  const area = catalog.areas.find(area => area.id === task.area_id)
  return { name: area?.name ?? (task.area_id ? 'Utilgjengelig område' : 'Annet'),
    unavailable: task.area_id !== null && (!area || area.is_archived), archived: area?.is_archived ?? false }
}

// Presentation only. Archived/missing areas stay in their deadline group exactly
// once, with an explicit warning; filtering never changes tasks or queue priority.
export function taskOverview(tasks: readonly FlowTask[], now: number, area = 'all') {
  const visible = tasks.filter(task => area === 'all' || (area === 'none' ? task.area_id === null : task.area_id === area))
  const ordered = taskQueue(visible, now)
  return {
    groups: [
      { id: 'overdue', title: 'Forfalt', tasks: ordered.filter(task => taskOverdue(task, now)) },
      { id: 'upcoming', title: 'Kommende frister', tasks: ordered.filter(task => task.deadline_at !== null && !taskOverdue(task, now)) },
      { id: 'undated', title: 'Uten frist', tasks: ordered.filter(task => task.deadline_at === null) },
    ],
    activeCount: ordered.length,
    completed: visible.filter(task => task.status === 'completed').sort((a, b) =>
      Date.parse(b.completed_at!) - Date.parse(a.completed_at!) || a.id.localeCompare(b.id)),
  }
}

export function activeAreaTasks(tasks: readonly FlowTask[], areaId: string) {
  return tasks.filter(task => task.status === 'active' && task.area_id === areaId).length
}
