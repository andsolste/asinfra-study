import Account from './components/Account'
import AuthForm from './components/AuthForm'
import AppHeader from './components/AppHeader'
import { useAuth } from './hooks/useAuth'
import { supabase } from './lib/supabase'

export default function App() {
  const { session, loading, error } = useAuth()
  return (
    <div className="study-shell">
      <a className="skip-link" href="#study-content">Til innhold</a>
      {supabase && !loading && session ? <Account key={session.user.id} session={session} />
        : <>
          <AppHeader />
          <main id="study-content" className="auth-layout" tabIndex={-1}>
            {!supabase ? <p className="auth-section" role="alert">Study mangler gyldig Supabase-konfigurasjon. Kontroller prosjekt-URL og publishable key før appen bygges.</p>
              : loading ? <p className="auth-section" role="status">Henter innlogging …</p>
                : <>{error && <p role="alert" className="auth-error">{error}</p>}<AuthForm /></>}
          </main>
        </>}
    </div>
  )
}
