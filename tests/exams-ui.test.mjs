import assert from 'node:assert/strict'
import test from 'node:test'
import { createServer } from 'vite'
import react from '@vitejs/plugin-react'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
test('exam native fields, original text, locked answers and source-labelled guidance',async t=>{
  const server=await createServer({configFile:false,envFile:false,appType:'custom',logLevel:'silent',server:{middlewareMode:true,hmr:false},plugins:[react()]});t.after(()=>server.close())
  const {QuestionView,GuidanceView}=await server.ssrLoadModule('/src/exams/QuestionView.tsx')
  const fields=['single','multiple','select','text'].map((kind,i)=>({id:'p'+i,label:'Original '+kind,kind,options:[{id:'a',text:'Alternativ æøå'},{id:'b',text:'Alternativ 2'}]}))
  const q={number:2,title:'Synthetic',prompt:{blocks:[{type:'text',text:'Nøyaktig tekst: kommando --flag'},...fields.map(f=>({type:'field',id:f.id}))],fields}}
  const props={question:q,answer:{p0:'a',p1:['b'],p2:'b',p3:'Mitt svar'},onChange:()=>{},disabled:false,attempt:'a',api:{}}
  const html=renderToStaticMarkup(createElement(QuestionView,props))
  assert.match(html,/Nøyaktig tekst: kommando --flag/);assert.match(html,/type="radio"/);assert.match(html,/type="checkbox"/);assert.match(html,/<select/);assert.match(html,/<textarea/);assert.match(html,/Mitt svar/)
  assert.doesNotMatch(html,/Sensorveiledning|correct|fasit/)
  const locked=renderToStaticMarkup(createElement(QuestionView,{...props,disabled:true}));assert.equal((locked.match(/disabled=""/g)??[]).length,4)
  const {isAiMaterial}=await server.ssrLoadModule('/src/exams/model.ts')
  const guidance={question:q,data:{source_name:'Synthetic PDF',pages:[1],correct:{p0:'a'},assets:[]}}
  const guide=renderToStaticMarkup(createElement(GuidanceView,{...guidance,ai:isAiMaterial('dcst2001-h25')}));
  assert.match(guide,/Offisiell sensorveiledning/);assert.match(guide,/Synthetic PDF/);assert.match(guide,/Ingen AI-sensur/)
  const aiGuide=renderToStaticMarkup(createElement(GuidanceView,{...guidance,ai:isAiMaterial('dcst2001-ai-h26-01')}));
  assert.match(aiGuide,/AI-generert løsningsveiledning/);assert.match(aiGuide,/del 1/)
  assert.doesNotMatch(aiGuide,/Offisiell sensorveiledning|Ingen AI-sensur eller AI-genererte løsningsforslag brukes/)
  assert.equal(isAiMaterial('original-dcst2001-ai-h26-01'),false)
  const feedback={available:true,correct:{p0:'b',p1:['a','b'],p2:'a'}}
  const reviewed=renderToStaticMarkup(createElement(QuestionView,{...props,disabled:true,feedback}))
  assert.equal((reviewed.match(/Riktig svar – ikke valgt/g)??[]).length,2)
  assert.match(reviewed,/Riktig svar – valgt/);assert.match(reviewed,/Feil svar – valgt/)
  assert.match(reviewed,/Feil svar\. Riktig svar: Alternativ æøå/)
  assert.match(reviewed,/aria-describedby="exam-2-p2-feedback"/)
  assert.match(reviewed,/aria-hidden="true">✓/);assert.match(reviewed,/aria-hidden="true">✕/)
  assert.match(reviewed,/exam-answer-correct/);assert.match(reviewed,/exam-answer-incorrect/)
  const neutral=renderToStaticMarkup(createElement(QuestionView,{...props,disabled:false,feedback}))
  assert.doesNotMatch(neutral,/exam-answer-correct|exam-answer-incorrect|Riktig svar|Feil svar/)
  const unavailable=renderToStaticMarkup(createElement(QuestionView,{...props,disabled:true,feedback:{...feedback,available:false}}))
  assert.doesNotMatch(unavailable,/Riktig svar|Feil svar/)
  const correct=renderToStaticMarkup(createElement(QuestionView,{...props,answer:{p0:'b',p1:['a','b'],p2:'a'},disabled:true,feedback}))
  assert.doesNotMatch(correct,/Feil svar|ikke valgt/);assert.match(correct,/Riktig svar<\/p>/)
})
