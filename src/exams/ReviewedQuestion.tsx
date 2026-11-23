import {useEffect,useState} from 'react'
import type {ComponentProps} from 'react'
import type {Feedback,Response} from './model'
import {formatPoints} from './model'
import {QuestionView} from './QuestionView'

// Only the gated server endpoint supplies answer keys; guidance images are
// fetched separately by the existing explicit button. Nothing is cached.
export function ReviewedQuestion({canReview,response,...props}:ComponentProps<typeof QuestionView>&{canReview:boolean;response?:Response}) {
  const {attempt,question,api}=props
  const eligible=canReview&&question.grading==='automatic'&&question.review_status==='verified'
  const identity=`${attempt}:${question.number}:${response?.revision}:${eligible}`
  const [result,setResult]=useState<{identity:string;feedback:Feedback|null;error:boolean}|null>(null)
  const [retry,setRetry]=useState(0)
  useEffect(()=>{
    if(!eligible)return
    let live=true;setResult(null)
    api.feedback(attempt,question.number).then(feedback=>{
      if(feedback.attempt_id!==attempt||feedback.number!==question.number||feedback.response_revision!==response?.revision)throw Error('Feedback snapshot changed')
      if(live)setResult({identity,feedback,error:false})
    }).catch(()=>{if(live)setResult({identity,feedback:null,error:true})})
    return()=>{live=false}
  },[identity,retry,api,attempt,question.number,response?.revision,eligible])
  const current=result?.identity===identity?result:null
  const feedback=eligible?current?.feedback:null
  const matching=question.prompt.fields.every(f=>f.kind==='select')
  const choices=question.prompt.fields.some(f=>f.kind==='multiple')
  return <>
    <QuestionView {...props} feedback={feedback}/>
    {canReview&&response?.auto_points!=null&&<p className="exam-feedback-summary" role="status">
      Øvingspoeng: <strong>{formatPoints(response.auto_points)} / {formatPoints(question.max_points)}</strong>
      {feedback?.available&&<span> – {choices?`${feedback.correct_choices} riktige valg, ${feedback.incorrect_choices} feil valg`:`${feedback.correct_fields} av ${feedback.total_fields} ${matching?'koblinger':'svarfelt'} riktige`}</span>}
    </p>}
    {eligible&&(!current?<p className="exam-save" role="status">Kontrollerer svar …</p>:current.error?<div role="alert"><p>Kunne ikke hente svarmarkeringene. Det lagrede resultatet er beholdt.</p><button type="button" className="text-button" onClick={()=>setRetry(v=>v+1)}>Prøv svarmarkeringene igjen</button></div>:null)}
  </>
}
