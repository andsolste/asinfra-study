import { useEffect, useRef, useState, useSyncExternalStore } from 'react'
import type { Session } from '@supabase/supabase-js'
import AppHeader from '../components/AppHeader'
import { supabase } from '../lib/supabase'
import { examApi } from './api'
import type { ExamApi, Start } from './api'
import { createExamEditor } from './editor'
import { answerState, canViewFeedback, examUrl, formatPoints, resultSummary, scoringRule } from './model'
import type { Catalogue, Guidance } from './model'
import { GuidanceView } from './QuestionView'
import { ReviewedQuestion } from './ReviewedQuestion'
import './exams.css'

const formatTime=(value:string)=>new Date(value).toLocaleString('nb-NO',{dateStyle:'short',timeStyle:'short'})
export default function ExamApp({ session, api=examApi }: { session:Session; api?:ExamApi }) {
  const [editor]=useState(()=>createExamEditor(api)), state=useSyncExternalStore(editor.subscribe,editor.getSnapshot,editor.getSnapshot)
  const [catalogue,setCatalogue]=useState<Catalogue|null>(null),[loading,setLoading]=useState(true),[error,setError]=useState<string|null>(null)
  const [feedback,setFeedback]=useState<'each'|'end'>('end'),[mode,setMode]=useState<'practice'|'exam'>('practice'),[clock,setClock]=useState(false)
  const [guidance,setGuidance]=useState<Guidance|null>(null),[guideBusy,setGuideBusy]=useState(false),[guideError,setGuideError]=useState<string|null>(null)
  const [elapsed,setElapsed]=useState(0),[signingOut,setSigningOut]=useState(false)
  const pendingStart=useRef<Start|null>(null),title=useRef<HTMLHeadingElement>(null),clockBase=useRef({elapsed:0,at:0})
  const guidanceRequest=useRef(0),loadRequest=useRef(0)
  const {data}=state, question=data?.questions.find(q=>q.number===state.number),row=data?.responses.find(r=>r.number===state.number)
  const locked=Boolean(data?.attempt.submitted_at||row?.submitted_at), busy=state.busy||loading
  const summary=data?resultSummary({...data,responses:data.responses.map(r=>r.number===state.number?{...r,answer:state.draft}:r).concat(row?[]:[{number:state.number,answer:state.draft,revision:0,submitted_at:null,auto_points:null,self_assessment:null,last_request:null}])}):null
  async function loadLocation() {
    const request=++loadRequest.current
    setLoading(true);setError(null)
    try {
      const id=new URLSearchParams(window.location.search).get('attempt')
      if(id){const next=await api.get(id);if(request===loadRequest.current){editor.install(next,next.attempt.current_question);setCatalogue(null)}}
      else {const next=await api.catalogue();if(request===loadRequest.current)setCatalogue(next)}
    } catch {if(request===loadRequest.current)setError('Kunne ikke hente eksamener. Kontroller tilgangen og prøv igjen.')}
    finally {if(request===loadRequest.current)setLoading(false)}
  }
  useEffect(()=>{void loadLocation()},[api]) // One authenticated module per user; no shared answer cache.
  useEffect(()=>{
    const unload=(e:BeforeUnloadEvent)=>{if(state.dirty||state.busy||state.blocked){e.preventDefault();e.returnValue=''}}
    window.addEventListener('beforeunload',unload);return()=>window.removeEventListener('beforeunload',unload)
  },[state.dirty,state.busy,state.blocked])
  useEffect(()=>{
    const reload=()=>{if(document.visibilityState==='visible')void editor.refresh()}
    window.addEventListener('focus',reload);document.addEventListener('visibilitychange',reload)
    return()=>{window.removeEventListener('focus',reload);document.removeEventListener('visibilitychange',reload)}
  },[editor])
  useEffect(()=>{
    if(!state.dirty||state.busy||state.blocked)return
    const timer=setTimeout(()=>void editor.save(),800);return()=>clearTimeout(timer)
  },[state.draft,state.dirty,state.busy,state.blocked,editor])
  useEffect(()=>{setGuidance(null);setGuideError(null);setGuideBusy(false);return()=>{guidanceRequest.current++}},[state.number,data?.attempt.id])
  useEffect(()=>{
    if(!data)return
    clockBase.current={elapsed:Math.max(0,Date.parse(data.attempt.submitted_at??data.server_time)-Date.parse(data.attempt.started_at)),at:performance.now()}
    const update=()=>setElapsed(clockBase.current.elapsed+(data.attempt.submitted_at?0:performance.now()-clockBase.current.at))
    update();if(!data.attempt.show_clock)return
    const timer=setInterval(update,1000);return()=>clearInterval(timer)
  },[data])
  async function start(exam:string,version:number) {
    loadRequest.current++
    pendingStart.current??={id:crypto.randomUUID(),exam,version,feedback,mode,clock:mode==='exam'&&clock}
    setLoading(true);setError(null)
    try {const next=await api.start(pendingStart.current);pendingStart.current=null;editor.install(next);window.history.replaceState(null,'',examUrl(next.attempt.id));setCatalogue(null)}
    catch {setError('Starten kunne ikke bekreftes. Prøv igjen med samme valg; et nytt forsøk blir ikke opprettet dobbelt.')}
    finally {setLoading(false)}
  }
  async function navigate(number:number){if(await editor.navigate(number)){title.current?.focus();setGuidance(null)}}
  const canReview=data?canViewFeedback(data.attempt,row):false
  async function showGuide(){
    if(!data||!question||!canReview)return
    const request=++guidanceRequest.current;setGuideBusy(true);setGuideError(null)
    try{const next=await api.guidance(data.attempt.id,question.number);if(request===guidanceRequest.current)setGuidance(next)}
    catch{if(request===guidanceRequest.current)setGuideError('Kunne ikke hente sensorveiledningen.')}
    finally{if(request===guidanceRequest.current)setGuideBusy(false)}
  }
  async function signOut(){if(!supabase)return;if(state.dirty&&!window.confirm('Du har ulagrede svar. Logge ut likevel?'))return;setSigningOut(true);try{const result=await supabase.auth.signOut({scope:'local'});if(result.error)setError('Kunne ikke logge ut.')}catch{setError('Kunne ikke logge ut.')}finally{setSigningOut(false)}}
  const backToFlow=new URL(window.location.href);backToFlow.searchParams.delete('app');backToFlow.searchParams.delete('attempt')
  return <>
    <AppHeader exams><a className="text-button" href={backToFlow.pathname+backToFlow.search}>Til Flow</a><span className="exam-account">{session.user.email}</span><button className="secondary-button" disabled={signingOut||state.busy} onClick={signOut}>Logg ut</button></AppHeader>
    <main id="study-content" className="exam-workspace" tabIndex={-1}>
      {error&&<div role="alert"><p>{error}</p>{!pendingStart.current&&<button onClick={()=>void loadLocation()}>Hent på nytt</button>}</div>}
      {loading&&<p role="status">Henter eksamen …</p>}
      {catalogue&&<>
        <header className="view-heading"><h2>Tilgjengelige eksamener</h2><p>Velg eksamen og arbeidsmåte. Svar lagres underveis på kontoen din.</p><p className="muted">{scoringRule(2)}</p></header>
        {!catalogue.exams.length&&<p>Ingen eksamener er tilgjengelige for kontoen din ennå.</p>}
        {catalogue.exams.length>0&&<fieldset className="exam-settings" disabled={loading||Boolean(pendingStart.current)}><legend>Før du starter</legend>
          <div><label htmlFor="exam-feedback">Fasit</label><select id="exam-feedback" value={feedback} onChange={e=>setFeedback(e.target.value as 'each'|'end')}><option value="end">Etter hele eksamenen</option><option value="each">Etter hver oppgave</option></select></div>
          <div><label htmlFor="exam-mode">Modus</label><select id="exam-mode" value={mode} onChange={e=>setMode(e.target.value as 'practice'|'exam')}><option value="practice">Øving uten tidsbegrensning</option><option value="exam">Eksamensmodus</option></select></div>
          {mode==='exam'&&<label className="exam-check"><input type="checkbox" checked={clock} onChange={e=>setClock(e.target.checked)}/>Vis klokke (medgått tid)</label>}
        </fieldset>}
        <div className="exam-catalogue">{catalogue.exams.map(e=><article className="dashboard-panel" key={e.exam_id+e.version}><p className="section-label">{e.course}</p><h3>{e.title}</h3><p>{e.question_count} oppgaver · {e.max_points} poeng · opprinnelig varighet {e.duration_minutes} min</p><button disabled={loading} onClick={()=>void start(e.exam_id,e.version)}>{pendingStart.current?'Prøv start igjen':'Start nytt forsøk'}</button></article>)}</div>
        {catalogue.attempts.length>0&&<section><h2>Dine gjennomføringer</h2><ul className="exam-attempts">{catalogue.attempts.map(a=><li key={a.id}><a href={examUrl(a.id)}>{catalogue.exams.find(e=>e.exam_id===a.exam_id&&e.version===a.version)?.title??a.exam_id} · {formatTime(a.started_at)}<span>{a.submitted_at?'Se besvarelse':'Fortsett'} · {a.feedback==='each'?'Fasit underveis':'Fasit til slutt'}</span></a></li>)}</ul></section>}
      </>}
      {!catalogue&&data&&question&&summary&&<>
        <a href={examUrl()} className="text-button">← Alle eksamener</a>
        <header className="exam-heading"><div><p className="section-label">{data.exam.course}</p><h2>{data.exam.title}</h2><p>{data.attempt.mode==='practice'?'Øvingsmodus':'Eksamensmodus'} · Fasit {data.attempt.feedback==='each'?'etter hver oppgave':'etter innlevering'}{data.attempt.submitted_at?' · Levert':''}</p></div>
          {data.attempt.show_clock&&<p className="exam-clock" role="timer" aria-label="Medgått tid">{Math.floor(elapsed/3600000).toString().padStart(2,'0')}:{Math.floor(elapsed/60000)%60<10?'0':''}{Math.floor(elapsed/60000)%60}:{Math.floor(elapsed/1000)%60<10?'0':''}{Math.floor(elapsed/1000)%60}</p>}
        </header>
        <details className="exam-instructions"><summary>Original eksamensinformasjon</summary><p className="exam-original">{data.exam.introduction}</p><p>Klokken er et hjelpemiddel. Den leverer ikke automatisk ved tidsgrensen.</p></details>
        <p>{summary.complete} besvart · {summary.partial} delvis besvart · {summary.unanswered} ubesvart. Merknader teller ikke.</p>
        {data.attempt.submitted_at&&<section className="exam-results" aria-labelledby="result-title"><h3 id="result-title">Resultat for dette forsøket</h3>
          <p>Automatiske øvingspoeng: <strong>{formatPoints(summary.automatic)} / {formatPoints(summary.automaticMax)}</strong> · Egenvurdert: <strong>{formatPoints(summary.self)} / {formatPoints(summary.selfMax)}</strong></p><p>{summary.unassessed} besvarte oppgaver er ikke vurdert · {summary.unanswered} ubesvarte.</p>
          <p className="muted">{scoringRule(data.attempt.scoring_version)} Egenvurdering: full / halv / ingen uttelling. Ingen samlet prosent beregnes.</p>
        </section>}
        <div className="exam-layout">
          <nav className="exam-nav" aria-label="Oppgaver"><details open><summary>Oppgaveoversikt</summary><ol>{data.questions.map(q=>{const r=data.responses.find(r=>r.number===q.number),status=answerState(q,q.number===state.number?state.draft:r?.answer);return <li key={q.number}><button disabled={busy||state.blocked} aria-current={q.number===state.number?'step':undefined} onClick={()=>void navigate(q.number)}><span>{q.number}. {q.title}</span><small>{q.max_points===0?'Merknader':`${r?.submitted_at?'Levert · ':''}${status==='complete'?'Besvart':status==='partial'?'Delvis besvart':'Ubesvart'}`}</small></button></li>})}</ol></details></nav>
          <article className="dashboard-panel exam-question" aria-labelledby="question-title">
            <p className="section-label">Oppgave {question.number} · Maks {question.max_points} poeng · Kildeside {question.source_pages.join(', ')}</p>
            <h2 id="question-title" ref={title} tabIndex={-1}>{question.title}</h2>
            {question.review_status==='manual'&&<p className="exam-review" role="note">Til manuell kontroll: {question.review_note} Automatisk retting er deaktivert.</p>}
            {question.kind==='visual'&&<p className="muted">Velg plassering i menyene i stedet for å dra. Originalfiguren vises som referanse.</p>}
            <ReviewedQuestion key={question.number} question={question} answer={state.draft} onChange={editor.edit} disabled={locked||state.blocked||state.locking} attempt={data.attempt.id} api={api} canReview={canReview} response={row}/>
            <div className="exam-save" role="status">{state.busy?'Lagrer / kontrollerer …':state.blocked?'Lagring må avklares':locked?'Svaret er levert og låst':state.dirty?'Endringer venter på lagring …':'Lagret'}</div>
            {state.error&&<div role="alert"><p>{state.error}</p><div className="exam-actions"><button disabled={busy} onClick={()=>void editor.recover()}>Kontroller lagring</button><button disabled={busy} onClick={()=>void editor.retry()}>Prøv samme lagring igjen</button><button className="secondary-button" disabled={busy} onClick={()=>{if(window.confirm('Forkaste lokalt utkast og hente den lagrede serverversjonen?'))void editor.refresh(true)}}>Hent serverversjon</button></div></div>}
            {!locked&&data.attempt.feedback==='each'&&question.max_points>0&&<button disabled={busy||state.blocked} onClick={()=>{if(window.confirm('Levere og låse svaret på denne oppgaven?'))void editor.save(true)}}>Lever oppgave</button>}
            {canReview&&question.max_points>0&&<>
              <p className="muted">{scoringRule(data.attempt.scoring_version)}</p>
              <button className="secondary-button" disabled={guideBusy||Boolean(guidance)} onClick={()=>void showGuide()}>{guideBusy?'Henter …':'Vis fasit / sensorveiledning'}</button>
              {guideError&&<p role="alert">{guideError}</p>}{guidance&&<GuidanceView data={guidance} question={question}/>}
              {question.grading!=='automatic'&&<div className="exam-field"><label htmlFor="exam-assessment">Egenvurdering</label><select id="exam-assessment" disabled={busy||state.blocked} value={row?.self_assessment??''} onChange={e=>void editor.assess(e.target.value||null)}><option value="">Ikke vurdert</option><option value="full">Full uttelling</option><option value="partial">Delvis uttelling (halv)</option><option value="none">Ingen uttelling</option></select></div>}
            </>}
            <div className="exam-actions exam-next"><button className="secondary-button" disabled={busy||state.blocked||state.number===data.questions[0].number} onClick={()=>void navigate(data.questions[data.questions.indexOf(question)-1].number)}>← Forrige</button><button className="secondary-button" disabled={busy||state.blocked||state.number===data.questions.at(-1)?.number} onClick={()=>void navigate(data.questions[data.questions.indexOf(question)+1].number)}>Neste →</button></div>
          </article>
        </div>
        {!data.attempt.submitted_at&&<div className="exam-finish"><p>Du kan fortsette senere. Innlevering låser alle svar, også ubesvarte.</p><button disabled={busy||state.blocked} onClick={()=>{if(window.confirm(`Levere hele forsøket? ${summary.unanswered} oppgaver er ubesvart.`))void editor.finish()}}>Lever hele eksamenen</button></div>}
      </>}
    </main>
  </>
}
