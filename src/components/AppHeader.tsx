import type { ReactNode } from 'react'

export default function AppHeader({ children }: { children?: ReactNode }) {
  return <header className="app-header">
    <div className="app-brand">
      <a className="asinfra-link" href="https://asinfra.no/">ASInfra</a>
      <h1>Study</h1>
      <p>Arbeidstid og oversikt over studiene dine.</p>
    </div>
    {children && <div className="app-account">{children}</div>}
  </header>
}
