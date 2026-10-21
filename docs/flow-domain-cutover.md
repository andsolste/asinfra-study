# Flow #14 – gjennomført domeneflytting og historisk runbook

**Cutover gjennomført 20. oktober 2026.** Andreas har manuelt verifisert
produksjonen og bekreftet følgende sluttstatus:

- Flow kjører på **https://flow.asinfra.no/** over HTTPS.
- Login, reload/session, logout, eksisterende data og signup/e-postbekreftelse
  fungerer på Flow. Supabase Site URL er `https://flow.asinfra.no/`.
- `https://study.asinfra.no/` videresender til Flow via den aktive Pages-siten
  [andsolste/asinfra-study-redirect](https://github.com/andsolste/asinfra-study-redirect).
  Deep path/query/hash er testet på legacy-redirecten.
- `https://asinfra.no/study/` videresender direkte til Flow, og Apps-kortet peker dit.
- [Flow PR #22](https://github.com/andsolste/asinfra-study/pull/22) og
  [ASInfra PR #32](https://github.com/andsolste/asinfra/pull/32) er merget.
- Frontend eies fortsatt av `andsolste/asinfra-study`; canonical backend er
  fortsatt `andsolste/asinfra/supabase`. Ingen backend-/data-/brukermigrasjon
  var nødvendig for domeneflyttingen.
- Study, localhost 5173, preview 4173 og andre nødvendige app-/legacy-adresser
  kan beholdes i allowed Redirect URLs. Hele listen må fortsatt vurderes før
  fremtidige endringer; Site URL er ikke lenger Study.

Dokumentasjonen nedenfor bevarer **den opprinnelige planen og observasjonene fra
før cutover som historikk**, ikke gjenstående arbeid eller instrukser om å bytte
domene på nytt. Tidligere usikkerhet om hosting/legacy er avklart ved løsningen
over. Rollback-informasjonen beholdes uendret. #14 lukkes ikke automatisk.

## Historisk: modell og avgrensning før cutover

- `andsolste/asinfra-study` bygger frontend med `.github/workflows/pages.yml`:
  Node 24, `npm ci`, tester, typecheck, Vite-build og `check:build`. PR-er valideres;
  bare `main` deployes. Kun `dist/` lastes opp til Pages.
- Appen bruker allerede `base: '/'` og `/assets/`, ikke `/study/` som base.
  `study` i repo-/pakkenavn og legacy API-er er ikke en URL-base og beholdes.
- Dagens produksjonsadresse er `https://study.asinfra.no/`; målet er
  `https://flow.asinfra.no/`. Canonical/`og:url` i denne PR-en forbereder målet.
- Ingen sporet `CNAME` finnes i noen av de to repoene. Dokumentert Pages-oppsett
  er GitHub Actions med custom domain i **Settings → Pages**, ikke i Vite.
  Actions-publisering trenger ikke en `CNAME`-fil. Eksakt hosted domain/HTTPS-
  innstilling må bekreftes i UI: anonym Pages API ga 404 under preflight.
- Workflowen trenger fortsatt bare de eksisterende **Repository variables**
  `VITE_SUPABASE_URL` og `VITE_SUPABASE_PUBLISHABLE_KEY`. Samme prosjekt og public
  browser key beholdes; ingen verdier kopieres til Git eller et nytt repo.
- Registrering bruker `authRedirectUrl(window.location.origin, import.meta.env.BASE_URL)`.
  Login, SDK-ens session recovery og logout er uendret. Domenet hardkodes ikke i Auth.
- `andsolste/asinfra` deployer statisk `publish/`; `/study/` er bare en redirect.
  Apps/søk beholder `apps/#flow` og gammelt `apps/#study`.
- Canonical backend, migrations, RLS og `auth.uid()` forblir i `asinfra/supabase`.
  Ingen schema-/data-/brukermigrasjon eller `config push` inngår.

Offentlig DNS lest 20. oktober 2026: `study.asinfra.no` og `www.asinfra.no` hadde
CNAME til `andsolste.github.io`; NS var `ns01.no.brand.one.com` og
`ns02.no.brand.one.com`. Dagens Study-rot svarte HTTP 200. Dette bekrefter ikke
leverandørkonto, kjøpte tjenester, hosted Pages-innstillinger eller fremtidig Flow-DNS.
ASInfra README oppgir Uniweb; kontroller faktisk kontrollpanel før endringer.
Ingen eksisterende CDN/redirect-tjeneste er dokumentert i repoene.

## Historisk: legacy-vurdering før cutover

**Anbefaling ut fra det verifiserbare oppsettet: en separat, minimal Pages-site
for `study.asinfra.no`, etter eget review.** Eksempel på foreslått repo:
`andsolste/asinfra-study-redirect` (ikke opprettet). Dette gjenbruker GitHub-hostingen,
trenger ingen app/backend eller dependencies, og kan bevare query/hash i klienten.

En site med custom domain `flow.asinfra.no` skal ikke forventes å betjene vilkårlige
andre subdomener. Å la gammel CNAME peke til samme Pages-server er **ikke** en
redirectmekanisme. Apex/`www`-automatikken løser ikke `study` → `flow`.

Vurderte alternativer:

- **A – eksisterende leverandør/CDN:** færrest deler dersom kontoen faktisk har
  HTTPS-videresending av akkurat `study`, med path/query og uten å berøre apex/www.
  Uniweb dokumenterer videresending, men preflight har ikke bekreftet at den aktuelle
  avtalen støtter subdomene, sertifikat og nødvendig URL-bevaring. Ikke kjøp pakke,
  flytt navnetjenere eller aktiver en regel automatisk. Hvis disse kravene bekreftes,
  kan A velges i review fremfor nytt repo. Bruk midlertidig 302/307 under prøving,
  senere eventuelt permanent redirect. Fragment sendes ikke til serveren; test
  nettleserens fragmentbevaring, eller bruk en liten HTML-klientredirect.
- **B – separat Pages-site:** anbefalt, forutsigbar kode og egen domain-binding.
  Kostnaden er ett lite repo/site og vedlikehold av en redirect, ikke enda en app.
  Ingen ny infrastruktur er opprettet i disse PR-ene.
- **C – eksisterende ASInfra-site:** dens custom domain er `asinfra.no`.
  `/study/` kan redirecte der, men samme site er ikke en dokumentert HTTPS-alias
  for `study.asinfra.no`. Ingen annen eksisterende hosting er funnet.

### Slik klargjøres B etter godkjenning

1. Opprett det avtalte redirect-repoet under samme eier. Legg inn en liten
   `index.html` og identisk `404.html` med Flow-lenke, canonical/meta-refresh til
   Flow og scriptet under. Ingen analytics, Auth-klient, secrets eller app-assets.
   404-kopien lar gamle dype paths beholde URL-en før videresending; destinasjonens
   støtte for slike paths må testes, Flow innfører ikke routing i dette issue-et.
2. Velg Pages **Deploy from a branch → main → /(root)** for redirect-repoet.
   Test publisert innhold før domenet flyttes. Vent med custom domain `study` til
   det er frigjort fra app-repoet. Et midlertidig testdomene er en egen beslutning.
3. Under cutover: bind `study.asinfra.no` til redirect-repoet så snart det er
   frigjort. Branch-basert Pages oppretter `CNAME` ved lagring av custom domain.
   Behold eksisterende `study CNAME andsolste.github.io`; riktig site velges av
   Pages-domain-bindingen, ikke av repositorynavn i DNS. Aktiver Enforce HTTPS
   når sertifikatet er klart, og test både rot og `404.html`-flyten.

Forslag til klientredirect i begge HTML-filene (må reviewes/testes i det nye repoet):

```js
if (window.location.hostname === 'study.asinfra.no') {
  const target = new URL('https://flow.asinfra.no/');
  target.pathname = window.location.pathname;
  target.search = window.location.search;
  target.hash = window.location.hash;
  window.location.replace(target.href);
}
```

Fast origin og host-guard hindrer et brukerbestemt mål og redirect på Flow selv.
Ingen `/study/` settes foran pathen. Uten JS kan meta-refresh/lenke bare garantere
Flow-roten, ikke query/hash. HTTPS må virke **før** HTML/JS kan hjelpe.

**Tilgjengelighetsport:** samme hostname kan ikke være bundet til begge Pages-sites
samtidig. Frigjøring/ny binding og sertifikat kan gi et avbrudd på gammel adresse.
Dette er ikke en null-nedetid-plan. Godkjenn et kontrollert vedlikeholdsvindu og
rollback før B brukes. Kreves kontinuerlig gammel HTTPS-inngang, stopp her og
review en separat redirect/proxy med forhåndsklargjort TLS (A eller egen løsning).
Ikke «løs» dette ved å slette gammel DNS eller håpe at Pages redirecter automatisk.

## Historisk: planlagte DNS-, Pages- og Auth-verdier

| Område | Planlagt verdi/handling |
| --- | --- |
| Flow DNS | `CNAME`, navn/host `flow` (`flow.asinfra.no`), target `andsolste.github.io` – ingen protokoll eller repo-path |
| Flow Pages | `andsolste/asinfra-study` → Settings → Pages → Custom domain: `study.asinfra.no` → `flow.asinfra.no` |
| HTTPS | Vent på DNS/sertifikat; aktiver **Enforce HTTPS** når tilgjengelig. Stopp ved sertifikatfeil, ikke bruk HTTP som Auth-fallback. |
| Legacy DNS ved B | Behold `study CNAME andsolste.github.io`; flytt domain-bindingen til godkjent redirect-site |
| Supabase Site URL | Etter vellykket Auth-smoke: `https://flow.asinfra.no/` |
| Supabase Redirect URLs | Legg til `https://flow.asinfra.no/`; behold `https://study.asinfra.no/`, `http://localhost:5173/`, `http://localhost:4173/` og alle andre nødvendige eksisterende app-/legacy-returer |

Ikke sett CNAME til `asinfra.no`, til repoet eller til en URL med `/`.
Ikke endre apex, www, MX, NS eller domeneverifiserings-TXT. Ta vare på gjeldende
DNS-/Pages-/Auth-verdier i en privat endringslogg; ikke kopier secrets/tokens dit.
Ikke opprett en ubundet DNS-oppføring uten en plan for rask Pages-binding og
domeneeierskapsverifisering; GitHub anbefaler å registrere domenet i Pages før DNS.
Ved B flytter dette samtidig gammel binding: gjør de to handlingene i det avtalte
vinduet, ikke som uavhengige «tidlig DNS»-steg.

Hosted Supabase: **Authentication → URL Configuration**. Les hele eksisterende
listen først og legg til, ikke erstatt. Behold også gammel `asinfra.no/study/`
dersom den finnes/brukes. **Authentication → Email Templates:** inspiser signup,
recovery, magic link og egne lenker for hardkodet Study/Site URL. Bevar fungerende
`{{ .ConfirmationURL }}` og andre dynamiske variabler; vurder `.RedirectTo` der
en egen mal feilaktig ignorerer `emailRedirectTo`. Ikke innfør en ny callback-route
som appen ikke har. Hosted maler/allowlist er ikke lest eller endret i preflight.

## Historisk: opprinnelig nummerert cutover-runbook

1. Review begge `chore/flow-domain-cutover`-PR-ene og grønn CI. Bekreft privat
   gjeldende Pages-domain/HTTPS, DNS-konto/records, Supabase Site URL, hele redirect-
   listen og e-postmalene. Noter siste fungerende frontend-/ASInfra-SHA. Ingen merge ennå.
2. Godkjenn A eller B eksplisitt. Ved B klargjør redirect-repoet og test dets
   publiserte index/404 og script uten å ta `study` fra appen. Godkjenn mulig
   hostname-/TLS-avbrudd, vedlikeholdsvindu og hvem som gjør rollback. Ellers stopp.
3. I Supabase legg til `https://flow.asinfra.no/` som Redirect URL **før** noe byttes.
   Behold Study, localhost/preview, gammel rot-retur og andre appers returer.
   Inspiser malene; avklar hardkodede lenker. Site URL er fortsatt Study.
4. Kontroller at `flow` ikke har konfliktende DNS-records og at domenet eies/
   kan verifiseres i GitHub. Klargjør CNAME-verdien over i kontrollpanelet, men
   koordiner aktivering med Pages-bindingen i steg 6; ikke rør gammel Study-DNS.
5. I det avtalte vinduet merge Flow-PR-en og vent på vellykket automatisk `main`-
   deploy. Det er metadata og CI-branding som endres; dagens origin virker fortsatt.
   Ikke fjern appkode eller deployarkitektur.
6. I `asinfra-study` Settings → Pages lagre **Custom domain = flow.asinfra.no**.
   Opprett/aktiver `flow CNAME andsolste.github.io` umiddelbart etter lagringen
   hvis den ikke allerede finnes korrekt. Ved B: bind frigjort `study.asinfra.no`
   til det klargjorte redirect-repoet straks, uten å slette Study-CNAME. Dette er
   det reelle hosted skjæringspunktet; overvåk begge og bruk rollback ved feil.
7. Vent på DNS- og sertifikatkontroll for Flow og legacy. Aktiver Enforce HTTPS
   på begge når tilgjengelig. GitHub oppgir at valget kan bruke opptil 24 timer;
   bruk godkjent tidsbudsjett/rollback, ikke lov umiddelbar TLS. Ikke gå videre
   på HTTP eller med nettleserens sertifikatadvarsel.
8. Åpne `https://flow.asinfra.no/`: offentlig oversikt, riktige metadata, JS/CSS
   fra `/assets/`, ingen 404/konsollfeil. Kontroller desktop og 390/320 px.
9. Logg inn med dedikert eksisterende testbruker. Kontroller egne områder,
   oppgaver, historikk, statistikk og eksport. Test timer start/bytte, pause og
   fortsett med merkede testdata, ikke ved å endre/slette ekte arbeid.
10. Reload både aktiv og pauset dag, og kontroller recovery, dagstotal og session.
    Nytt origin deler ikke gammel localStorage; ny login er forventet. Test logout
    og ny login. Ikke kopier session-/refresh-tokens manuelt mellom origins.
11. Test signup og e-postbekreftelse på ny adresse med en testkonto, fortsatt med
    gammel Site URL. Kontroller at eksplisitt `emailRedirectTo` faktisk respekteres.
    Test også en gyldig eldre bekreftelseslenke via legacy-redirect. PKCE-koder kan
    være bundet til gammel origins verifier; hvis en slik flyt feiler, avklar/test
    ny bekreftelse på Flow før den gamle flyten godkjennes. Ikke logg tokens/lenker.
12. Først nå sett Supabase **Site URL = https://flow.asinfra.no/**. Behold allowlist.
    Test signup/bekreftelse og eventuelle egne mal-/fallback-lenker igjen. Samme
    Supabase-prosjekt, `auth.uid()` og data skal bestå.
13. Når Flow og Auth er godkjent, merge ASInfra-PR-en. Vent på grønn Pages-deploy.
    Apps peker til Flow, og `asinfra.no/study/` går direkte dit uten Study-hopp.
14. Fullfør/godkjenn legacy-mekanismen. Ved B er bindingen allerede satt i steg 6;
    bekreft nå at både index og 404 bruker redirecten over HTTPS. Ved A aktiver
    den avtalte regelen først etter Flow-smoke, med testet TLS og rollback.
15. Test `https://study.asinfra.no/?foo=bar#section` og
    `https://asinfra.no/study/?foo=bar#section`: Flow-rot med samme query/hash,
    ingen loop og ett direkte klienthopp fra hver HTTPS-inngang. Test også gammel
    dyp path ved valgt legacy-mekanisme; URL-bevaring garanterer ikke en ny app-route.
16. Kontroller Apps, globalt søk → Flow, `apps/#study`, apex/www, tastatur, mobil
    og desktop. Verifiser localhost 5173 og preview 4173 Auth-retur i testmiljø.
17. Registrer faktisk resultat/SHA/domain/HTTPS/Auth-smoke i #14. Oppdater README
    fra pre-cutover til ferdig status i en liten oppfølgings-PR. Lukk #14 **bare**
    når ny produksjon og begge gamle innganger er verifisert. Ingen automatisk lukking.

## Kontrollgrunnlag for cutover og senere vedlikehold

Den manuelle produksjonskontrollen er oppsummert øverst. Den utvidede sjekklisten
under beholdes som driftsreferanse, ikke som en ny påstand om at hvert enkelt
testpunkt er kjørt i dokumentasjonsoppgaven.

- **Flow:** HTTPS, oversikt, root-assets, login/logout, eksisterende data, timer,
  tasks, historikk, statistikk, eksport, reload/recovery, signup og email confirmation.
- **Legacy:** begge gamle HTTPS-adresser, path der støttet, query/hash, ingen loop,
  ett direkte HTTPS-klienthopp der mulig. HTTP→HTTPS kan gi et ekstra transporthopp.
- **ASInfra:** Apps → Flow, søk → Flow, gammelt `apps/#study`, apex/www urørt.
- **UI:** desktop og 390/320 px, tastatur/fokus og ingen ytre horisontal scrolling.

## Rollback

1. Stopp videre merges/endringer. Ikke rør data, migrations, RLS eller bruker-ID-er.
2. Hvis redirect-repoet eier `study`, fjern dets custom-domain-binding først
   (ved branch-publisering også eventuell gjenopprettet CNAME). Ved A deaktiver
   providerregelen og gjenopprett lagret Study-DNS til GitHub hvis den var endret.
3. Sett app-repoets Pages custom domain tilbake til **study.asinfra.no**. Behold/
   gjenopprett Study-CNAME og verifiser gyldig HTTPS/Enforce HTTPS. Ikke la begge
   repoer kjempe om domenet. Hvis Flow-DNS blir ubundet, fjern bare den nye `flow`-
   recorden inntil den igjen kan bindes trygt; apex/www er urørt.
4. Gjenopprett lagret Supabase Site URL (normalt Study); behold begge tillatte
   returer og lokale/andre appers returer. Gjenopprett kun eventuelle særskilt
   endrede e-postmaler fra privat backup. Ingen ny database-/Auth-brukermigrasjon.
5. Reverter cutover-commitene gjennom review i begge repoer, slik at canonical/
   `og:url`, Apps, validator og `/study/` igjen stemmer med Study-produksjonen.
   Ikke force-push. Vent på automatisk deployment og test login/reload/timer,
   gamle bokmerker og eksisterende data. DNS/TLS-cache betyr at rollback heller
   ikke har en garantert øyeblikkelig tidsgrense.

## Historiske begrensninger og senere verifisering

Den opprinnelige preflighten kunne ikke bekrefte leverandøravtale/redirect-funksjoner,
innloggede Pages-/TLS-verdier, full hosted Supabase allowlist, Site URL eller
e-postmaler. Dette var begrensninger ved preflighten, ikke dagens cutover-status.
Andreas har senere bekreftet Uniweb-oppsettet og Pages-redirect som valgt løsning,
samt verifisert Flow over HTTPS, hosted Auth/bekreftelse, Site URL og legacy-
redirectene 20. oktober 2026. Hele allowlisten og innholdet i e-postmalene er ikke
gjengitt her. Dokumentasjonsoppryddingen endrer ingen hosted innstillinger.

## Kilder for driftsvalgene

- [GitHub: custom domain og subdomener](https://docs.github.com/en/pages/configuring-a-custom-domain-for-your-github-pages-site/managing-a-custom-domain-for-your-github-pages-site)
- [GitHub: domain-konflikter og HTTPS](https://docs.github.com/en/pages/configuring-a-custom-domain-for-your-github-pages-site/troubleshooting-custom-domains-and-github-pages)
- [Supabase: redirect URL-er](https://supabase.com/docs/guides/auth/redirect-urls)
- [Supabase: e-postmaler](https://supabase.com/docs/guides/auth/auth-email-templates)
- [Uniweb: videresending](https://support.uniweb.no/hc/nb/articles/35884020268817-Hvordan-oppretter-jeg-en-videresending-via-kontrollpanelet)
- [MDN: fragmentet behandles i klienten](https://developer.mozilla.org/en-US/docs/Web/URI/Reference/Fragment)
