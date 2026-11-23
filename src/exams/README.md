# Eksamener

Åpnes fra **Konto → Eksamener**, på `/?app=exams`. Samme Supabase-klient/session
som Flow; ingen separat Auth, router, dependency eller backendtjeneste.
`?attempt=UUID` gjenopptar et forsøk. Til Flow går tilbake til arbeidsverktøyet.
Flow-timeren styres ikke her og fortsetter på serveren som før.

- `ExamApp.tsx`: katalog, startvalg, oppgavenavigasjon, levering og resultat.
- `QuestionView.tsx`: native radio/checkbox/textarea/select og private figurer.
- `model.ts`: generiske datatyper og separat auto-/egen-/ubesvart resultat.
- `editor.ts`: serialisert lagring, revisjoner, request-ID og recovery.
- `api.ts`: kun de nye `exam_*`-RPC-ene via eksisterende Supabase-klient.
- `exams.css`: avgrenset presentasjon med dagens Flow-farger og kontroller.

Motoren kjenner ingen DCST2001-spesifikke svar. Oppgaver kommer som data med
originale nummer, tekstblokker, figurer og felt. Nye eksamener legges til som
private versjonerte pakker i canonical backend, ikke som nye React-sider.
Modulen kan senere få egen entrypoint uten å kopiere Flow-timer/stores.

## Lagring og retting

Endringer lagres etter 800 ms uten nye tastetrykk, og før intern oppgavenavigasjon.
Lagrede svar gjenopptas etter reload; usendt tekst ligger bare i minnet. Nettleseren
advarer ved reload/forlatelse når et utkast eller usikkert skriveresultat finnes.
Det er ikke en offline-editor. Lokal lagring eller delt cache av besvarelser brukes
ikke, og hele modulen nullstilles ved kontobytte/logout.

En bakgrunnslesning kan ikke overskrive et lokalt utkast. Ved nettverksfeil sjekkes
samme request-ID mot serveren. Ved stale/ukjent resultat beholdes utkast og original
revisjon. Brukeren kan kontrollere, gjenta eksakt samme lagring, eller eksplisitt
forkaste utkastet og hente serverversjonen. Ingen automatisk rebase/overskriving.
Samtidige faner beskyttes av backendens revisjoner/låser; en ren visning oppdateres
ved fokus/retur til fanen.

Fasit etter hver oppgave krever først **Lever oppgave**, som låser svaret. Fasit
til slutt krever **Lever hele eksamenen**. Denne sperren håndheves av backend,
ikke bare UI. Sensorbilder/nøkler returneres aldri i den vanlige oppgavelesningen.
Fasit lastes først ved et eksplisitt knappetrykk etter innlevering. Gamle svar fra
nettverket kan ikke vise veiledning på feil oppgave.

Øvingsmodus har ingen tidsgrense. Eksamensmodus kan vise medgått tid, forankret
i serverens start-/referansetid. Klokken leverer aldri automatisk. Original
eksamensvarighet vises som informasjon.

Automatiske øvingspoeng krever alle riktige felter og hele riktige valgsettet per
oppgave; ellers 0. Dette er ikke en offisiell delpoeng-/trekkformel. Langsvar og
uverifiserte oppgaver kan egenvurderes full/halv/ingen eller ikke vurdert.
Ingen AI-sensur eller samlet resultatprosent. Offisiell veiledning vises som
kildebelagte originale utsnitt; disse har ikke full skjermlesertranskripsjon ennå.
Figurer kan forstørres med lokalt rulleområde uten å utvide mobilbredden.

## Innhold, kontroll og publisering

Ingen original PDF, oppgavetekst, fasit eller beskyttede figurer ligger i frontend,
`public/`, testfixtures eller bundle. Frontendtester bruker bare konstruert innhold.
DCST2001 H25-pakken (alle 40 poenggivende oppgaver og merknader) er lokal og
Git-ignorert i backendens `supabase/private/exams/`. Oppgave 41 er med, men krever
faglig bekreftelse før automatisk retting. Kobling og dra-og-slipp bruker nedtrekk.

Se canonical [backend/importdokumentasjon](https://github.com/andsolste/asinfra/blob/main/supabase/exams/README.md)
og kontrolloversikten der. Publiseringsrettigheter og tilgang per bruker må
avklares. Backendmigrasjon og privat innholdsimport må gjennomgås/godkjennes og
verifiseres før frontend merge/deployment. Ingen av disse produksjonsstegene
utføres som del av implementeringen.

Kontroll: `npm test`, `npm run typecheck`, `npm run build`, `npm run check:build`.
`tests/exams.test.mjs` dekker svar/resultat, autosave, sent svar, stale faner,
recovery og låsing. `tests/exams-ui.test.mjs` renderer de ekte native kontrollene.
Nettleserkontroll bør dekke begge rettemoduser, hver oppgavetype, figurer, reload,
flere forsøk, tastatur og 1280/390/320 px mot lokal/test-backend.
