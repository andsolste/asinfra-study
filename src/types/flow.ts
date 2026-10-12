/** Native Flow foundation contract. Not activated by the current legacy Study UI.
 * UUIDs/date/timestamps are serialized strings; ownership is supplied by auth.uid().
 * This is not a StudySession alias. Runtime RPC validation comes with #11/#12.
 */
export type FlowArea = {
  id: string
  name: string
  code: string | null
  is_archived: boolean
  created_at: string
}

export type FlowTask = {
  id: string
  area_id: string | null
  title: string
  description: string
  deadline_at: string | null
  created_at: string
} & (
  | { status: 'active'; completed_at: null }
  | { status: 'completed'; completed_at: string }
)

export type FlowWorkDay = {
  id: string
  logical_date: string // YYYY-MM-DD, not a UTC calendar date inferred from started_at
  timezone: string // frozen IANA zone, e.g. America/New_York; no assumed Norwegian zone
  boundary_at: string // inclusive local 04:00, converted by the backend
  cutoff_at: string // exclusive next local 04:00, NOT boundary_at + 24 hours
  started_at: string
  ended_at: string | null
  created_at: string
}

export type FlowWorkSegment = {
  id: string
  work_day_id: string
  area_id: string | null // Annet; no database row needed
  task_id: string | null
  started_at: string
  ended_at: string | null
  created_at: string
}
