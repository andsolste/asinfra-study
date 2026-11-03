# ASInfra Flow

Flow registrerer faktisk arbeidstid og viser områder, oppgaver, historikk og statistikk.
Produksjon: [flow.asinfra.no](https://flow.asinfra.no/), med HTTPS.
Domeneflyttingen i #14 ble gjennomført og manuelt verifisert 20. oktober 2026.
[study.asinfra.no](https://study.asinfra.no/) og
[asinfra.no/study/](https://asinfra.no/study/) er legacy-redirects direkte til Flow.
Se [sluttstatus, historisk runbook og rollback](docs/flow-domain-cutover.md).

## Offentlig produktoversikt (#19)

Appen har en offentlig oversikt før innlogging på `https://flow.asinfra.no/`.

Et førstegangsbesøk viser kort introduksjon, arbeidsdag/timer, oppgaver/områder,
statistikk og historikk/eksport. `PublicFlowOverview` bruker `FlowExamples` og
utelukkende konstruerte data fra `public-flow-example.ts`, ikke en demo-konto.
De illustrative kontrollene er tekst, ikke fungerende appknapper. Diagrammet
gjenbruker dagens rene SVG-/legend-komponenter med tekstlig tallgrunnlag.
Oversiktens CSS er avgrenset til `public-flow.css`; workspace er ikke redesignet.

Logg inn-knappene ruller til eksisterende `AuthForm` og fokuserer e-postfeltet.
Funksjonsknappen fokuserer arbeidsdagens overskrift. Ingen av dem skriver URL
query/hash eller bruker routing, slik at Supabase fortsatt kan håndtere Auth-
returer. Login, registrering, bekreftelseslenker og kuraterte feil er uendret.

`AppView` viser rolig loading mens session avklares. Bekreftet session uten feil
går direkte til `Account`; logout gir offentlig oversikt igjen. Bare `Account`
monterer de private datahookene. Uinnlogget oversikt starter ingen Flow-, område-,
oppgave-, historikk-, statistikk-, eksport- eller session-reads. Auth-klientens
vanlige sessionkontroll er fortsatt tillatt. Det åpnes ingen private API-er eller
RLS-regler. Deling, demo-login og offentlig eksport er ikke implementert.

Uten gyldig konfigurasjon kan oversikten fortsatt vises i dev/runtime, men i stedet
for login-skjema vises en tydelig konfigurasjonsfeil. Eksisterende produksjonsbuild
krever fortsatt de to offentlige konfigurasjonsverdiene; CI-regelen er uendret.

`tests/public-flow.test.mjs` renderer ekte TSX med Vites eksisterende SSR-transform
(uten ny testavhengighet eller lyttende server) og tester offentlig/session/loading/
error/config-gating, AuthForm, statiske/anonyme eksempler og fravær av private
hooks/API-importer i presentasjonen. Browser-smoke bør i tillegg dekke:

1. Åpne uten session: oversikt, ett h1/main, ingen private nettverkskall.
2. Logg inn-CTA fokuserer e-post; funksjons-CTA og skip link fungerer med tastatur.
3. Bytt til Opprett konto og tilbake; kontroller feil og eksisterende bekreftelsesflyt.
4. Login → Account, reload med session → Account uten landing, logout/reload → offentlig.
5. Kontroller 1280/768/390/320 px, diagram/legend/tallgrunnlag og ingen ytre horisontal scrolling.
6. Manglende config/sessionfeil: fortsatt offentlig innhold, ingen private data og tydelig varsel.
7. ASInfra Apps og søk viser Flow; Apps åpner `flow.asinfra.no`.
   Gamle `apps/#study` beholdes for bokmerker.

Den offentlige oversikten bruker samme Auth- og backendflyt som resten av appen.

## Navigasjon i innlogget Flow

Hovedområdene er **Arbeid**, **Oppgaver** og **Innsikt**. Arbeid beholder timer og
oppgavekø; Oppgaver er en vanlig hovedvisning. Innsikt samler Oversikt og
Arbeidslogg, med Eksporter som sekundær dialoghandling. Konto-menyen inneholder
e-post, Områder og Logg ut. På desktop brukes toppnavigasjon; under 700 px brukes
bunnnavigasjon med plass reservert under innholdet. Den skjules når skjermtastaturet
reduserer visningshøyden under redigering. ASInfra-lenken beholdes i headeren.

`flow-navigation.ts` og `useFlowNavigation` bruker History API og query-parametre:
`/` (Arbeid), `/?view=tasks`, `/?view=insights` og
`/?view=insights&section=history`. Tilbake/fram og reload gjenoppretter visningen
uten serverruter eller nye Pages-regler. Andre query-parametre og hash beholdes;
Auth-flyten og den offentlige oversikten er uendret. Ingen URL omskrives ved login/load.

`Account` eier fortsatt én langlivet arbeids-store. Timer, oppgaveutkast og
historikkredigering beholdes når en hovedvisning skjules. Eksport monteres bare
mens dialogen er åpen og avbrytes ved lukking/navigasjon som før. Dagsgrensen
forklares i Dagsdetaljer og eksisterende tidssone-/datagrunnlagsvisninger, ikke
gjentatt på normalflaten. Køsortering, API-er og backend er uendret.

På tvers av hovedvisningene viser en kompakt status arbeid som kjører, siste
aktivitet når dagen er pauset, eller at status må kontrolleres. Lenken går til
Arbeid uten å starte eller fortsette noe. Sekundærpaneler bruker native dialog
med Escape, fokusretur og Tab/Shift+Tab; innhold i lukkede detaljer er ikke tabstopp.

### Kontroll av lange timeravbrudd (#34B)

Flow kan oppdage et execution-gap på minst **30 minutter** mens en bekreftet
arbeidsperiode kjører. Dette er ikke sikker dvaledeteksjon: brukeren kan ha jobbet
i en annen app mens Flow var frosset. Begge lokale klokker brukes bare som signal.
Flow venter på en ny serverlesing startet etter observasjonen, og tilbyr kontroll
bare hvis samme dag, segment og segmentantall fortsatt kjører.

«Jeg jobbet videre» avviser observasjonen uten å skrive til backend. «Pause nå»
bruker samme serverstyrte pause som vanlig Pause. **Allerede registrert tid endres
ikke**, og ingen arbeidstid trekkes fra automatisk. Byttet aktivitet eller utløpt
dag forkaster den gamle kontrollen. Pending/recovery har fortsatt prioritet.

Ett kontobundet `sessionStorage`-hint (ID-er, segmentantall og observasjonstid)
støtter reload/discard; det er ikke en timerkilde eller aktivitetslogg. Det skrives
høyst omtrent hvert minutt, samt ved best-effort lifecycle-kontrollpunkter, og
forkastes ved pause/bytte, kontobytte/logout eller etter 48 timer. Blokkert/korrupt
storage hindrer ikke timeren. Ingen inputovervåkning eller Idle Detection brukes.
En glemt timer uten execution-gap oppdages ikke. Brukeren kan korrigere feil tid
eksplisitt; ingen gap, checkpoint eller callback bestemmer sluttiden.

### Korriger native arbeidsperioder (#34C)

Arbeidslogg → Vis tidslinje → **Rediger arbeidsperiode** samler start, slutt,
område og oppgave i ett skjema. Lagret `work_day.timezone` brukes, også etter
tidssonereise. Minuttfeltene bevarer urørte absolutte timestamps med sekunder,
mikrosekunder og riktig DST-forekomst eksakt. Et nytt minutt bruker `:00` sekunder;
nye ikke-eksisterende eller tvetydige lokale klokkeslett avvises fremfor å gjette.
Arkivert/fullført/utilgjengelig historisk tilknytning kan beholdes urørt; endret
oppgave må passe området. Samme absolutte start/slutt gir 0 min uten sletting.
Arbeidsdagens ID, dato, start, tidssone og frosne grenser kan ikke redigeres.

**Korriger tid** i avbruddsvarselet åpnes bare ved eksplisitt klikk for akkurat det
observerte åpne segmentet. Aktivitet/start er skrivebeskyttet og sluttfeltet er
tomt: brukeren velger når arbeidet faktisk sluttet. Lagring lukker perioden og
pauser Flow, uten ny aktivitet eller automatisk Fortsett. **Pause nå** er fortsatt
serverstyrt nåtid og endrer ikke allerede registrert arbeid.

`NativeSegmentCorrection` skiller frosne `expected`-verdier fra `desired` for
start/slutt/område/oppgave. Bare RPC-en `flow_work_segment_correct` skriver; ingen
direkte tabelloppdatering brukes. Feil vises kuratert, dobbeltlagring sperres og
vanlig valideringsfeil beholder utkastet. Conflict/usikkert resultat sperrer videre
lagring til editoren åpnes på nytt fra ferske data. Ved mistet svar leses snapshot
og sammenlignes med ønsket tilstand; klienten sender aldri automatisk et rebased kall.
Historikk, valgt statistikk/område og arbeids-store/katalog hentes på nytt.
Task-total, rapport og eksport leser fortsatt canonical segmenter, ikke egne
«korrigerte summer». Eksport åpnes på nytt for ferskt grunnlag; et eksisterende
manifest avviser endrede data i stedet for å blande før/etter korreksjonen.

**Deployment dependency:** canonical migration
`asinfra/supabase/migrations/20261022170000_add_flow_segment_correction.sql` må
gjennomgås og deployes før denne frontenden. Hosted migration krever separat
godkjenning; den kjøres ikke av frontend eller Pages.

### Arbeid: Nå, Neste og Etterpå (#27C)

Arbeidsperioden og Pause/Fortsett er primære; dagens total og Dagsdetaljer er
sekundære. Arbeid bruker to kolonner fra 1100 px, ellers én. En pauset, fortsatt
gyldig aktivitet beholdes som Nå, med tiden i siste arbeidsperiode. Utilgjengelig
siste aktivitet får i stedet et tydelig valg av ny aktivitet.

`flow-recommendations.ts` utleder én Neste og opptil tre Etterpå fra eksisterende
`taskQueue()` og `activityUsable()`. Aktiv/gyldig pauset oppgave utelates, sammen
med fullførte oppgaver og oppgaver i arkiverte/utilgjengelige områder. Dette er
fristbasert sortering, ikke lagret prioritet eller planlegging. Forfalt-tallet
teller **alle aktive forfalte oppgaver**, også Nå og oppgaver som må redigeres før
de kan startes; knappen går til den fulle Oppgaver-visningen. Ingen data endres.

Start/Bytt til bruker samme `startActivityCommand` og arbeids-store som timeren.
Opprett oppgave går direkte til eksisterende TaskForm i Oppgaver. Ulagrede
skjemaer beholdes ved vanlig navigasjon; eksplisitt åpning av et annet/nytt skjema
krever bekreftelse før et eksisterende utkast forkastes. En pågående/usikker
lagring viser det opprinnelige skjemaet til arbeids-store-en har kontrollert svaret.

### Oppgaver og Områder (#27D)

Oppgaver grupperes i **Forfalt**, **Kommende frister** og **Uten frist**. Fristen
er ikke en planlagt arbeidsdato. `flow-task-list.ts` deler eksisterende
deterministiske køsortering i grupper; fullførte oppgaver ligger kollapset og
sorteres etter faktisk fullføringstid. Områdefilteret endrer bare visningen og
inkluderer arkiverte, manglende og områdeløse oppgaver. Lokalt søk er bevisst
utelatt: grupper og ett enkelt filter gir oversikt uten enda en kontroll.

Arkiverte/utilgjengelige områder merkes i den vanlige fristgruppen, uten å
duplisere eller skjule oppgaven. Den kan åpnes, redigeres, flyttes til et aktivt
område/Annet og fullføres. Start/Bytt til bruker eksisterende aktivitetkommando
og arbeids-store. Pågående oppgave viser Pågår, ikke en deaktivert startknapp.
Detaljer, arbeid i dag/total, fullføring/gjenåpning og TaskForm bruker de samme
API-ene, ID-ene, originalrevisjonene og presisjons-/recoveryreglene som før.
Fokus flyttes til tittel ved oppretting/redigering, og tilbake til detalj/listen
etter lagring eller avbryt. Utkast beholdes ved hovednavigasjon.

Områder ligger fortsatt under Konto. En kompakt liste har Rediger/Arkiver;
arkiverte områder ligger kollapset med Aktiver igjen. Arkivering bekreftes når
arbeids-store-ens katalog viser aktive oppgaver i området. Canonical backend
sin `flow_subject_bridge` oppdaterer bare området, ikke oppgavene: de beholdes,
men nytt arbeid i arkivert område avvises. Eksisterende område-hook og etterfølgende
katalogoppdatering brukes fortsatt. Ingen migrations eller databasenavn endres.

**Senere vurdering:** Et eget issue for serverlagret manuell prioritering er
nyttig dersom brukeren skal kunne velge «Sett som neste» uavhengig av frist.
Det bør støtte Flytt opp/ned med tastatur/mobil, ikke bare dra-og-slipp. Frister
eller browser-only localStorage skal ikke brukes som skjult prioritet. Dette
er ikke implementert her; Arbeid beholder den fristbaserte anbefalingen fra 27C.

### Innsikt: Oversikt, Arbeidslogg og Eksport (#27E)

Oversikt viser valgt periode, total arbeidstid, områder og diagram med tekstlig
tallgrunnlag. Dag/Uke/Måned/Totalt og områdedetaljenes fire summer/oppgavebidrag
bruker samme API-er og beregninger som før. Arkiverte områder merkes diskret.
Tomme perioder viser null og tallgrunnlag uten et tomt diagram. Tidssoner og
gruppering ligger under Avansert nederst; native lagret tidssone og eldre datas
visningstidssone har fortsatt ulike roller.

Arbeidslogg viser avsluttede Flow-dager og tydelig merkede eldre registreringer,
nyeste først. Hver native dag har dato, arbeidstid og en kort områdeoversikt;
lagret tidssone, start/slutt og `dayTimeline()` ligger under Vis tidslinje.
Korrigering av native perioder bruker den samlede editoren fra #34C med forventede
originalverdier, uten å endre arbeidsdagens identitet. Eldre registreringer beholder
HistoryForm og bekreftet sletting. Fokus returneres til handling/rad etter
redigering og til første nye rad etter Vis flere.

Historikken er fortsatt cursorbasert, opptil 25 poster per kall. Den filtreres
**ikke** på klienten etter statistikkperioden. En fullstendig periodefiltrert
arbeidslogg krever senere API-/backendarbeid; innlastede sider må ikke fremstilles
som en komplett periode.

Eksporter forblir en sekundær handling i Innsikt. Dialogen starter med
`history.period` og visningstidssonen fra Oversikt, men har eget periodevalg.
CSV for videre analyse og rapport for visning/utskrift/PDF er skilt tydelig.
Avansert datagrunnlagsinformasjon er kollapset. Eksport-store, frosset grunnlag,
cursor-validering, avbrudd/discard, CSV-sikkerhet og print-portalen er uendret.

### Arbeidstid og minuttvisning (#30)

Flow arbeidstid er summen av faktiske arbeidssegmenter. Pauser og gap teller ikke.
UI viser fullførte hele minutter, f.eks. `0 min`, `42 min` og `1 t 5 min`.
Gulving skjer først etter at presis varighet er aggregert, ikke per segment.
Derfor kan en total avvike fra summen av de viste, gulvede rad-minuttene.

`time-precision.ts` parser absolutte ISO-timestamps til eksakte mikrosekunder
(`bigint`). Differanser, klipping og summering beholder denne presisjonen;
ved grensen til eksisterende Number-API-er gulves **aggregatet** til hele
millisekunder. Det gjør aldri 59 999 999 µs til 60 000 ms. Legacy-sammendrag
summerer også mikrosekunder på tvers av økter/områder/dager før konvertering.
Rå timestamps endres ikke. UI bruker én minuttformatter med en presis BigInt-
adapter for CSV. Statistikkens RPC-verdier og skala beholdes uendret.

Vanlige klokkeslett vises uten sekunder. Intern sekundtick, serverankret nåtid,
cutoff og recovery beholdes. Elapsed brukes fortsatt internt til pauseberegning,
men «Total klokketid» vises ikke i normale dagsdetaljer.

## Arkitektur og repoansvar

- **[andsolste/asinfra-study](https://github.com/andsolste/asinfra-study)** eier
  React/TypeScript/Vite-frontenden, frontendtestene og Pages-deploymenten.
  Produksjonsdomenet er `flow.asinfra.no`.
- **[andsolste/asinfra/supabase](https://github.com/andsolste/asinfra/tree/main/supabase)**
  er canonical backend: config, migrations, RLS, constraints, RPC-er og backendtester.
  Database- og RLS-endringer gjøres med egen PR/review der, aldri i dette repoet.
- **[andsolste/asinfra-study-redirect](https://github.com/andsolste/asinfra-study-redirect)**
  eier kun legacy-inngangen `study.asinfra.no` og videresender til Flow.

Begge bruker samme eksisterende Supabase-prosjekt/Auth. Brukere, ID-er og data er
beholdt. Ikke opprett et nytt prosjekt eller kopier backendmigrasjoner hit.
Frontend ble opprinnelig trukket ut av hovedrepoet; den gamle
`https://asinfra.no/study/` er nå bare en legacy redirect direkte til Flow.
Domeneflyttingen krevde ingen data-, bruker- eller backendmigrasjon.

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
klippet til cutoff. Dagsdetaljer viser arbeid, start, cutoff, pause og segmenter.
Ingen vanlig Stopp-knapp finnes: Pause er nok.
Ved cutoff kan sist avsluttede dag i denne fanen fortsatt sees i dagsdetaljer,
med serverbekreftet ended_at; hovedtiden er likevel 0 min uten aktiv dag.
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
Migrations kopieres aldri hit. Eksport beskrives nedenfor. Domeneflyttingen i #14
er gjennomført uten backendendring; frontend-deployment kjører ikke migrations.

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

`20261019090000_add_flow_history_statistics.sql` og #13-frontenden er deployet.
Eksport er en separat, additiv avhengighet beskrevet nedenfor.

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
aktivitet. Dagens aktive dag ligger fortsatt ved timeren. Native korreksjon bruker
`flow_work_segment_correct` fra #34C; den eldre `flow_history_attribute` beholdes
for kompatibilitet. Dagidentitet og frosne grenser kan ikke endres; native sletting
tilbys ikke.
Eldre økter beholder full editor og bekreftet sletting; den nye editoren bruker
`flow_history_edit_legacy` som atomisk avviser overlapp med andre registreringer.
Bekreftede og usikre writes etterfølges av ny lesing av historikk og statistikk;
ingen optimistisk sletting/suksess. Feilet recovery sperrer blind gjentakelse.

### Flow v1, fase #7: lokal CSV og arbeidsrapport

**Før denne frontenden tas i bruk:** review/deploy canonical
`20261019140000_add_flow_export.sql` i `andsolste/asinfra`. Denne PR-en verken
merger, deployer hosted schema eller lukker #7. Ingen migration kopieres hit.

`Eksporter` åpnes som en sekundær dialoghandling i Innsikt. `FlowExport` / `useFlowExport`
har en liten, separat `flow-export-store.ts`: bare eksplisitte brukerhandlinger
henter eksportdata. Periodehjelpere og display timezone deles med eksisterende
Flow; ingen ny kalender-, timer- eller statistikkmotor innføres.

**CSV:** `flow_export_start(kind, date, timezone)` returnerer første 500 rader,
serverbestemt periode/referansetid, statistikk og neste markør. Deretter kalles
`flow_export_rows({job, after}, 500)` til markøren er null. Én rad er et positivt
arbeidsslice innen én logisk dag. Native følger lagret dato/zone/cutoff/område/task;
legacy deles ved lokal 04:00 i eksplisitt displayzone. Gyldig IANA-zone kreves
også for Totalt CSV, men den samlede arbeidstiden er fortsatt tidssoneuavhengig.

Backend fryser referansetiden i et 30-minutters manifest. Åpent arbeid klippes
til dette tidspunktet. En stabil ordinalmarkør er bundet til manifestets digest
av alle ordnede rader/metadata: historisk korreksjon, sletting eller navneendring
avbryter med «start på nytt», i stedet for å blande dataversjoner. Normal vekst/
pause/bytte etter referansetiden endrer ikke de klippede radene. Dette er **ikke**
en bevart historisk MVCC-snapshot: alle sider kontrolleres mot manifestet på nytt.
Det prioriterer korrekthet fremfor maksimal hastighet for svært store datasett.

Filen bygges først når alle sider, ordinaler, identiteter og eksakt varighet er
kontrollert mot startresponsens statistikk. Ingen delvis fil ved feil eller
avbrudd. Hver lesing har 30 sekunders timeout. Ny jobb, periodeskifte, Lukk og
logout/unmount avbryter gamle svar. Manifest slettes best-effort ved slutt;
backend avviser utløpte jobber og rydder egne utløpte ved neste eksportstart.
CSV lagres bare som lokal Blob, med object URL som revokes etter nedlasting.

#### CSV-kontrakt

Kolonnerekkefølge: **Kilde, Flow-dato, Tidssone, Tidssonegrunnlag, Start, Slutt,
Arbeidstid, Arbeidstid sekunder, Område, Områdekode, Områdestatus, Oppgave,
Oppgavestatus, Oppgavefrist, Beskrivelse**.

- UTF-8 med BOM, komma, CRLF og doble anførselstegn rundt tekst; innebygde quotes
  dobles. Komma, linjeskift, norsk tekst og emoji beholdes. Ved norsk Excel-import
  velges UTF-8 og komma som delimiter dersom programmet ikke oppdager det selv.
- Start/slutt/frist er absolutte ISO-8601-tidsstempler med offset, eksportert i UTC.
  Flow-dato er `YYYY-MM-DD`; separat IANA-zone og grunnlag skiller lagret native
  zone fra legacy visningspolicy. Navn/status/frist/beskrivelse er **nåværende**
  tilgjengelige metadata, ikke historiske snapshots. Historisk område følger segmentet.
- `Annet` for null område, `Uten oppgave` for native uten task og
  `Uten oppgave / eldre registrering` for legacy. Ingen description→task matching.
  Arkiverte områder/fullførte tasks beholdes. UUID-er, e-post og Auth-data utelates.
- Varigheter summeres med heltallsmikrosekunder (`BigInt`). «Arbeidstid» er nå
  menneskelesbar minutttekst, ikke det tidligere `HH:MM:SS`-formatet.
  «Arbeidstid sekunder» beholder presis maskinlesbar verdi med opptil seks desimaler.
  ISO-timestamps, RPC-feltet `work_microseconds` og kolonnerekkefølgen er uendret.
  Filnavn: `flow-YYYY-MM-DD.csv`, `flow-2026-10-19_til_2026-10-25.csv`, `flow-YYYY-MM.csv`
  eller `flow-total.csv`, uten kontoopplysninger. Tom eksport gir bare header.
- `csvText` nøytraliserer potensielle formler, også etter whitespace/kontrolltegn
  og fullbreddevarianter av `= + - @`, med **apostrof + tabulator** før original
  tekst i det quotede tekstfeltet. Numeriske varigheter endres ikke. Prefikset er
  bevisst synlig ved noen importer. Quoting alene er ikke et vern; senere vilkårlig
  save/re-import kan fjerne vern og må vurderes separat. Se
  [OWASP CSV Injection](https://community.owasp.org/attacks/CSV_Injection).

#### Rapport og PDF

`flow_statistics` er eneste kilde til rapporttotaler, områder, daglige summer og
bidrag. `FlowReport` har egne presentasjonstabeller, men gjenbruker dagens SVG,
områdefarger og mønstre. Dag/Totalt viser områdefordeling; Uke/Måned viser dager
og en kompakt dagstabell. Totalt lager ikke en søyle for hver dag i levetiden.
Generert-tidspunkt kommer fra serveren. Rapporten inneholder ikke e-post/UUID.

Forhåndsvis rapporten og velg **Skriv ut / Lagre som PDF**. En print-only portal
utenfor modal/app-shell og lys `@media print` skjuler navigation, backdrop og
kontroller, fjerner månedsdiagrammets scrollbredde og gjentar tabellheadinger.
Velg A4/Letter i browserens vanlige utskriftsdialog; ingen PDF-/chart-avhengighet.
Print-preview og Excel/Sheets-import må sluttkontrolleres i vanlig browser før
produksjon; den innebygde testbrowseren ga ikke tilgang til full utskriftsdialog.

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
  Native har samlet periodeeditor; bare eldre registreringer har sletting.
- **Statistikk:** Dag/Uke/Måned/Totalt under Innsikt → Oversikt, med total, mest aktive område
  og (for uke/måned) mest aktive dag. Områdenavn i listen åpner områdedetaljer.
  Ved bytte mellom dag/uke/måned brukes i dag for en gjeldende periode, ellers dens første dag.

Diagrammene er små SVG-komponenter uten chart-bibliotek: dag viser områdefordeling,
uke viser syv stablede dagsstolper, måned viser alle kalenderdagene. Månedsdiagrammet
ruller internt på mobil. Y-aksen tilpasses dataene; null-dager beholdes. Område-ID
bestemmer farge og tekstur stabilt på tvers av perioder; teksturer skiller mange
fargekollisjoner, og «Annet» er nøytral. Områdelisten og «Vis tallgrunnlag» viser
tid i fullførte minutter, uten krav om hover eller fargesyn. Beregningen bruker
råverdier frem til presentasjon. Like travle dager avgjøres med tidligste dato.

Legacy-sletting bruker fortsatt `study_session_history_delete`. De tidligere
read/edit-RPC-ene beholdes for gamle klienter. Den bevarte legacy timerkoden bruker
`study_session_transition` og `study_session_snapshot`, ikke den nye hovedtimeren.
Responsene valideres i frontend; RLS, constraints og
RPC-er i canonical backend er sikkerhetsgrensen og begrenser data til `auth.uid()`.

Redigering viser lokal tid med **hele minutter** (`step="60"`). Et felt som fortsatt
matcher det viste minuttet i originalen, sender det opprinnelige absolutte
tidsstempelet uendret, inkludert sekunder/mikrosekunder. Et faktisk endret minutt
konverteres til ISO med `:00` sekunder, uten manuell offsetforskyvning. Tidspunkter som ikke
finnes ved tidsomstilling, og nye tvetydige klokkeslett, avvises. Uendrede felt i
en gjentatt time beholder den opprinnelige forekomsten.

## CI, deployment og Auth-retur

`.github/workflows/pages.yml` kjører `npm ci`, tester, typecheck, build og
`check:build` på PR-er mot `main`. Push til `main` eller manuell kjøring på `main`
gjør samme kontroll og publiserer **kun `dist/`** til GitHub Pages.
Kildekode, dependencies, env-filer og backend publiseres ikke.

Pages bruker **Source: GitHub Actions**, **Custom domain: flow.asinfra.no** og HTTPS.
Ingen `CNAME` spores her; domain styres i Pages settings for Actions-publisering.
Repository variables under **Settings → Secrets and variables → Actions →
Variables** er `VITE_SUPABASE_URL` og `VITE_SUPABASE_PUBLISHABLE_KEY`.
CI feiler tydelig hvis de mangler. DNS/Auth endres ikke av workflowen.

Auth-bekreftelseslenker bruker gjeldende origin + Vites base, uten hardkodet
produksjonsdomain. Supabase **Site URL er `https://flow.asinfra.no/`**.
Redirect URLs skal tillate Flow; Study, `http://localhost:5173/`,
`http://localhost:4173/` og andre nødvendige app-/legacy-returer kan fortsatt
beholdes. Les hele listen før fremtidige endringer; ikke erstatt andre appers
returer. Login, reload/session, logout, eksisterende data og signup/e-postbekreftelse
på Flow ble manuelt verifisert ved cutover 20. oktober 2026.

`check:build` skiller canonical/`og:url` fra assets og kontrollerer både Flow-
metadata og faktiske root-baserte JS/CSS-filer. Configtestene beholder legacy,
localhost og preview i tillegg til ny Flow-origin. Dette tester ikke hosted Auth.

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

Eksporttester dekker CSV, formula-vern, presisjon, paging, feil/avbrudd/retry,
stale svar og fire rapportperioder. Backend tester over 1100 rader, DST, RLS og
frosset referansetid separat. Dette er ikke hosted JWT-/flerforbindelsesverifisering.
Den offentlige oversikten (#19) er beskrevet øverst; ekte arbeidsdata krever
fortsatt Auth. Domeneovergangen (#14) ble gjennomført 20. oktober 2026;
deling/cloud upload, mål og streaks er utenfor.

## Produksjonssjekkliste etter merge/deploy

Bruk to egne testkontoer (A/B) og merkede testdata, ikke credentials i Git.
Automatiserte tester erstatter ikke denne kontrollen mot ekte Auth/RLS:

1. Åpne **https://flow.asinfra.no/** over HTTPS; ingen asset-404 eller konsollfeil.
   Kontroller også legacy-inngangene ved endringer i navigasjon/hosting.
2. Test login, reload av innlogging og logout.
3. Kontroller Flow-branding, eksisterende egne områder og historiske økter.
4. Opprett/rediger/arkiver et testområde og aktiver det igjen.
5. Åpne uten aktiv Flow-dag: 0 min, ingen ny rad før aktivitet velges. Åpne/lukk picker uten å starte.
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
15. Refresh både running og paused. Dagsdetaljer: arbeid, start, cutoff, pause og segmenter stemmer.
16. To Flow-faner: stale pause/resume/bytte må ikke overta nyere aktivitet. Gammel legacy-fane kan ikke starte/resume etter cutover.
17. Bruk eksisterende og nyopprettet område; arkiver siste aktivitet og trykk Fortsett: gyldig nytt valg kreves. Historiske segmenter består.
18. Kontroller cutoff, sleep/reload/focus/reconnect: dagen lukkes ved lagret 04:00, og ny aktivitet starter ikke automatisk. Ny dag bruker korrekt zone/DST.

19. Kontroller blandet historikk over flere sider, direkte bytter uten pausegap,
    siste pause og arbeid etter midnatt på riktig lagret Flow-dato.
20. Åpne område og Annet: kontroller fire summer, oppgaver og eldre arbeid uten
    oppgave. Flyttet/fullført oppgave skal beholde segmentets historiske område.
21. Korriger native start/slutt/tilknytning; dagidentitet/grenser må være uendret. Test eldre edit
    med overlapp, avvisning, og mistet svar etter lagring; alle lesinger må oppdateres.
22. Bytt displayzone, også ugyldig/manglende; native dato skal ikke flyttes.
    Test 03:59:59/04:00, DST, uke-/måned-/årsskifte, tom periode og Totalt uten sone.
23. Mens annen fane bytter/pause/fullfører: les statistikk og kontroller at ingen
    halv transition telles dobbelt. Test dette med ekte JWT/Data API og flere DB-
    forbindelser i lokal/test-Supabase; WASM-/mocktestene beviser ikke nettverkslaget.

### Eksport: 24 punkter før produksjonsgodkjenning

Bruk merkede testdata; store eksporter og nettverksfeil simuleres i lokal/test-
Supabase, ikke ved å forstyrre reelt arbeid. Kontroller også gamle funksjoner over.

1. Eksport åpner fra detaljhandlingene; Tab/Esc/Lukk fungerer.
2. Dag CSV: riktige lagrede Flow-datoer og positivt arbeid.
3. Uke CSV: mandag–søndag, også segment over 04:00-grensen.
4. Måned CSV: riktig kalender, årsskifte og DST.
5. Totalt CSV: begge kilder og hele bevart historikk, ikke første 1000 rader.
6. Importer i Excel og Sheets med UTF-8/komma; farlige formelceller er tekst.
7. Kontroller norsk tekst, emoji, komma, quotes og linjeskift.
8. Summer numeriske sekunder mot statistikk ved samme referansetid; ikke summer avrundet klokkevisning.
9. Annet har forståelig navn, uten konstruert område-ID.
10. Navngitt/arkivert område og historisk segmenttilknytning er beholdt.
11. Task-tittel/status/frist er nåværende metadata, også completed; uten task er eksplisitt.
12. Legacy har beskrivelse og displayzone, men ingen oppdiktet task/historisk zone.
13. Dag-rapport har total, områder, bidrag og 04:00-note.
14. Uke-rapport har syv dager, mest aktiv dag og riktige summer.
15. Måned-rapport har alle datoer og printvennlig dagstabell.
16. Total-rapport har ingen livslang dagsserie eller e-post/interne ID-er.
17. Chromium print-preview: A4 portrait/landscape og Letter; bare rapport, ingen backdrop/kontroller.
18. Lagre PDF; kontroller sideskift, diagram/legend, tabellbredde og lange navn.
19. 1280/390/320 px: ingen ytre horisontal scrolling; alle handlinger er tilgjengelige.
20. Tom dag/uke/måned/konto/Totalt: 0-rapport og CSV med bare header.
21. Over 1000 rader, tre sider: ingen tap/duplikater; åpent arbeid fryses ved eksportstart.
22. Avbryt, Lukk, logout og ny eksport: sent svar må ikke laste ned gammel fil.
23. Feil midtveis eller korrigerte data: ingen delvis fil; Prøv igjen starter ny jobb.
24. Ekte JWT/Data API med konto A/B og flere forbindelser: ingen innsyn i annen brukers jobb/data.

Deployrekkefølge for #7: review backend → merge backend → kontroller project-ref
og `supabase migration list` → `supabase db push --dry-run` → særskilt godkjent
`supabase db push` → smoke-test dagens Flow/timer/tasks/historikk/statistikk/RLS
med gammel frontend → merge frontend → eksportkontrollen over. Ingen hosted
migration, merge eller lukking av #7 utføres som del av implementasjonen.
