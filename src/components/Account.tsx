import { useEffect, useState } from 'react'
import type { Session } from '@supabase/supabase-js'
import { supabase } from '../lib/supabase'
import Subjects from './Subjects'
import AppHeader from './AppHeader'
import StudyTimer from './StudyTimer'
import StudyHistory from './StudyHistory'
import { useSubjects } from '../hooks/useSubjects'
import { useStudyHistory } from '../hooks/useStudyHistory'

export default function Account({ session }: { session: Session }) {
  const subjects = useSubjects()
  const history = useStudyHistory()
  const [signingOut, setSigningOut] = useState(false)
  const [error, setError] = useState<string | null>(null)

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
      <main id="study-content" className="dashboard-grid" tabIndex={-1}>
        <StudyTimer subjects={subjects} onFinished={history.reload} />
        <StudyHistory data={history} subjects={subjects} />
        <Subjects data={subjects} />
      </main>
    </>
  )
}
