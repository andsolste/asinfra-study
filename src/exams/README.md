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
Lettvekts svarmarkeringer lastes automatisk fra `exam_feedback` etter lovlig innlevering, uten sensorbilder. Grønn hake/tekst viser riktige valg og rødt kryss/tekst feilvalg. Uvalgte riktige synliggjøres; nedtrekk viser riktig alternativ og antall riktige koblinger. Sensorbilder lastes fortsatt bare ved eksplisitt knappetrykk. Gamle svar fra
nettverket kan ikke vise veiledning på feil oppgave.

Øvingsmodus har ingen tidsgrense. Eksamensmodus kan vise medgått tid, forankret
i serverens start-/referansetid. Klokken leverer aldri automatisk. Original
eksamensvarighet vises som informasjon.

Backend lagrer poengregelens versjon per forsøk. Eksisterende forsøk beholder v1
(alle riktige/ellers 0), også når de gjenopptas etter migrasjonen. Nye forsøk bruker
v2: flervalg får proporsjonal positiv uttelling, −1 per feilvalg og gulv 0.
Maks poeng endres ikke. Andre automatiske typer beholder alle-felt-riktige-regelen.
Poeng og felt-/valgopptelling kommer fra serveren, ikke en klientberegning. Fire
desimaler støttes. Regelversjonen forklares i resultatet. Dette er ikke bekreftet
offisiell sensur. Langsvar og oppgave 41 beholder egenvurdering/ingen automatisk retting.

Feedback er bundet til forsøk, oppgave og svarrevisjon. Gamle nettverkssvar forkastes
ved navigasjon/ny revisjon. Feil gir eksplisitt retry uten å endre lagrede poeng eller
editorens utkast. `exam_feedback` må være deployet før denne frontenden. Den deler
backendens innleveringsport med sensorveiledningen. Ingen hosted endring utføres her.

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
