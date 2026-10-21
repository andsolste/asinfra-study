import { useEffect, useRef, useState } from 'react'
import type { Session } from '@supabase/supabase-js'
import { supabase } from '../lib/supabase'
import Subjects from './Subjects'
import AppHeader from './AppHeader'
import FlowTimer from './FlowTimer'
import FlowHistory from './FlowHistory'
import FlowStatistics from './FlowStatistics'
import FlowExport from './FlowExport'
import DetailPanel from './DetailPanel'
import { useSubjects } from '../hooks/useSubjects'
import { useFlowHistory } from '../hooks/useFlowHistory'
import { useFlowWorkDay } from '../hooks/useFlowWorkDay'
import TaskQueue from './TaskQueue'
import Tasks from './Tasks'
import type { TaskRequest } from './Tasks'
import FlowNavigation, { followFlowLink } from './FlowNavigation'
import { useFlowNavigation } from '../hooks/useFlowNavigation'
import { flowLocationUrl, flowViews } from '../lib/flow-navigation'
import { activityName } from '../lib/flow-work'

const detailPanels = { export: 'Eksport', subjects: 'Områder' } as const
type Panel = keyof typeof detailPanels

export default function Account({ session }: { session: Session }) {
  const subjects = useSubjects()
  const history = useFlowHistory()
  const flow = useFlowWorkDay()
  const { location, navigate } = useFlowNavigation()
  const [taskRequest, setTaskRequest] = useState<TaskRequest | null>(null)
  const [taskEditing, setTaskEditing] = useState(false)
  const [signingOut, setSigningOut] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [panel, setPanel] = useState<Panel | null>(null)
  const panelOpener = useRef<HTMLElement | null>(null)
  const panelFallback = useRef<HTMLElement | null>(null)
  const accountMenu = useRef<HTMLDetailsElement | null>(null)
  const accountToggle = useRef<HTMLElement | null>(null)
  const locationKey = `${location.view}:${location.insight}`
  const panelLocation = useRef(locationKey)
  const previousLocation = useRef(locationKey)
  const panelBusy = panel === 'subjects' && subjects.busy && subjects.status === 'ready'
  const activeSegment = flow.data?.current?.segments.find(s => s.ended_at === null)
  const activity = activeSegment ? activityName({ areaId: activeSegment.area_id, taskId: activeSegment.task_id }, flow.catalog) : null

  useEffect(() => {
    if (previousLocation.current === locationKey) return
    previousLocation.current = locationKey
    if (accountMenu.current) accountMenu.current.open = false
    panelFallback.current?.focus({ preventScroll: true })
    window.scrollTo(0, 0)
  }, [locationKey])
  // Browser Back can navigate while a dialog is open. Finish a pending area write
  // before closing; the data hooks themselves always remain mounted in Account.
  useEffect(() => {
    if (panel && panelLocation.current !== locationKey && !panelBusy) setPanel(null)
  }, [locationKey, panel, panelBusy])

  useEffect(() => {
    if (subjects.status === 'ready') void history.reload()
  }, [subjects.subjects, subjects.status, history.reload])
  useEffect(() => {
    if (location.view === 'insights') void history.reload()
  }, [location.view, flow.data, history.reload])

  function showPanel(next: Panel, opener: HTMLElement) {
    panelOpener.current = opener; panelLocation.current = locationKey; setPanel(next)
    if (accountMenu.current) accountMenu.current.open = false
  }

  function requestTask(next: TaskRequest) {
    // A pending/uncertain write must keep its original form and revision until
    // the shared store has checked it. Show that form instead of replacing it.
    if (taskEditing && flow.pending) { navigate({ ...location, view: 'tasks' }); return }
    if (taskEditing && !window.confirm('Åpne en annen oppgave og forkaste det ulagrede oppgaveskjemaet?')) return
    setTaskRequest(next); navigate({ ...location, view: 'tasks' })
  }
  function openTask(id: string | null) { requestTask({ id }) }

  async function signOut() {
    if (!supabase) return
    setSigningOut(true); setError(null)
    try {
      const result = await supabase.auth.signOut({ scope: 'local' })
      if (result.error) setError('Kunne ikke logge ut. Prøv igjen.')
    } catch { setError('Kunne ikke logge ut. Prøv igjen.') }
    finally { setSigningOut(false) }
  }

  return (
    <>
      <AppHeader navigation={<FlowNavigation location={location} navigate={navigate} />}>
        <details className="account-menu" ref={accountMenu} onKeyDown={event => {
          if (event.key === 'Escape') { event.preventDefault(); event.currentTarget.open = false; accountToggle.current?.focus() }
        }}>
          <summary ref={accountToggle}>Konto</summary>
          <div className="account-menu-content">
            <p className="account-email"><span>Innlogget som</span><strong>{session.user.email ?? 'Flow-bruker'}</strong></p>
            <button className="text-button" type="button" aria-haspopup="dialog" aria-controls="study-details"
              onClick={() => { if (accountToggle.current) showPanel('subjects', accountToggle.current) }}>Områder</button>
            <button className="secondary-button" type="button" disabled={signingOut} onClick={signOut}>{signingOut ? 'Logger ut …' : 'Logg ut'}</button>
          </div>
        </details>
        {error && <p role="alert" className="auth-error">{error}</p>}
      </AppHeader>
      {location.view !== 'work' && (activity || flow.phase === 'recovering' || flow.phase === 'error') && <p className="work-status" role="status">
        <a href={flowLocationUrl(window.location.href, { ...location, view: 'work' })}
          onClick={event => followFlowLink(event, () => navigate({ ...location, view: 'work' }))}>
          <span className="work-status-label">{flow.phase === 'recovering' ? 'Kontrollerer arbeidsstatus …' : flow.phase === 'error' ? 'Arbeidsstatus må kontrolleres'
            : `Arbeider · ${activity!.area}${activeSegment?.task_id ? ` · ${activity!.task}` : ''}`}</span><span className="work-status-link">Til Arbeid →</span>
        </a>
      </p>}
      <main id="study-content" className="timer-workspace" aria-label={flowViews[location.view]} tabIndex={-1} ref={panelFallback}>
        {/* Keep workspace/form state across views; only export is intentionally
            unmounted on close so its snapshot/jobs are cancelled as before. */}
        <div className="work-layout" hidden={location.view !== 'work'}>
          <FlowTimer data={flow} organizationVersion={subjects.subjects} onCutover={history.reload} active={location.view === 'work'} fallbackFocus={panelFallback.current} />
          <TaskQueue data={flow} onOpen={openTask} onCreate={() => requestTask({ id: null, create: true })} />
        </div>
        <section id="tasks-view" className="dashboard-panel" aria-labelledby="tasks-title" hidden={location.view !== 'tasks'}>
          <header className="view-heading"><p className="section-label">Oppgavehåndtering</p><h2 id="tasks-title">Oppgaver</h2></header>
          <Tasks data={flow} initialId={null} request={taskRequest} onEditingChange={setTaskEditing} />
        </section>
        <div hidden={location.view !== 'insights'}>
          <div className="insights-heading">
            <div><p className="section-label">Innsikt</p><nav className="insights-navigation" aria-label="Innsikt">
              {([['overview', 'Oversikt'], ['history', 'Arbeidslogg']] as const).map(([insight, label]) =>
                <a key={insight} href={flowLocationUrl(window.location.href, { view: 'insights', insight })}
                  aria-current={location.insight === insight ? 'page' : undefined}
                  onClick={event => followFlowLink(event, () => navigate({ view: 'insights', insight }))}>{label}</a>)}
            </nav></div>
            <button className="secondary-button" type="button" aria-haspopup="dialog" aria-controls="study-details"
              onClick={event => showPanel('export', event.currentTarget)}>Eksporter</button>
          </div>
          <div hidden={location.insight !== 'overview'}><FlowStatistics data={history} catalog={flow.catalog} /></div>
          <div hidden={location.insight !== 'history'}><FlowHistory data={history} subjects={subjects} catalog={flow.catalog} /></div>
        </div>
      </main>
      <DetailPanel open={panel !== null} title={panel ? detailPanels[panel] : ''}
        returnFocus={panelOpener.current} fallbackFocus={panelFallback.current} busy={panelBusy}
        hasForms={panel === 'subjects'} onClose={() => setPanel(null)}>
        {panel === 'export' && <FlowExport history={history} />}
        {panel === 'subjects' && <Subjects data={subjects} />}
      </DetailPanel>
    </>
  )
}
