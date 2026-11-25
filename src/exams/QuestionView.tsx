import { useEffect, useState } from 'react'
import type { ExamApi } from './api'
import type { Answer, Block, Feedback, Field, Guidance, Question } from './model'

function AnswerField({ field:f, value, onChange, disabled, number, correct }: { field:Field; value:string|string[]|undefined; onChange:(value:string|string[])=>void; disabled:boolean; number:number; correct?:string|string[] }) {
  const id=`exam-${number}-${f.id}`
  const review=correct!==undefined && disabled
  if (f.kind==='text') return <label className="exam-field" htmlFor={id}>{f.label}<textarea id={id} rows={8} maxLength={50000} disabled={disabled} value={typeof value==='string'?value:''} onChange={e=>onChange(e.target.value)} /></label>
  if (f.kind==='select') return <div className={`exam-field${review?value===correct?' exam-answer-correct':' exam-answer-incorrect':''}`}><label htmlFor={id}>{f.label}</label><select id={id} disabled={disabled} aria-describedby={review?id+'-feedback':undefined} value={typeof value==='string'?value:''} onChange={e=>onChange(e.target.value)}>
    <option value="">Velg alternativ</option>{f.options?.map(o=><option key={o.id} value={o.id}>{o.text}</option>)}
  </select>{review&&<p className="exam-choice-feedback" id={id+'-feedback'}><span aria-hidden="true">{value===correct?'✓':'✕'} </span>{value===correct?'Riktig svar':`${value?'Feil svar':'Ubesvart'}. Riktig svar: ${f.options?.find(o=>o.id===correct)?.text??''}`}</p>}</div>
  return <fieldset className="exam-options" disabled={disabled}><legend>{f.label}</legend>{f.options?.map(o=>{
    const selected=f.kind==='multiple'?Array.isArray(value)&&value.includes(o.id):value===o.id
    const expected=Array.isArray(correct)?correct.includes(o.id):correct===o.id
    const mark=review&&(expected||selected)
    return <label key={o.id} className={mark?expected?'exam-answer-correct':'exam-answer-incorrect':undefined}>
    <input type={f.kind==='multiple'?'checkbox':'radio'} name={id} value={o.id}
      checked={selected}
      onChange={e=>onChange(f.kind==='multiple' ? e.target.checked ? [...(Array.isArray(value)?value:[]),o.id] : (Array.isArray(value)?value:[]).filter(id=>id!==o.id) : o.id)} />
    <span>{o.text}{mark&&<span className="exam-choice-feedback"><span aria-hidden="true">{expected?'✓':'✕'} </span>{expected?selected?'Riktig svar – valgt':'Riktig svar – ikke valgt':'Feil svar – valgt'}</span>}</span>
  </label>})}</fieldset>
}
function PromptImage({ block, attempt, api }: { block:Extract<Block,{type:'image'}>; attempt:string; api:ExamApi }) {
  const [data,setData]=useState<string|null>(null),[error,setError]=useState(false),[expanded,setExpanded]=useState(false),[retry,setRetry]=useState(0)
  useEffect(()=>{let live=true;setData(null);setError(false);api.asset(attempt,block.asset).then(a=>{if(live)setData(a.base64)}).catch(()=>{if(live)setError(true)});return()=>{live=false}},[attempt,block.asset,api,retry])
  return <figure className="exam-figure">
    {!data ? error?<><p role="alert">Kunne ikke hente figuren.</p><button type="button" onClick={()=>setRetry(v=>v+1)}>Prøv figuren igjen</button></>:<p role="status">Henter figur …</p> : <>
      <div className="exam-image-scroll" tabIndex={expanded?0:undefined} role={expanded?'region':undefined} aria-label={expanded?'Forstørret figur. Rull for å se hele.':undefined}><img className={expanded?'expanded':''} src={`data:image/png;base64,${data}`} alt={block.alt} /></div>
      <button type="button" className="text-button" aria-expanded={expanded} onClick={()=>setExpanded(v=>!v)}>{expanded?'Tilpass figur':'Forstørr figur'}</button>
    </>}
  </figure>
}
export function QuestionView({ question:q, answer, onChange, disabled, attempt, api, feedback }: { question:Question; answer:Answer; onChange:(answer:Answer)=>void; disabled:boolean; attempt:string; api:ExamApi; feedback?:Feedback|null }) {
  return <div className={`exam-prompt exam-kind-${q.kind}`}>{q.prompt.blocks.map((b,index)=>b.type==='text'?<p key={index} className="exam-original">{b.text}</p>
    :b.type==='image'?<PromptImage key={index} block={b} attempt={attempt} api={api}/>
      :<AnswerField key={index} number={q.number} field={q.prompt.fields.find(f=>f.id===b.id)!} value={answer[b.id]} disabled={disabled} correct={feedback?.available?feedback.correct[b.id]:undefined} onChange={v=>onChange({...answer,[b.id]:v})}/>)}</div>
}
export function GuidanceView({ data, question, ai }: { data:Guidance; question:Question; ai:boolean }) {
  const label=ai?'AI-generert løsningsveiledning':'Offisiell sensorveiledning'
  return <section className="exam-guidance" aria-labelledby="guidance-title"><h3 id="guidance-title">{label}</h3>
    <p className="muted">Kilde: {data.source_name} · {ai?'del':'side'} {data.pages.join(', ')}. {ai?'Ikke offisiell NTNU-fasit.':'Originale markeringer vises nedenfor.'}</p>
    {Object.keys(data.correct).length>0 && <dl>{question.prompt.fields.map(f=><div key={f.id}><dt>{f.label}</dt><dd>{(Array.isArray(data.correct[f.id])?data.correct[f.id] as string[]:[data.correct[f.id]]).map(id=>f.options?.find(o=>o.id===id)?.text).join(' · ')}</dd></div>)}</dl>}
    {data.assets.map((a,i)=><figure key={a.id}><div className="exam-image-scroll" tabIndex={0} role="region" aria-label={`${ai?'AI-løsningsveiledning':'Sensorveiledning'}, utsnitt ${i+1}`}><img src={`data:image/png;base64,${a.base64}`} alt={`${label} til oppgave ${question.number}, utsnitt ${i+1}.`} /></div></figure>)}
    <p className="muted">{ai?'Oppgaver og løsningsveiledning er AI-generert øvingsmateriale. Rettingen følger de vanlige øvingsreglene; ingen AI-tjeneste vurderer besvarelsen.':'Ingen AI-sensur eller AI-genererte løsningsforslag brukes.'}</p>
  </section>
}
