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

Database/migrasjons-/RLS-testene og den manuelle `test-rls.mjs` beholdes i `asinfra`.
Under overgangsperioden ligger de fortsatt under `apps/study/tests/` og
`apps/study/scripts/` der. Når fallbacken fjernes, må de flyttes til en egen
backend-testpakke nær `supabase/`, uten å miste coverage eller duplisere SQL.
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
Konto-ID-er og data migreres ikke.

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

Begge skal være identiske med hovedrepoets verdier for samme Supabase-prosjekt.
Workflowen feiler tydelig hvis de mangler.

## DNS og Auth – kontrollert overgang

Sett Pages custom domain **før** DNS-recorden hos Uniweb:

| Type | Host/navn | Target |
| --- | --- | --- |
| CNAME | `study` (`study.asinfra.no`) | `andsolste.github.io` |

Ingen sti eller repository-navn i target. Ikke endre apex-/www-recordene eller legg
til wildcard-record. Slå på **Enforce HTTPS** når DNS-check og GitHub-sertifikatet
er klart. [GitHubs custom-domain-veiledning](https://docs.github.com/en/pages/configuring-a-custom-domain-for-your-github-pages-site/managing-a-custom-domain-for-your-github-pages-site).

I **eksisterende** Supabase-prosjekt: **Authentication → URL Configuration**:

- Site URL: `https://study.asinfra.no/`
- Redirect URLs: legg til `https://study.asinfra.no/`, `http://localhost:5173/`
  og `http://localhost:4173/` hvis preview brukes med Auth.
- Behold `https://asinfra.no/study/` og eventuelle gamle localhost-redirects
  under overgangen. Ikke erstatt listen eller fjern andre ASInfra-appers redirect-URL-er.
- Dersom egne e-postmaler hardkoder gammel URL, gjennomgå dem. Maler som bruker
  `RedirectTo`/standard bekreftelses-URL følger den tillatte redirecten.

[Supabase redirect-dokumentasjon](https://supabase.com/docs/guides/auth/redirect-urls).
Ingen schemaendring, brukerflytting eller ny Auth er nødvendig.

## Verifisering før gammel Study fjernes

Gammel **https://asinfra.no/study/** må fortsette å virke til denne sjekklisten er fullført:

- Nytt repo bygger grønt og subdomenet laster JS/CSS over HTTPS.
- Innlogging, utlogging og e-post/auth-redirect fungerer mot samme Supabase.
- Eksisterende fag og aktive/pausede økter kan hentes med samme konto.
- Start/pause/fortsett/stopp, flere arbeidsperioder og recovery etter refresh fungerer.
- Desktop og mobil 320/390 px fungerer uten horisontal scrolling.

Først deretter lages separat oppryddings-PR i `asinfra`: fjern gammel frontend/build,
behold canonical `supabase/` og flytt backend-testene nær denne, oppdater lenker og
legg en statisk redirect fra gammel Study-adresse til subdomenet (bevar query/hash).
Ikke merge oppryddingen eller lukk [issue #19](https://github.com/andsolste/asinfra/issues/19)
før produksjonen er verifisert. App-hub, historikk og nye Study-funksjoner er utenfor flyttingen.
