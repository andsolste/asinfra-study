import Account from './components/Account'
import AppHeader from './components/AppHeader'
import PublicFlowOverview from './components/PublicFlowOverview'
import { useAuth } from './hooks/useAuth'
import { supabase } from './lib/supabase'

export default function App() {
  const auth = useAuth()
  return <AppView auth={auth} configured={Boolean(supabase)} />
}

// Keep the session gate ahead of Account: public rendering never mounts its data hooks.
export function AppView({ auth: { session, loading, error }, configured }: {
  auth: ReturnType<typeof useAuth>; configured: boolean
}) {
  return (
    <div className="study-shell">
      <a className="skip-link" href="#study-content">Til innhold</a>
      {configured && !loading && !error && session ? <Account key={session.user.id} session={session} />
        : configured && loading ? <>
          <AppHeader />
          <main id="study-content" className="auth-layout" tabIndex={-1}>
            <p className="auth-section" role="status">Henter innlogging …</p>
          </main>
        </> : <PublicFlowOverview configured={configured} authError={error} />}
    </div>
  )
}
