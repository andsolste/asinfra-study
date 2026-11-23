import assert from 'node:assert/strict'
import test from 'node:test'
import { createExamEditor } from '../src/exams/editor.ts'
import { answerState, resultSummary } from '../src/exams/model.ts'
const fixture=()=>({attempt:{id:'a',revision:0,feedback:'end',submitted_at:null,current_question:2},exam:{title:'Synthetic'},server_time:'2026-11-20T12:00Z',questions:[{number:1,max_points:0,prompt:{fields:[{id:'p1',kind:'text'}]}},{number:2,max_points:2,prompt:{fields:[{id:'p1',kind:'single'},{id:'p2',kind:'single'}]}},{number:3,max_points:4,prompt:{fields:[{id:'p1',kind:'text'}]}},{number:4,max_points:3,prompt:{fields:[{id:'p1',kind:'multiple'}]}}],responses:[]})
function setup(){let server=fixture(),fail=null,id=0,hold=null
  const api={get:async()=>{if(fail==='offline')throw Error();return structuredClone(server)},save:async p=>{if(hold)await hold;if(fail==='stale')throw Error();if(fail==='offline')throw Error();const old=server.responses.find(r=>r.number===p.number);if((old?.revision??0)!==p.expected)throw Error('stale');const r={number:p.number,answer:p.answer,revision:p.expected+1,submitted_at:p.submit?'now':null,last_request:p.request,auto_points:null,self_assessment:null};server.responses=server.responses.filter(r=>r.number!==p.number).concat(r);server.attempt.revision++;if(fail==='lost')throw Error();return structuredClone(server)},submit:async()=>{server.attempt.submitted_at='now';return structuredClone(server)},assess:async()=>server}
  const editor=createExamEditor(api,()=>String(++id));editor.install(structuredClone(server))
  return {editor,api,get server(){return server},setFail:v=>{fail=v},setHold:v=>{hold=v}}
}
test('exam answer coverage and split results exclude notes, separate blanks, partial, auto and self',()=>{
  const d=fixture(),q=d.questions[1];assert.equal(answerState(q,{}),'empty');assert.equal(answerState(q,{p1:'a'}),'partial');assert.equal(answerState(q,{p1:'a',p2:'b'}),'complete')
  assert.equal(answerState(d.questions[2],{p1:'   '}),'empty');assert.equal(answerState(d.questions[3],{p1:[]}),'empty')
  d.responses=[{number:1,answer:{p1:'notes'}},{number:2,answer:{p1:'a',p2:'b'},auto_points:2},{number:3,answer:{p1:'essay'},self_assessment:'partial'}]
  assert.deepEqual(resultSummary(d),{automatic:2,automaticMax:2,self:2,selfMax:4,unassessed:0,unanswered:1,complete:2,partial:0})
})
test('autosave and resume use server answers; edits during an in-flight save stay dirty',async()=>{
  const {editor,setHold,server}=setup();editor.edit({p1:'a'})
  let release;setHold(new Promise(r=>{release=r}));const saved=editor.save();editor.edit({p1:'a',p2:'b'});release();await saved
  assert.equal(editor.getSnapshot().dirty,true);assert.deepEqual(editor.getSnapshot().draft,{p1:'a',p2:'b'})
  await editor.save();assert.equal(editor.getSnapshot().dirty,false)
  const second=createExamEditor({});second.install(editor.getSnapshot().data);assert.deepEqual(second.getSnapshot().draft,{p1:'a',p2:'b'})
  assert.equal(server.responses.length,1)
})
test('navigation/final submit cannot discard an edit typed while flushing',async()=>{
  const {editor,setHold}=setup();editor.edit({p1:'a'});let release;setHold(new Promise(r=>{release=r}));const next=editor.navigate(3);editor.edit({p1:'b'});release();assert.equal(await next,false);assert.equal(editor.getSnapshot().number,2);assert.equal(editor.getSnapshot().draft.p1,'b')
})
test('unknown write is reconciled only by request identity; no duplicate save after a lost response',async()=>{
  const {editor,setFail}=setup();setFail('lost');editor.edit({p1:'a'});assert.equal(await editor.save(),true)
  assert.equal(editor.getSnapshot().blocked,false);assert.equal(editor.getSnapshot().dirty,false);assert.equal(editor.getSnapshot().data.responses[0].revision,1)
})
test('stale tabs preserve their draft and frozen expected revision until explicit server reload',async()=>{
  const {editor,server}=setup();editor.edit({p1:'my draft'});server.responses=[{number:2,revision:1,answer:{p1:'other tab'},last_request:'other'}]
  assert.equal(await editor.save(),false);assert.equal(editor.getSnapshot().blocked,true)
  assert.equal(await editor.navigate(3),false);assert.equal(await editor.refresh(),false)
  assert.equal(await editor.retry(),false);assert.equal(editor.getSnapshot().draft.p1,'my draft')
  await editor.refresh(true);assert.equal(editor.getSnapshot().draft.p1,'other tab');assert.equal(editor.getSnapshot().blocked,false)
})
test('offline recovery keeps local answer; locks protect submitted and separate attempts',async()=>{
  const {editor,setFail}=setup();setFail('offline');editor.edit({p1:'keep me'});await editor.save();assert.equal(editor.getSnapshot().draft.p1,'keep me');assert.equal(editor.getSnapshot().blocked,true)
  setFail(null);await editor.retry();assert.equal(editor.getSnapshot().dirty,false)
  await editor.save(true);editor.edit({p1:'cannot change'});assert.equal(editor.getSnapshot().draft.p1,'keep me')
  editor.install(fixture());assert.deepEqual(editor.getSnapshot().draft,{})
})
test('a background read cannot replace typing that starts during the read',async()=>{
  const {editor,api}=setup();let release
  api.get=()=>new Promise(r=>{release=r})
  const refresh=editor.refresh();editor.edit({p1:'Started typing during focus refresh'})
  release(fixture());assert.equal(await refresh,false)
  assert.equal(editor.getSnapshot().draft.p1,'Started typing during focus refresh');assert.equal(editor.getSnapshot().dirty,true)
})
test('a new exam can start at any original number; final submission freezes further typing',async()=>{
  const {editor,api}=setup(),other=fixture();other.questions=[{number:10,max_points:1,prompt:{fields:[{id:'p1',kind:'text'}]}}];other.attempt.id='another';other.attempt.current_question=10
  editor.install(other);assert.equal(editor.getSnapshot().number,10)
  let release;api.submit=()=>new Promise(r=>{release=r})
  const finish=editor.finish();await new Promise(r=>setTimeout(r,0));assert.equal(editor.getSnapshot().locking,true)
  editor.edit({p1:'Too late'});assert.deepEqual(editor.getSnapshot().draft,{})
  release({...other,attempt:{...other.attempt,submitted_at:'now'}});assert.equal(await finish,true)
})
