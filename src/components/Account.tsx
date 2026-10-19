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

const detailPanels = { tasks: 'Oppgaver', statistics: 'Statistikk', history: 'Historikk', export: 'Eksport', subjects: 'Organisering' } as const
type Panel = keyof typeof detailPanels

export default function Account({ session }: { session: Session }) {
  const subjects = useSubjects()
  const history = useFlowHistory()
  const flow = useFlowWorkDay()
  const [taskId, setTaskId] = useState<string | null>(null)
  const [signingOut, setSigningOut] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [panel, setPanel] = useState<Panel | null>(null)
  const panelOpener = useRef<HTMLElement | null>(null)
  const panelFallback = useRef<HTMLElement | null>(null)
  const panelBusy = panel === 'tasks' ? flow.phase === 'recovering' : panel === 'history' ? history.mutation !== null
    : panel === 'subjects' && subjects.busy && subjects.status === 'ready'

  useEffect(() => {
    if (subjects.status === 'ready') void history.reload()
  }, [subjects.subjects, subjects.status, history.reload])
  useEffect(() => {
    if (panel === 'statistics' || panel === 'history') void history.reload()
  }, [panel, flow.data, history.reload])

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
      <AppHeader>
        <div className="account-controls">
          <p className="account-email"><span>Innlogget som</span><strong>{session.user.email ?? 'Flow-bruker'}</strong></p>
          <button className="secondary-button" type="button" disabled={signingOut} onClick={signOut}>{signingOut ? 'Logger ut …' : 'Logg ut'}</button>
        </div>
        {error && <p role="alert" className="auth-error">{error}</p>}
      </AppHeader>
      <main id="study-content" className="timer-workspace" tabIndex={-1} ref={panelFallback}>
        <FlowTimer data={flow} organizationVersion={subjects.subjects} onCutover={history.reload} />
        <TaskQueue data={flow} onOpen={(id, opener) => { setTaskId(id); panelOpener.current = opener; setPanel('tasks') }} />
        <nav className="detail-actions" aria-label="Detaljvisninger">
          {(Object.keys(detailPanels) as Panel[]).map(key => <button key={key} type="button"
            className="secondary-button" aria-haspopup="dialog" aria-controls="study-details"
            onClick={event => { panelOpener.current = event.currentTarget; setTaskId(null); setPanel(key) }}>{detailPanels[key]}</button>)}
        </nav>
      </main>
      <DetailPanel open={panel !== null} title={panel ? detailPanels[panel] : ''}
        returnFocus={panelOpener.current} fallbackFocus={panelFallback.current} busy={panelBusy}
        hasForms={panel === 'history' || panel === 'subjects' || panel === 'tasks'} onClose={() => setPanel(null)}>
        {panel === 'tasks' && <Tasks data={flow} initialId={taskId} />}
        {panel === 'statistics' && <FlowStatistics data={history} catalog={flow.catalog} />}
        {panel === 'history' && <FlowHistory data={history} subjects={subjects} catalog={flow.catalog} />}
        {panel === 'export' && <FlowExport history={history} />}
        {panel === 'subjects' && <Subjects data={subjects} />}
      </DetailPanel>
    </>
  )
}
