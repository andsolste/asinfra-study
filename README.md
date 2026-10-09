# ASInfra Study

Study registrerer studiearbeid og viser faktisk arbeidstid, historikk og ukestatistikk.
Produksjon: [study.asinfra.no](https://study.asinfra.no/).

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

## MVP-funksjonalitet

- **Auth:** e-post/passord, registrering med eventuell e-postbekreftelse, lagret
  innlogging etter reload og logout. Kontoer og eierskap håndteres av Supabase.
- **Fag:** egne fag med valgfri kode kan opprettes, redigeres, arkiveres og aktiveres
  igjen. Nye økter bruker aktive fag; historiske økter kan bruke arkiverte fag.
- **Timer:** start, pause, fortsett og stopp. Serveren er source of truth for
  recovery etter refresh og håndhever én uavsluttet økt per bruker. En pause er
  ikke en ferdig økt. Faktisk arbeidstid er summen av arbeidssegmentene, uten pauser.
- **Historikk:** ferdige økter hentes 25 om gangen med «Vis flere». Fag, beskrivelse,
  øktgrenser og arbeidsperioder kan korrigeres; sletting krever bekreftelse.
  Bekreftede og usikre writes henter data på nytt, uten optimistisk sletting.
  Bekreftet timerstopp/recovery oppdaterer historikk og statistikk uten full refresh.
- **Ukestatistikk:** ukevalg, total og tid per fag. Browserens lokale tidssone
  bestemmer mandag 00:00 til neste mandag 00:00. Kalenderaritmetikk håndterer DST;
  en uke er ikke alltid 168 timer. Alle sider i valgt uke hentes, og segmentene
  klippes til `[ukeStart, ukeSlutt)`. Økter uten segmenter viser 0 arbeidstid.

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

Frontendtestene dekker config/Auth-retur, SDK-kall, mapping, faghandlinger,
timer/recovery/retry, paginering, edit/delete, usikre writes og segmenttid.
Ukegrenser, tidsomstilling og inputpresisjon testes i flere tidssoner.
SDK/nettverk simuleres: dette verifiserer ikke ekte hosted Auth eller RLS.
Database-/RLS-testene eies av [canonical backend](https://github.com/andsolste/asinfra/tree/main/supabase/tests).

Designet er et enkelt MVP. Statistikk finnes kun per uke, uten grafer, eksport,
mål eller streaks; dette er bevisst utsatt funksjonalitet, ikke feil.
Redesign og større forbedringer håndteres separat.

## Produksjonssjekkliste etter merge/deploy

Bruk to egne testkontoer (A/B) og merkede testdata, ikke credentials i Git.
Automatiserte tester erstatter ikke denne kontrollen mot ekte Auth/RLS:

1. Åpne **https://study.asinfra.no/** over HTTPS; ingen asset-404 eller konsollfeil.
2. Test login, reload av innlogging og logout.
3. Kontroller at eksisterende egne fag og historiske økter vises.
4. Opprett/rediger/arkiver et testfag og aktiver det igjen.
5. Start/pause/fortsett, refresh og stopp; samme økt gjenopprettes uten duplikat.
6. Den ferdige økten vises i historikken uten full refresh; arbeidstid utelater pauser.
7. Velg forrige/neste/denne uke; kontroller lokal uke, total og fagfordeling,
   også et segment som krysser en ukegrense.
8. Rediger beskrivelse/fag og en arbeidsperiode. Uendrede tidspunkter beholder
   original presisjon; endrede vises uten millisekunder. Ugyldig overlapp avvises.
9. Avbryt sletting først; slett så en merket testøkt med bekreftelse.
10. Reload: korreksjoner består, slettet økt er borte og uketotalen stemmer.
11. Test 320/390 px og desktop: ingen horisontal scrolling, leselige tidsfelter,
    labels, Tab/Shift+Tab, synlig fokus, status/feil og fokus etter edit/cancel/delete.
12. Logg inn som B i en separat nettleserprofil. A/B skal bare se egne fag,
    økter, historikk og statistikk; bytte av konto må ikke vise forrige brukers data.
