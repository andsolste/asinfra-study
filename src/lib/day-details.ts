import type { FlowSnapshot } from './flow-work.ts'
import type { FlowHistoryEntry } from './flow-history.ts'
import type { FlowWorkSegment } from '../types/flow.ts'
import { sameNativeValues } from './native-period.ts'

export type DayPeriodEditor = { snapshot: FlowSnapshot; segment: FlowWorkSegment }

export function dayDetails(current: FlowSnapshot | null, closed: FlowSnapshot | null,
  rows: readonly FlowHistoryEntry[], editor: DayPeriodEditor | null, verified: boolean) {
  // A corrected cached closed day must use the canonical history refresh too.
  const row = rows.find(row => row.source === 'flow' && row.id === closed?.work_day.id)
  const live = current ?? (row?.source === 'flow' ? row.snapshot : closed)
  const original = editor && live?.work_day.id === editor.snapshot.work_day.id
    ? live.segments.find(segment => segment.id === editor.segment.id) : null
  return {
    // Neither a refresh nor a day change may unmount or rebase the open editor.
    snapshot: editor?.snapshot ?? live,
    stale: Boolean(editor && verified && (!original || original.ended_at === null || !sameNativeValues(original, editor.segment))),
  }
}
