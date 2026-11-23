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
  const guide=renderToStaticMarkup(createElement(GuidanceView,{question:q,data:{source_name:'Synthetic PDF',pages:[1],correct:{p0:'a'},assets:[]}}));assert.match(guide,/Offisiell sensorveiledning/);assert.match(guide,/Synthetic PDF/);assert.match(guide,/Ingen AI-sensur/)
})
