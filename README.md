# ASInfra Flow

Flow registrerer faktisk arbeidstid og viser områder, oppgaver, historikk og statistikk.
Flow er foreløpig publisert på [study.asinfra.no](https://study.asinfra.no/) under
Flow v1-overgangen. Domenet, Pages og Supabase Auth-returer beholdes.

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

Fundamentet `20261012180000` og native timer/cutover `20261013090000` er deployet.
Ingen stille fallback til legacy timer brukes dersom nødvendig backend mangler.

`Account` → én delt `useFlowWorkDay` → `flow-work-store.ts` / `flow-work.ts` er
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
Denne lokale detaljreferansen lagres ikke over logout/fresh reload. Avsluttede
native dager finnes også i den samlede Flow-historikken beskrevet nedenfor.

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

Historikk/statistikk leser nå begge kilder uten å kopiere arbeid. Eldre sessions
får ingen oppdiktet historisk tidssone. Legacy-korreksjoner må slutte senest ved
cutover, ikke flyttes inn i native tid. Alle gamle RPC-er beholdes. `StudyTimer`
beholdes som legacy referanse/testdekning, men monteres ikke i dashboardet.

Se [canonical backend-dokumentasjon](https://github.com/andsolste/asinfra/blob/main/supabase/README.md).
Migrations kopieres aldri hit. #7 bygger eksport; #14 flytter domenet.
Ingen hosted-, DNS- eller Auth-endringer utføres her.

### Flow v1, fase #12: oppgaver, frister og arbeidskø

Oppgavemigrasjonen `20261013120000_add_flow_tasks.sql` er deployet i canonical
backend. Oppgaver bruker `flow_task_save` og `flow_task_status`, med eksisterende
RLS og native segmenter. Den eldre `flow_task_time`-RPC-en beholdes kompatibel.

`TaskQueue`, `Tasks` og `FlowTimer` deler samme store, katalog, serverklokke og
recovery via `Account`. `flow-activity.ts` bygger én felles start/bytte-kommando;
Start fra køen bruker samme atomiske timer-RPC som aktivitetsvelgeren.
Oppgave-writes går gjennom `flow-tasks.ts` og samme stores serialiserte dispatch.
Etter writes leses både timer og katalog på nytt, uten separate task-cacher.
Mistet svar reconciles ved read; ved også mislykket read beholdes samme kommando
for eksplisitt retry. Nye oppgaver beholder create-UUID ved retry.

Køen viser inntil fem aktive oppgaver. Full visning ligger i Oppgaver-panelet:
ny/rediger, fullfør/gjenåpne og sammenleggbare fullførte oppgaver. Sortering er
eldste forfalte frist → nærmeste kommende frist → uten frist, med `created_at`
og `id` som stabil tie-breaker. Katalogen hentes i sider à 500 slik at API-ens
radgrense ikke skjuler eldre oppgaver. Ingen automatisk fullføring skjer ved frist.

Frist velges som lokal dato/tid og lagres absolutt. Eksisterende DST-helper
avviser ikke-eksisterende/gjentatte nye klokkeslett og bevarer uendret original
presisjon. Visningen bruker lokale kalenderdatoer for i dag/i morgen; forfalt
viser hele elapsed 24-timersdager, ellers hele timer/under én time. Andre datoer
viser dato og klokkeslett. Fristen er uavhengig av arbeidsdagens 04:00-grense.

Fullføring av nåværende oppgave lukker perioden serverstyrt og pauser dagen.
Gjenåpning starter ikke arbeid. Området kan først flyttes når oppgaven ikke har
åpen periode; historiske segmenter beholder opprinnelig område. Arkivert område
hindrer Start, men oppgaven kan redigeres/fullføres/flyttes til aktivt område eller Annet.

Detaljer viser nåværende periode og dagens sum fra native snapshot. Totalen
hentes med en eierbegrenset aggregasjons-RPC og viser tidspunkt for siste kontroll;
Oppdater total henter ny sum. Pause og legacy beskrivelser teller aldri som task-tid.
Task-total og dagens sum bruker samme leselag som øvrig Flow-statistikk.

### Flow v1, fase #13: samlet historikk og statistikk

**Ny avhengighet: `20261019090000_add_flow_history_statistics.sql` i canonical
backend må reviewes og deployes før denne frontenden merges/deployes.** Denne
implementasjonen deployer ikke hosted migrations og lukker ikke #13.

`Account` deler én `useFlowHistory` / `flow-history-store.ts` mellom historikk og
statistikk. Dette er et separat leselag, ikke en ekstra timer-/task-store.
`flow-history.ts` og `flow-statistics.ts` validerer RPC-svar. Historikk, valgt
periode og områdedetaljer har uavhengige, avbrytbare forespørsler; sene svar kan
ikke erstatte nyere valg. Åpning av panel, endring av timer/oppgaver/områder,
korreksjon og manuell oppdatering henter berørte tall på nytt. Ingen polling
hvert sekund: åpne segmenter telles ved oppgitt serverkontroll, ikke som en
ekstra live-timer i diagrammet.

- `flow_history`: én global keyset-markør over native dager og avsluttede eldre
  registreringer, 25 om gangen. Identitet er `source:id`; originalt timestamp med
  mikrosekunder, source og UUID sendes uendret tilbake som neste markør.
- `flow_statistics`: Dag/Uke/Måned/**Totalt** aggregeres på serveren. Totalt laster
  ikke ned all råhistorikk og har ingen dagsserie eller kunstig datointervall.
- `flow_area_statistics`: I dag/Denne uken/Denne måneden/Totalt og oppgavebidrag
  for valgt område, også Annet. Legacy vises som «Uten oppgave / eldre registrering».
  Oppgavebeskrivelser matches aldri til legacy arbeid.

Native arbeid grupperes på **lagret `logical_date`**, tidssone og 04:00-grenser,
selv etter tidssonereise. Uke er mandag–søndag, måned følger kalenderen. Gjeldende
periode og oppgavens «I dag» bruker den lagrede nåværende dagen når den finnes.
Legacy mangler historisk tidssone: visningen har et eksplisitt IANA-valg (browserens
sone i utgangspunktet), med 04:00 → neste 04:00 og splitting av grensekryssende
segmenter. Dette er en visningspolicy, ikke historiske metadata eller backfill.
Ugyldig/manglende sone gir tydelig varsel; native data og tidssoneuavhengig Totalt
beholdes. Ingen norsk standardsone gjettes. PostgreSQL beregner hver kalendergrense
separat, også 23/25-timersdager. Frontend flytter rene datoer, ikke 24-timersblokker.

Begge kilder summerer faktiske segmenter én gang, uten pauser/session-envelope.
Åpne segmenter klippes til samme serverklokke og lagret cutoff. Områder bruker
felles stabile UUID-er og dagens metadata; historisk tilknytning kommer fra
segmentet, aldri oppgavens nåværende område. `NULL` er nøytralt Annet.

Native tidslinje viser arbeidsperioder, direkte bytter, pauser mellom arbeid og
siste pause frem til avslutning/cutoff. Den finner ikke på en pause før første
aktivitet. Dagens aktive dag ligger fortsatt ved timeren. Native korreksjon er
bevisst begrenset til **område/oppgave på avsluttede perioder i en avsluttet dag**
via `flow_history_attribute`, med forventet gammel tilknytning. Dagidentitet,
frosne grenser og tidsstempler kan ikke endres; native sletting tilbys ikke.
Eldre økter beholder full editor og bekreftet sletting; den nye editoren bruker
`flow_history_edit_legacy` som atomisk avviser overlapp med andre registreringer.
Bekreftede og usikre writes etterfølges av ny lesing av historikk og statistikk;
ingen optimistisk sletting/suksess. Feilet recovery sperrer blind gjentakelse.

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

## Beholdt Auth, organisering og presentasjon

- **Auth:** e-post/passord, registrering med eventuell e-postbekreftelse, lagret
  innlogging etter reload og logout. Kontoer og eierskap håndteres av Supabase.
- **Områder:** egne områder med valgfri kode kan opprettes, redigeres, arkiveres og aktiveres
  igjen. Nye økter bruker aktive områder; historiske økter kan bruke arkiverte områder.
- **Historikk:** native dager og eldre økter deler én kronologisk liste med «Vis flere».
  Bare eldre registreringer har full tidseditor/sletting; native har begrenset tilknytning.
- **Statistikk:** Dag/Uke/Måned/Totalt i detaljpanelet, med total, mest aktive område
  og (for uke/måned) mest aktive dag. Områdenavn i listen åpner områdedetaljer.
  Ved bytte mellom dag/uke/måned brukes i dag for en gjeldende periode, ellers dens første dag.

Diagrammene er små SVG-komponenter uten chart-bibliotek: dag viser områdefordeling,
uke viser syv stablede dagsstolper, måned viser alle kalenderdagene. Månedsdiagrammet
ruller internt på mobil. Y-aksen tilpasses dataene; null-dager beholdes. Område-ID
bestemmer farge og tekstur stabilt på tvers av perioder; teksturer skiller mange
fargekollisjoner, og «Annet» er nøytral. Områdelisten og «Vis tallgrunnlag» viser
tid som `HH:MM:SS`, uten krav om hover eller fargesyn. Beregningen beholder
millisekundene frem til visning. Like travle dager avgjøres med tidligste dato.

Legacy-sletting bruker fortsatt `study_session_history_delete`. De tidligere
read/edit-RPC-ene beholdes for gamle klienter. Den bevarte legacy timerkoden bruker
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
testes i flere tidssoner. Den aktive leseflyten ligger i `flow-history.ts`,
`flow-statistics.ts` og `flow-history-store.ts`. `statistics.ts` beholder felles
SVG-skala/farger/teksturer og gamle kalenderhjelpere for kompatibilitetstester;
legacy midnattstester er ikke kontrakten for Flow. Nye tester dekker 04:00-policy,
rå cursor-presisjon, begge kilder, nullable områder, Totalt og stale-/feil-recovery.
SDK/nettverk simuleres: dette verifiserer ikke ekte hosted Auth eller RLS.
Database-/RLS-testene eies av [canonical backend](https://github.com/andsolste/asinfra/tree/main/supabase/tests).

Eksport (#7), domeneovergang (#14), mål og streaks er utenfor
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
7. Velg dag/uke/måned/totalt og forrige/neste/gjeldende periode; kontroller diagram,
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

19. Kontroller blandet historikk over flere sider, direkte bytter uten pausegap,
    siste pause og arbeid etter midnatt på riktig lagret Flow-dato.
20. Åpne område og Annet: kontroller fire summer, oppgaver og eldre arbeid uten
    oppgave. Flyttet/fullført oppgave skal beholde segmentets historiske område.
21. Korriger native tilknytning; tidspunkter/dag må være uendret. Test eldre edit
    med overlapp, avvisning, og mistet svar etter lagring; alle lesinger må oppdateres.
22. Bytt displayzone, også ugyldig/manglende; native dato skal ikke flyttes.
    Test 03:59:59/04:00, DST, uke-/måned-/årsskifte, tom periode og Totalt uten sone.
23. Mens annen fane bytter/pause/fullfører: les statistikk og kontroller at ingen
    halv transition telles dobbelt. Test dette med ekte JWT/Data API og flere DB-
    forbindelser i lokal/test-Supabase; WASM-/mocktestene beviser ikke nettverkslaget.

Deployrekkefølge for #13: review backend → merge backend → kontroller project-ref
og `supabase migration list` → `db push --dry-run` → godkjent `db push` → kontroller
eksisterende timer, tasks og RLS med gammel frontend → merge frontend → smoke-test punktene over samt
opprett/rediger/frister, start/bytte fra kø, fullføring mens running, gjenåpning,
områdeflytting etter pause, arkivert område, task-tid og refresh/recovery i to faner.
Ingen hosted migration eller merge utføres som del av implementasjonen.
