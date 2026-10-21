export const flowViews = { work: 'Arbeid', tasks: 'Oppgaver', insights: 'Innsikt' } as const
export type FlowView = keyof typeof flowViews
export type InsightView = 'overview' | 'history'
export type FlowLocation = { view: FlowView; insight: InsightView }

// Query state works on static hosting. Do not consume Auth query/hash parameters.
export function readFlowLocation(href: string): FlowLocation {
  const params = new URL(href).searchParams
  const value = params.get('view')
  return { view: value === 'tasks' || value === 'insights' ? value : 'work',
    insight: params.get('section') === 'history' ? 'history' : 'overview' }
}

export function flowLocationUrl(href: string, next: FlowLocation): string {
  const url = new URL(href)
  url.searchParams.delete('view'); url.searchParams.delete('section')
  if (next.view !== 'work') url.searchParams.set('view', next.view)
  if (next.view === 'insights' && next.insight === 'history') url.searchParams.set('section', 'history')
  return url.href
}
