# ASInfra Flow

Flow registrerer faktisk arbeidstid og viser områder, historikk og statistikk.
Flow er foreløpig publisert på [study.asinfra.no](https://study.asinfra.no/) under
Flow v1-overgangen. Domenet, Pages og Supabase Auth-returer endres ikke i #11.

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

### Flow v1, fase #11: native arbeidsdag og tidtaker

**Backendmigrasjonen `20261013090000_activate_flow_workday.sql` må reviewes og
deployes før denne frontend-PR-en merges.** Den er ikke deployet av denne PR-en.
Ingen stille fallback til legacy timer brukes dersom nødvendig backend mangler.

`FlowTimer` → `useFlowWorkDay` → `flow-work-store.ts` / `flow-work.ts` er den nye
timerflyten, med eget domene i `src/types/flow.ts` og runtime-validerte RPC-svar.
Tilstander: loading / idle / running / paused / recovering / error. En dag opprettes
først ved valgt aktivitet, aldri ved login/load/picker. **Annet = null område**,
ikke en database-rad. Eksisterende aktive oppgaver kan velges, også uten område.

Hovedtiden summerer dagens segmenter uten gap/pauser; nåværende periode vises
separat. Server_time + en monotont målt tidsdifferanse driver visningen, alltid
klippet til cutoff. Dagsdetaljer viser arbeid, start, klokketid, pause og segmenter.
Ingen vanlig Stopp-knapp finnes: Pause er nok.
Ved cutoff kan sist avsluttede dag i denne fanen fortsatt sees i dagsdetaljer,
med serverbekreftet ended_at; hovedtiden er likevel 00:00:00 uten aktiv dag.
Denne lokale detaljreferansen lagres ikke over logout/fresh reload. Full tidligere
native historikk er #13, ikke et nytt historikksystem her.

`flow_work_state` gir recovery og start-boundary-token. `flow_work_day_start`
oppretter dag + første segment + legacy-cutover atomisk. `flow_work_activity`
bruker forventet åpent segment, segment-count og retry-UUID over foundationens
atomiske switch. Usikre writes etterfølges av statuslesing, ikke optimistisk state.
Hvis også statuslesingen feiler, beholdes eksakte UUID-er for eksplisitt retry.

Flow-dagen er `[lokal 04:00, neste 04:00)` med fryst IANA-zone og absolutte grenser.
Ugyldig browserzone gjettes ikke. Timeout ved cutoff, focus, visibilitychange,
online og manuell recovery henter serverstatus, også etter sleep/offline.
Ingen ny dag/aktivitet starter automatisk. Reise endrer ikke aktiv dags zone;
en ny dag kan bruke browserens nye zone.

Områdeeditoren skriver fortsatt kun til **subjects**. Broen fra #10 speiler til
native `flow_areas` med samme ID-er; timeren leser native områder. Ingen parallelle
native områdeeditorer aktiveres. Senere flytting krever en egen handoff.

Første native start avslutter eventuell legacy-økt og åpent segment på samme
servertid som første native segment. Permanent `flow_timer_cutovers`-markør og
databaseguards blokkerer deretter gamle faners legacy start/resume/reopen og
direkte writes. Før første native start virker gammel timer fortsatt. Ugyldig
aktivitet ruller tilbake hele cutoveren; historisk arbeid kopieres ikke.

Historikk/edit/delete og Dag/Uke/Måned/SVG er tydelig merkede **legacy-visninger**,
uten native arbeid før #13. Gamle sessions får ingen oppdiktet historisk tidssone;
kalendergrenser ved midnatt beholdes. Legacy-korreksjoner må slutte senest ved
cutover, ikke flyttes inn i native tid. Alle gamle RPC-er beholdes. `StudyTimer`
beholdes som legacy referanse/testdekning, men monteres ikke i dashboardet.

Se [canonical backend-dokumentasjon](https://github.com/andsolste/asinfra/blob/main/supabase/README.md).
Migrations kopieres aldri hit. #12 bygger task CRUD/frister/kø; #13 kombinerer
historikk/statistikk; #7 bygger eksport; #14 flytter domenet. Lifetime task time
og full oppgaveanalyse er utsatt. Ingen hosted-, DNS- eller Auth-endringer utføres her.

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

## Beholdt Auth, organisering og legacy historikk/statistikk

- **Auth:** e-post/passord, registrering med eventuell e-postbekreftelse, lagret
  innlogging etter reload og logout. Kontoer og eierskap håndteres av Supabase.
- **Områder:** egne områder med valgfri kode kan opprettes, redigeres, arkiveres og aktiveres
  igjen. Nye økter bruker aktive områder; historiske økter kan bruke arkiverte områder.
- **Historikk:** ferdige økter hentes 25 om gangen med «Vis flere». Område, beskrivelse,
  øktgrenser og arbeidsperioder kan korrigeres; sletting krever bekreftelse.
  Bekreftede og usikre writes henter data på nytt, uten optimistisk sletting.
  Legacy-cutover og områdeendringer henter tidligere historikk/statistikk på nytt.
- **Statistikk:** dag, uke og måned i detaljpanelet, med periodevalg, total,
  mest aktive område og (for uke/måned) mest aktive dag. Browserens lokale kalender
  bestemmer grensene: midnatt, mandag og den første i måneden. Kalenderaritmetikk
  håndterer DST; en dag/uke er ikke alltid 24/168 timer. Alle sider i valgt periode
  hentes separat fra historikkens 25-raders paginering. Kun lukkede arbeidssegmenter
  telles, klippet til hver lokale dags `[start, slutt)`. Økter uten segmenter gir 0.
  Ved bytte mellom dag/uke/måned brukes i dag for en gjeldende periode, ellers dens første dag.

Diagrammene er små SVG-komponenter uten chart-bibliotek: dag viser områdefordeling,
uke viser syv stablede dagsstolper, måned viser alle kalenderdagene. Månedsdiagrammet
ruller internt på mobil. Y-aksen tilpasses dataene; null-dager beholdes. Område-ID
bestemmer farge og tekstur stabilt på tvers av perioder; teksturer skiller mange
fargekollisjoner, og «Annet» er nøytral. Områdelisten og «Vis tallgrunnlag» viser
tid som `HH:MM:SS`, uten krav om hover eller fargesyn. Beregningen beholder
millisekundene frem til visning. Like travle dager avgjøres med tidligste dato.

Historikk bruker `study_session_history`, `study_session_history_edit` og
`study_session_history_delete`. Den bevarte legacy timerkoden bruker
`study_session_transition` og `study_session_snapshot`, ikke den nye hovedtimeren.
Responsene valideres i frontend; RLS, constraints og
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
5. Åpne uten aktiv Flow-dag: 00:00:00, ingen ny rad før aktivitet velges. Åpne/lukk picker uten å starte.
6. Velg Annet: første aktivitet starter dagen. Kontroller eventuell gammel økts cutover i legacy historikk.
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
13. Pause/Fortsett på samme Flow-dag; pauser teller ikke, Fortsett åpner nytt segment.
14. Bytt til område og deretter oppgave/Annet: dagstotal fortsetter, periodetid nullstilles uten kunstig gap.
15. Refresh både running og paused. Dagsdetaljer: arbeid, start, klokketid, pause og segmenter stemmer.
16. To Flow-faner: stale pause/resume/bytte må ikke overta nyere aktivitet. Gammel legacy-fane kan ikke starte/resume etter cutover.
17. Bruk eksisterende og nyopprettet område; arkiver siste aktivitet og trykk Fortsett: gyldig nytt valg kreves. Historiske segmenter består.
18. Kontroller cutoff, sleep/reload/focus/reconnect: dagen lukkes ved lagret 04:00, og ny aktivitet starter ikke automatisk. Ny dag bruker korrekt zone/DST.

Deployrekkefølge for #11: review backend → merge backend → kontroller project-ref
og `supabase migration list` → `db push --dry-run` → godkjent `db push` → kontroller
gammel frontend før noen bruker cutover → merge frontend → smoke-test punktene over.
Ingen hosted migration eller merge utføres som del av implementasjonen.
