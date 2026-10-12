# ASInfra Flow

Flow registrerer faktisk arbeidstid og viser områder, historikk og statistikk.
Flow er foreløpig publisert på [study.asinfra.no](https://study.asinfra.no/) under
Flow v1-overgangen. Domenet, Pages og Supabase Auth-returer endres ikke i #10.

## Arkitektur og repoansvar

- **[andsolste/asinfra-study](https://github.com/andsolste/asinfra-study)** eier
  React/TypeScript/Vite-frontenden, frontendtestene og Pages-deploymenten til `study.asinfra.no`.
- **[andsolste/asinfra/supabase](https://github.com/andsolste/asinfra/tree/main/supabase)**
  er canonical backend: config, migrations, RLS, constraints, RPC-er og backendtester.
  Database- og RLS-endringer gjøres med egen PR/review der, aldri i dette repoet.

Begge bruker samme eksisterende Supabase-prosjekt/Auth. Brukere, ID-er og data er
beholdt. Ikke opprett et nytt prosjekt eller kopier backendmigrasjoner hit.
Frontend ble opprinnelig trukket ut av hovedrepoet; den gamle
`https://asinfra.no/study/` er nå bare en legacy redirect til subdomenet.

### Flow v1, fase #10: rebrand + domenegrunnlag

Dagens brukergrensesnitt sier **Flow**, **områder** og **arbeidsøkter**, men bruker
fortsatt `subjects`, `study_sessions`, `study_session_segments` og de fem eksisterende
`study_session_*`-RPC-ene. Dette er en bevisst kompatibilitetsgrense, ikke nye aliases
over den gamle datamodellen. `StudyTimer`, `StudyHistory`, `StudyStatistics`,
`useStudyHistory` og legacy API-modulene beholder sine interne navn. Auth, recovery,
edit/delete og Dag/Uke/Måned-beregninger endres ikke.

Rebrandingen fungerer **før** den nye backendmigrasjonen er deployet. Ingen
`flow_*`-tabeller/RPC-er leses eller skrives av denne frontenden. CSS/layout,
lagringsnøkler, API-kontrakter, repo-navn og produksjonsadresse beholdes.
Timeren krever fortsatt et aktivt område og avsluttes før områdebytte; den har
ikke fått den nye logiske arbeidsdagen eller 04:00-cutoff ennå.

Canonical backend-PR etablerer additivt `flow_areas`, `flow_tasks`,
`flow_work_days` og `flow_work_segments`. Eksisterende subjects kopieres med samme
ID/eier/felter, med en enveis subjects→areas-bridge for gamle frontend-writes.
Subjects er fortsatt skrivekilden for kopierte områder i denne fasen. Native
områder speiles ikke tilbake; aktivering av native områdeeditor må ha en eksplisitt
handoff-strategi i #11, også for gamle åpne faner.
Den samme handoff må reconcile/avslutte aktiv legacy-timer før native timer
aktiveres; de to domenene skal ikke registrere arbeid parallelt.

Ny kode kan bruke selvstendige typer i `src/types/flow.ts`, ikke bygge en
Flow-arbeidsdag som et omdøpt `StudySession`. Oppgaver kan ha maks ett valgfritt
område og en valgfri absolutt frist. **Annet = null område**, ikke en database-rad.
Legacy null-fag vises også som Annet, men kan bety slettet fag; det opprinnelige
navnet kan ikke gjenskapes. Ny null-område-start kommer først med #11.

Native dager får lagret logisk dato, IANA-tidssone og `[lokal 04:00, neste 04:00)`
som absolutte timestamps. Backend snapshot/switch håndterer cutoff med serverklokken.
Gamle sessions/segments mangler historisk tidssone og forblir urørt i legacy-tabellene.
Arbeid kopieres **ikke**; #13 kombinerer separate legacy/native segmentkilder uten
dobbelttelling. Dagens statistikk beholder lokale **kalendergrenser ved midnatt**,
ikke den fremtidige Flow-dagens 04:00-grense.

Se [canonical backend-dokumentasjon](https://github.com/andsolste/asinfra/blob/feat/flow-foundation-backend/supabase/README.md)
for constraints, bridge, RLS og migrasjonsvalg. Ingen migrations kopieres hit.

Videre faser: #11 arbeidsdag/ny tidtaker og aktivering av native modell → #12
oppgaver/frister/arbeidskø → #13 Flow-historikk/statistikk og legacy-kombinasjon →
#7 eksport. #14 håndterer `flow.asinfra.no`, DNS/Pages/Auth separat.

Review begge PR-er, merge backend, kontroller `db push --dry-run`, deploy godkjent
migration og verifiser legacy-API/RLS før frontend merge/deploy. Ingen hosted
migrations, DNS eller Auth-konfigurasjon endres av denne PR-en.

## Lokal utvikling

Bruk Node.js 22.12+ og npm; CI bruker Node.js 24. Kjør fra repo-roten:

```sh
npm ci
```

Kopier `.env.example` til `.env.local`, og sett disse **offentlige browserverdiene**
fra det eksisterende Supabase-prosjektet:

```dotenv
VITE_SUPABASE_URL=https://YOUR_PROJECT_REF.supabase.co
VITE_SUPABASE_PUBLISHABLE_KEY=sb_publishable_REPLACE_ME
```

Bruk aldri service-role/secret key i frontend. Vite bygger browserverdiene inn i
JavaScript-bundlen; de er ikke hemmeligheter. `.env.local`, credentials,
`node_modules/` og `dist/` skal ikke i Git. Bruk egne testkontoer/testdata ved lokale
skriveoperasjoner mot hosted Supabase; lokal Vite gir ikke en separat database.

```sh
npm run dev
```

Åpne **http://localhost:5173/**. Hvis porten er opptatt, frigjør den eller kontroller
at den alternative adressen er tillatt for Auth-retur.

```sh
npm test
npm run typecheck
npm run build
npm run check:build
npm run preview
```

Build trenger de to browserverdiene ovenfor. Vite bruker `base: '/'` og lager
`dist/` med root-baserte `/assets/`. Preview åpnes normalt på **http://localhost:4173/**.

## Eksisterende funksjonalitet (legacy API)

- **Auth:** e-post/passord, registrering med eventuell e-postbekreftelse, lagret
  innlogging etter reload og logout. Kontoer og eierskap håndteres av Supabase.
- **Områder:** egne områder med valgfri kode kan opprettes, redigeres, arkiveres og aktiveres
  igjen. Nye økter bruker aktive områder; historiske økter kan bruke arkiverte områder.
- **Timer:** start, pause, fortsett og stopp. Serveren er source of truth for
  recovery etter refresh og håndhever én uavsluttet økt per bruker. En pause er
  ikke en ferdig økt. Faktisk arbeidstid er summen av arbeidssegmentene, uten pauser.
- **Historikk:** ferdige økter hentes 25 om gangen med «Vis flere». Område, beskrivelse,
  øktgrenser og arbeidsperioder kan korrigeres; sletting krever bekreftelse.
  Bekreftede og usikre writes henter data på nytt, uten optimistisk sletting.
  Bekreftet timerstopp/recovery oppdaterer historikk og statistikk uten full refresh.
- **Statistikk:** dag, uke og måned i detaljpanelet, med periodevalg, total,
  mest aktive område og (for uke/måned) mest aktive dag. Browserens lokale kalender
  bestemmer grensene: midnatt, mandag og den første i måneden. Kalenderaritmetikk
  håndterer DST; en dag/uke er ikke alltid 24/168 timer. Alle sider i valgt periode
  hentes separat fra historikkens 25-raders paginering. Kun lukkede arbeidssegmenter
  telles, klippet til hver lokale dags `[start, slutt)`. Økter uten segmenter gir 0.
  Bekreftet stopp/recovery oppdaterer også en valgt historisk periode, uten å nullstille valget.
  Ved bytte mellom dag/uke/måned brukes i dag for en gjeldende periode, ellers dens første dag.

Diagrammene er små SVG-komponenter uten chart-bibliotek: dag viser områdefordeling,
uke viser syv stablede dagsstolper, måned viser alle kalenderdagene. Månedsdiagrammet
ruller internt på mobil. Y-aksen tilpasses dataene; null-dager beholdes. Område-ID
bestemmer farge og tekstur stabilt på tvers av perioder; teksturer skiller mange
fargekollisjoner, og «Annet» er nøytral. Områdelisten og «Vis tallgrunnlag» viser
tid som `HH:MM:SS`, uten krav om hover eller fargesyn. Beregningen beholder
millisekundene frem til visning. Like travle dager avgjøres med tidligste dato.

Historikk bruker `study_session_history`, `study_session_history_edit` og
`study_session_history_delete`. Timeren bruker `study_session_transition` og
`study_session_snapshot`. Responsene valideres i frontend; RLS, constraints og
RPC-er i canonical backend er sikkerhetsgrensen og begrenser data til `auth.uid()`.

Redigering viser lokal tid med **hele sekunder** (`step="1"`). Et felt som fortsatt
matcher de viste sekundene i originalen, sender det opprinnelige absolutte
tidsstempelet uendret, inkludert milli-/mikrosekunder. Endrede felt konverteres
til ISO med sekundpresisjon, uten manuell offsetforskyvning. Tidspunkter som ikke
finnes ved tidsomstilling, og nye tvetydige klokkeslett, avvises. Uendrede felt i
en gjentatt time beholder den opprinnelige forekomsten.

## CI, deployment og Auth-retur

`.github/workflows/pages.yml` kjører `npm ci`, tester, typecheck, build og
`check:build` på PR-er mot `main`. Push til `main` eller manuell kjøring på `main`
gjør samme kontroll og publiserer **kun `dist/`** til GitHub Pages.
Kildekode, dependencies, env-filer og backend publiseres ikke.

Pages bruker **Source: GitHub Actions**, **Custom domain: study.asinfra.no** og
HTTPS. Repository variables under **Settings → Secrets and variables → Actions →
Variables** er `VITE_SUPABASE_URL` og `VITE_SUPABASE_PUBLISHABLE_KEY`.
CI feiler tydelig hvis de mangler. DNS/Auth endres ikke av workflowen.

Auth-bekreftelseslenker bruker gjeldende origin + Vites base. I eksisterende
Supabase-prosjekts **Authentication → URL Configuration** skal produksjonens Site URL være
`https://study.asinfra.no/`. Redirect URLs må tillate den adressen og
`http://localhost:5173/`, samt `http://localhost:4173/` hvis preview brukes med Auth.
Gamle `/study/`-returer kan beholdes for legacy-lenker; ikke fjern andre appers returer.

## Tester og kjente begrensninger

Frontendtestene dekker config/Auth-retur, SDK-kall, mapping, områdehandlinger,
timer/recovery/retry, paginering, edit/delete, usikre writes og segmenttid.
Dag-/uke-/månedsgrenser, daglig segmentfordeling, skuddår, tidsomstilling,
områdefarger, hele intervallets paginering, raske periodebytter og inputpresisjon
testes i flere tidssoner. Rene kalender-/aggregeringshjelpere ligger i
`src/lib/statistics.ts`; `history-store.ts` håndterer separate avbrytbare lesinger.
SDK/nettverk simuleres: dette verifiserer ikke ekte hosted Auth eller RLS.
Database-/RLS-testene eies av [canonical backend](https://github.com/andsolste/asinfra/tree/main/supabase/tests).

Eksport, mål, streaks og flere statistikkperioder enn dag/uke/måned er utenfor
dagens funksjonalitet. Større forbedringer håndteres separat.

## Produksjonssjekkliste etter merge/deploy

Bruk to egne testkontoer (A/B) og merkede testdata, ikke credentials i Git.
Automatiserte tester erstatter ikke denne kontrollen mot ekte Auth/RLS:

1. Åpne **https://study.asinfra.no/** over HTTPS; ingen asset-404 eller konsollfeil.
2. Test login, reload av innlogging og logout.
3. Kontroller Flow-branding, eksisterende egne områder og historiske økter.
4. Opprett/rediger/arkiver et testområde og aktiver det igjen.
5. Start/pause/fortsett, refresh og stopp; samme økt gjenopprettes uten duplikat.
6. Den ferdige økten vises i historikken uten full refresh; arbeidstid utelater pauser.
7. Velg dag/uke/måned og forrige/neste/gjeldende periode; kontroller diagram,
   total, områdeliste og tallgrunnlag, også segmenter over midnatt og periodegrenser.
   Test DST og intern rulling i månedsdiagrammet på mobil.
8. Rediger beskrivelse/område og en arbeidsperiode. Uendrede tidspunkter beholder
   original presisjon; endrede vises uten millisekunder. Ugyldig overlapp avvises.
9. Avbryt sletting først; slett så en merket testøkt med bekreftelse.
10. Reload: korreksjoner består, slettet økt er borte og statistikktotalen stemmer.
11. Test 320/390 px og desktop: ingen horisontal scrolling, leselige tidsfelter,
    labels, Tab/Shift+Tab, synlig fokus, status/feil og fokus etter edit/cancel/delete.
12. Logg inn som B i en separat nettleserprofil. A/B skal bare se egne områder,
    økter, historikk og statistikk; bytte av konto må ikke vise forrige brukers data.
