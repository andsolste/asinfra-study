# ASInfra Study

Selvstendig React/TypeScript-frontend for **https://study.asinfra.no/**.
Hovednettstedet ligger fortsatt i [andsolste/asinfra](https://github.com/andsolste/asinfra).

## Opprinnelse og ansvarsdeling

Frontend er trukket ut fra `apps/study/` i `andsolste/asinfra`, commit
`495b67aea357c309e62d3c9916eb346e1457200f` (merge av studieøkter i PR #18).
Dette repoet starter med en extraction-commit; hovedrepoets historikk er ikke omskrevet.
Senere frontend-endringer gjøres her.

**Canonical backend er [asinfra/supabase/](https://github.com/andsolste/asinfra/tree/main/supabase).**
Samme Supabase-prosjekt/Auth, brukere, fag, økter, segmenter og RLS brukes videre.
Dette repoet inneholder ingen Supabase-config eller migrasjonshistorikk, og deployer
aldri databaseendringer. Ikke opprett nytt Supabase-prosjekt eller kopier migrations hit.
Eventuelle schemaendringer skal ha egen PR og review i `asinfra`.

Database/migrasjons-/RLS-testene og den manuelle `test-rls.mjs` ligger i
`asinfra/supabase/tests/` med egen backend-testpakke. Migreringen er fullført:
den gamle `https://asinfra.no/study/` er kun en statisk redirect til subdomenet.
Testene i dette repoet kontrollerer frontend/config, SDK-kall, mapping, tidsberegning,
recovery, retry og doble handlinger; SDK-svar simuleres, ikke hosted Auth/RLS.

## Lokal utvikling

Bruk Node.js 22.12+; CI bruker Node.js 24. Fra repo-roten:

```sh
npm ci
# Kopier .env.example til .env.local og bruk eksisterende prosjekts offentlige verdier.
npm run dev
```

Åpne vanlig Vite localhost, normalt **http://localhost:5173/**.
`.env.local`, testcredentials, `node_modules/` og `dist/` skal ikke i Git.
Kun `VITE_SUPABASE_URL` og `VITE_SUPABASE_PUBLISHABLE_KEY` brukes i frontend.
Publishable key er offentlig; bruk aldri service-role/secret key.

```sh
npm test
npm run typecheck
npm run build
npm run check:build
npm run preview
```

Vite bruker `base: '/'`. Produksjonsassets ligger under `/assets/`, og bygget
ligger i `dist/`. Preview bruker normalt **http://localhost:4173/**.
Auth-bekreftelseslenker bruker gjeldende origin + Vites BASE_URL, ikke en hardkodet
gammel adresse. På et nytt browser origin kan eksisterende brukere måtte logge inn igjen.
Konto-ID-er og data er beholdt i samme Supabase-prosjekt.

## Historikk og ukestatistikk

Innlogget visning har timer, ukestatistikk, ferdig historikk, konto og egne fag.
`src/lib/study-history.ts` bruker de deployede RPC-ene `study_session_history`,
`study_session_history_edit` og `study_session_history_delete`; SQL og sikkerhet
eies fortsatt av canonical backend i `asinfra`. Responsene valideres med samme
mapping som timeren, men historikk krever avsluttet økt og avsluttede segmenter.

- Historikk henter 25 økter av gangen med `p_limit`/`p_offset` og «Vis flere».
  Oppdatering etter endringer starter listen på første side igjen.
- Uker er mandag 00:00 til neste mandag 00:00 i **browserens lokale tidssone**.
  Kalenderdatoer brukes, ikke et fast antall timer; en DST-uke kan ha 167/169 timer.
  Absolutte ISO-grenser sendes til Supabase. Alle sider i valgt uke hentes i
  avgrensede batcher, slik at totalen ikke bare teller første historikkside.
- Backend inkluderer økter ved segmentoverlapp. Klienten klipper hvert segment
  til ukegrensene og summerer faktisk arbeidstid totalt og per fag. Pauser og
  øktens samlede klokketid telles ikke. Gamle økter uten segmenter viser 0.
- Redigering skjer i listen, med aktive og arkiverte egne fag og arbeidsperioder
  som kan legges til, korrigeres eller fjernes. Norske valideringsmeldinger
  kontrollerer beskrivelse, tidsgrenser, rekkefølge og overlapp før RPC-kallet.
  Backend er endelig sikkerhetsgrense; segmentpayload har kun start/slutt.
- `datetime-local` vises i lokal tid og konverteres tilbake til ISO uten manuell
  offsetforskyvning. Uendrede felt bevarer opprinnelig timestamp/mikrosekunder.
  Ikke-eksisterende klokkeslett ved sommertid avvises; et nytt tvetydig klokkeslett
  ved vintertid må endres til et entydig tidspunkt. En uendret registrering fra
  den gjentatte timen bevarer den opprinnelige forekomsten.
- Sletting krever eksplisitt bekreftelse. Bekreftede og usikre writes henter både
  historikk og ukestatistikk på nytt; data fjernes ikke optimistisk. Etter usikkert
  svar lukkes edit-skjemaet så brukeren må kontrollere/åpne den oppdaterte økten.
- Bekreftet timerstopp, også etter recovery av et mistet svar, bruker
  `StudyTimer.onFinished` til å oppdatere begge visninger uten full browser-refresh.
  Fagendringer oppdaterer også historikkens navn/koder.

Testene i `tests/history.test.mjs` dekker API/mapping, paginering, segmenttid,
ukegrenser/DST i flere tidssoner, edit-payload, usikre writes, kansellerte/stale
forespørsler og samspill med timer-store. SDK/network simuleres; ekte produksjonsdata
endres ikke av disse testene.

## GitHub Pages

`.github/workflows/pages.yml` validerer pull requests mot `main` med `npm ci`,
frontend-tester, TypeScript og Vite-build. Push til `main` eller manuell kjøring
gjør samme kontroll og publiserer **kun `dist/`** som én Pages-artifact.
Kildekode, dependencies, env-filer og backend publiseres ikke som del av artifacten.
GitHub Pages må bruke **Source: GitHub Actions** og **Custom domain: study.asinfra.no**.
Custom domain settes i Pages-innstillingene; Actions-oppsettet trenger ikke en CNAME-fil.

Under **Settings → Secrets and variables → Actions → Variables**:

- `VITE_SUPABASE_URL`
- `VITE_SUPABASE_PUBLISHABLE_KEY`

Begge peker til samme eksisterende Supabase-prosjekt.
Workflowen feiler tydelig hvis de mangler.

## Produksjonsoppsett

Produksjonen bruker HTTPS på `study.asinfra.no`, med GitHub Pages custom domain
og følgende DNS-record hos Uniweb:

| Type | Host/navn | Target |
| --- | --- | --- |
| CNAME | `study` (`study.asinfra.no`) | `andsolste.github.io` |

Ingen sti eller repository-navn i target. Apex-/www-recordene til hovednettstedet
er separate. Pages bruker **Enforce HTTPS**.

I **eksisterende** Supabase-prosjekt: **Authentication → URL Configuration**:

- Site URL: `https://study.asinfra.no/`
- Redirect URLs inkluderer `https://study.asinfra.no/`, `http://localhost:5173/`
  og `http://localhost:4173/` hvis preview brukes med Auth.
- Gammel `https://asinfra.no/study/` kan beholdes som legacy redirect.
  Ikke erstatt listen eller fjern andre ASInfra-appers redirect-URL-er.
- Dersom egne e-postmaler hardkoder gammel URL, gjennomgå dem. Maler som bruker
  `RedirectTo`/standard bekreftelses-URL følger den tillatte redirecten.

[Supabase redirect-dokumentasjon](https://supabase.com/docs/guides/auth/redirect-urls).
Ingen schemaendring, brukerflytting eller ny Auth er nødvendig.

## Manuell kontroll av #10 etter merge/deploy

Bruk en egen testøkt der tidspunkter eller data skal endres:

1. Logg inn og kontroller at eksisterende ferdige økter, fag og segmenter vises.
2. Sammenlign arbeidstid med segmentene; pauser og null-segment-økter teller ikke.
3. Start/pause/fortsett/stopp en ny økt; historikk og valgt uke oppdateres uten full refresh.
4. Velg forrige/neste uke og «Denne uken»; kontroller vist tidsrom og tidssone.
5. Kontroller total og fagfordeling, også en økt som krysser en ukegrense.
6. Rediger beskrivelsen på testøkten og kontroller historikkliste/statistikk.
7. Bytt til et annet eget fag, inkludert et arkivert fag.
8. Korriger en arbeidsperiode/pause; prøv også ugyldig overlapp og tidsgrenser.
9. Last siden på nytt og kontroller at korrigerte data består.
10. Avbryt en sletting først, og slett deretter testøkten med eksplisitt bekreftelse.
11. Last siden på nytt; økten er borte og uketotalen er oppdatert.
12. Test tastatur, fokus etter edit/cancel/delete, mobil 320/390 px og desktop.
13. Kontroller fortsatt fagadministrasjon, login/logout og timer-recovery etter refresh.

Pull request merges ikke automatisk. Lokale mock-tester erstatter ikke denne
kontrollen mot ekte Auth/RLS og produksjon etter deploy.
