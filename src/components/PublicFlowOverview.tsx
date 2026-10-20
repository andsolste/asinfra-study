import { useRef } from 'react'
import AppHeader from './AppHeader'
import AuthForm from './AuthForm'
import { HistoryExample, StatisticsExample, TasksExample, TimerExample } from './FlowExamples'
import '../public-flow.css'

export default function PublicFlowOverview({ configured, authError }: { configured: boolean; authError: string | null }) {
  const auth = useRef<HTMLElement>(null), features = useRef<HTMLHeadingElement>(null)
  function showLogin() {
    const target = auth.current?.querySelector<HTMLInputElement>('input') ?? auth.current
    auth.current?.scrollIntoView({ block: 'start' })
    target?.focus({ preventScroll: true })
  }
  function showFeatures() { features.current?.focus(); features.current?.scrollIntoView({ block: 'start' }) }
  return <>
    <AppHeader><button type="button" className="secondary-button" onClick={showLogin}>Logg inn</button></AppHeader>
    <main id="study-content" className="public-flow" tabIndex={-1}>
      <section className="public-hero" aria-labelledby="public-intro">
        <p className="section-label">Et arbeidsverktøy fra ASInfra</p>
        <h2 id="public-intro">Se hva du faktisk bruker arbeidstiden på.</h2>
        <p>Flow viser hvor mye du har arbeidet, hva du brukte tiden på og hvilke oppgaver som venter. Registrer arbeid mens du holder på, og la pausene være pauser.</p>
        {authError && <p role="alert" className="auth-error">{authError}</p>}
        <div className="public-actions"><button type="button" onClick={showLogin}>Logg inn</button>
          <button type="button" className="text-button" onClick={showFeatures}>Se hvordan Flow fungerer <span aria-hidden="true">↓</span></button></div>
      </section>

      <section className="public-feature" aria-labelledby="public-workday">
        <div className="public-feature-copy"><p className="section-label">Arbeidsdagen</p><h2 id="public-workday" ref={features} tabIndex={-1}>Én dag. Flere arbeidsperioder.</h2>
          <ol className="public-steps"><li>Velg et område eller en oppgave å jobbe med.</li><li>Flow teller faktisk arbeidstid.</li><li>Ta Pause når du ikke arbeider, og Fortsett når du er klar.</li><li>Bytt aktivitet direkte når fokuset endres.</li></ol>
          <p>Dagen beholder summen, selv om du tar pauser eller bytter aktivitet. Flow-dagen går fra kl. 04:00 til neste kl. 04:00.</p>
        </div><TimerExample />
      </section>

      <section className="public-feature" aria-labelledby="public-tasks">
        <div className="public-feature-copy"><p className="section-label">Oppgaver og områder</p><h2 id="public-tasks">Ha noe konkret å jobbe videre med.</h2>
          <p>Samle arbeid i områder som Nettverk, Operativsystemer, Prosjekt eller Jobbsøking. Bruk Annet når arbeidet ikke trenger et eget område.</p>
          <p>Oppgaver har tittel, valgfritt område og frist, og kan være aktive eller fullførte. Start arbeid direkte fra oppgavekøen, eller velg en aktivitet uten oppgave.</p>
        </div><TasksExample />
      </section>

      <section className="public-feature" aria-labelledby="public-statistics">
        <div className="public-feature-copy"><p className="section-label">Statistikk</p><h2 id="public-statistics">Se hvor tiden går.</h2>
          <p>Se faktisk arbeid per dag, uke, måned eller totalt. Områdefordeling og daglige summer gjør det enklere å se hva som har tatt tid, uten å telle pausene som arbeid.</p>
          <p>Du kan gå videre til et område og se hvilke oppgaver som bidro.</p>
          <p className="public-example-note">Alle visningene på denne siden bruker konstruerte eksempeldata. De er ikke hentet fra en brukerkonto.</p>
        </div><StatisticsExample />
      </section>

      <section className="public-feature" aria-labelledby="public-history">
        <div className="public-feature-copy"><p className="section-label">Historikk og eksport</p><h2 id="public-history">Behold oversikten, også etterpå.</h2>
          <p>Tidligere arbeidsdager beholder aktiviteter og arbeidsperioder. Pauser vises som gap i tidslinjen.</p>
          <p>Eksporter egne registreringer som CSV for videre analyse, eller forhåndsvis en arbeidsrapport. Rapporten kan skrives ut eller lagres som PDF med nettleserens vanlige utskriftsfunksjon.</p>
          <p>Arbeidsdataene er beskyttet av innlogging. Eksport er et aktivt valg, ikke automatisk deling.</p>
        </div><HistoryExample />
      </section>

      <section className="public-auth" ref={auth} tabIndex={-1} aria-label="Tilgang til Flow">
        <div className="public-feature-copy"><p className="section-label">Din egen oversikt</p><h2>Bruk Flow med din egen konto.</h2>
          <p>Logg inn for å registrere arbeid, organisere oppgaver og se dine egne tall. Har du ikke konto, kan du velge Opprett konto i skjemaet.</p>
        </div><div className="public-auth-form">
          {configured ? <AuthForm /> : <p className="auth-section" role="alert">Flow mangler gyldig Supabase-konfigurasjon. Kontroller prosjekt-URL og publishable key før appen bygges. Innlogging er ikke tilgjengelig.</p>}
        </div>
      </section>
    </main>
  </>
}
