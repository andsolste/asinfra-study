import type { ReactNode } from 'react'

export default function AppHeader({ children, navigation, exams = false }: { children?: ReactNode; navigation?: ReactNode; exams?: boolean }) {
  return <header className={navigation ? 'app-header has-navigation' : 'app-header'}>
    <div className="app-brand">
      <a className="asinfra-link" href="https://asinfra.no/">ASInfra</a>
      {exams ? <h1>Eksamener</h1> : <h1>Flow</h1>}
      <p>{exams ? 'Øv på tidligere eksamener.' : 'Arbeidstid og oversikt over det du jobber med.'}</p>
    </div>
    {navigation}
    {children && <div className="app-account">{children}</div>}
  </header>
}
