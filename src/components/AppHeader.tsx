import type { ReactNode } from 'react'

export default function AppHeader({ children, navigation }: { children?: ReactNode; navigation?: ReactNode }) {
  return <header className={navigation ? 'app-header has-navigation' : 'app-header'}>
    <div className="app-brand">
      <a className="asinfra-link" href="https://asinfra.no/">ASInfra</a>
      <h1>Flow</h1>
      <p>Arbeidstid og oversikt over det du jobber med.</p>
    </div>
    {navigation}
    {children && <div className="app-account">{children}</div>}
  </header>
}
