import { activityUsable, browserTimezone } from './flow-work.ts'
import type { FlowActivity, FlowCatalog, FlowCommand, FlowState } from './flow-work.ts'

// Timer and queue use ONE command builder, ONE store and the same native RPC.
export function startActivityCommand(activity: FlowActivity, state: FlowState | null, catalog: FlowCatalog,
  uuid: () => string = () => crypto.randomUUID(), timezone: () => string | null = browserTimezone): FlowCommand {
  if (!activityUsable(activity, catalog)) throw new Error('Velg et aktivt område eller en aktiv oppgave. Arkiverte områder kan ikke startes.')
  const current = state?.current
  if (current) return { kind: 'activity', dayId: current.work_day.id,
    expectedId: current.segments.find(s => s.ended_at === null)?.id ?? null,
    expectedCount: current.segments.length, nextId: uuid(), ...activity }
  const zone = timezone(), boundary = state?.next_boundary_at
  if (!zone || !boundary) throw new Error('Kontroller systemets tidssone og hent status før du starter.')
  return { kind: 'start', dayId: uuid(), segmentId: uuid(), timezone: zone, boundary, ...activity }
}
