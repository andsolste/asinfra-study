import { useEffect, useRef, useState } from 'react'
import type { Session } from '@supabase/supabase-js'
import { supabase } from '../lib/supabase'
import Subjects from './Subjects'
import AppHeader from './AppHeader'
import StudyTimer from './StudyTimer'
import StudyHistory from './StudyHistory'
import StudyStatistics from './StudyStatistics'
import DetailPanel from './DetailPanel'
import { useSubjects } from '../hooks/useSubjects'
import { useStudyHistory } from '../hooks/useStudyHistory'

const detailPanels = { statistics: 'Statistikk', history: 'Historikk', subjects: 'Organisering' } as const
type Panel = keyof typeof detailPanels

export default function Account({ session }: { session: Session }) {
  const subjects = useSubjects()
  const history = useStudyHistory()
  const [signingOut, setSigningOut] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [panel, setPanel] = useState<Panel | null>(null)
  const panelOpener = useRef<HTMLButtonElement | null>(null)
  const panelBusy = panel === 'history' ? history.mutation !== null
    : panel === 'subjects' && subjects.busy && subjects.status === 'ready'

  useEffect(() => {
    if (subjects.status === 'ready') void history.reload()
  }, [subjects.subjects, subjects.status, history.reload])

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
          <p className="account-email"><span>Innlogget som</span><strong>{session.user.email ?? 'Study-bruker'}</strong></p>
          <button className="secondary-button" type="button" disabled={signingOut} onClick={signOut}>{signingOut ? 'Logger ut …' : 'Logg ut'}</button>
        </div>
        {error && <p role="alert" className="auth-error">{error}</p>}
      </AppHeader>
      <main id="study-content" className="timer-workspace" tabIndex={-1}>
        <StudyTimer subjects={subjects} onFinished={history.reload} />
        <nav className="detail-actions" aria-label="Detaljvisninger">
          {(Object.keys(detailPanels) as Panel[]).map(key => <button key={key} type="button"
            className="secondary-button" aria-haspopup="dialog" aria-controls="study-details"
            onClick={event => { panelOpener.current = event.currentTarget; setPanel(key) }}>{detailPanels[key]}</button>)}
        </nav>
      </main>
      <DetailPanel open={panel !== null} title={panel ? detailPanels[panel] : ''}
        returnFocus={panelOpener.current} busy={panelBusy}
        hasForms={panel === 'history' || panel === 'subjects'} onClose={() => setPanel(null)}>
        {panel === 'statistics' && <StudyStatistics data={history} />}
        {panel === 'history' && <StudyHistory data={history} subjects={subjects} />}
        {panel === 'subjects' && <Subjects data={subjects} />}
      </DetailPanel>
    </>
  )
}
