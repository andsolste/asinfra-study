import assert from 'node:assert/strict'
import test from 'node:test'
import { dayDetails } from '../src/lib/day-details.ts'
import { mapFlowSnapshot, flowDurations } from '../src/lib/flow-work.ts'
import { buildNativeCorrection, nativeDraft } from '../src/lib/native-period.ts'
import { createFlowHistoryStore } from '../src/lib/flow-history-store.ts'
import { NativeCorrectionError } from '../src/lib/flow-history.ts'

const id=n=>`10000000-0000-4000-8000-${String(n).padStart(12,'0')}`
const now=Date.parse('2026-11-03T15:00:00Z'),server=new Date(now).toISOString()
function snapshot() {
  const from='2026-11-03T08:00:03.123456Z'
  return mapFlowSnapshot({server_time:server,work_day:{id:id(1),logical_date:'2026-11-03',timezone:'UTC',boundary_at:'2026-11-03T04:00:00Z',cutoff_at:'2026-11-04T04:00:00Z',started_at:from,ended_at:null,created_at:from},
    segments:[{id:id(2),work_day_id:id(1),started_at:from,ended_at:'2026-11-03T09:00:04.654321Z',area_id:id(4),task_id:id(5),created_at:from},
      {id:id(3),work_day_id:id(1),started_at:'2026-11-03T10:00:00.000001Z',ended_at:null,area_id:null,task_id:null,created_at:from}]})
}
const catalog={areas:[],tasks:[]},entry=s=>({id:s.work_day.id,source:'flow',snapshot:s,key:'flow:'+s.work_day.id,started_at:s.work_day.started_at})
const tick=()=>new Promise(resolve=>setImmediate(resolve))

test('day editor pins exact original snapshot through background reads, missing row, cutoff and new day',()=>{
  const s=snapshot(),editor={snapshot:s,segment:s.segments[0]},before=structuredClone(s)
  for(const change of [
    d=>d.segments[1].ended_at='2026-11-03T12:00:00Z',
    d=>{d.work_day.ended_at=d.work_day.cutoff_at;d.segments[1].ended_at=d.work_day.cutoff_at},
  ]) {
    const fresh=structuredClone(s);change(fresh)
    const result=dayDetails(fresh,null,[],editor,true)
    assert.equal(result.snapshot,s);assert.equal(result.stale,false)
    assert.equal(result.snapshot.segments[0].ended_at,'2026-11-03T09:00:04.654321Z')
  }
  for(const fresh of [null,{...s,work_day:{...s.work_day,id:id(99)}},{...s,segments:s.segments.slice(1)}]) {
    const result=dayDetails(fresh,null,[],editor,true)
    assert.equal(result.snapshot,s);assert.equal(result.stale,true)
  }
  assert.deepEqual(s,before)
})
test('all four expected fields retain full precision and detect stale edits; recovery never rebases',()=>{
  const s=snapshot(),editor={snapshot:s,segment:s.segments[0]}
  for(const fields of [{started_at:'2026-11-03T08:00:03.123457Z'},{ended_at:'2026-11-03T09:00:04.654322Z'},{area_id:null},{task_id:null},{ended_at:null}]) {
    const fresh=structuredClone(s);Object.assign(fresh.segments[0],fields)
    const result=dayDetails(fresh,null,[],editor,true)
    assert.equal(result.stale,true);assert.equal(result.snapshot,editor.snapshot)
    assert.equal(dayDetails(fresh,null,[],editor,false).stale,false,'Do not infer conflicts from unverified/loading data')
    const correction=buildNativeCorrection(editor.snapshot,editor.segment,nativeDraft(s,editor.segment),now,catalog)
    assert.equal(correction.expected.started_at,'2026-11-03T08:00:03.123456Z')
    assert.equal(correction.expected.ended_at,'2026-11-03T09:00:04.654321Z')
    assert.equal(correction.expected.area_id,id(4));assert.equal(correction.expected.task_id,id(5))
  }
})
test('cancel returns to latest day; corrected cached closed day uses refreshed history, never stale cached totals',()=>{
  const old=snapshot();old.work_day.ended_at=old.work_day.cutoff_at;old.segments[1].ended_at='2026-11-03T11:00:00Z'
  const fresh=structuredClone(old);fresh.segments[0].ended_at='2026-11-03T08:30:00Z'
  const selected=dayDetails(null,old,[entry(fresh)],null,true)
  assert.equal(selected.snapshot,fresh);assert.equal(selected.stale,false)
  assert.ok(flowDurations(selected.snapshot,now).work<flowDurations(old,now).work)
  const current=snapshot()
  assert.equal(dayDetails(current,old,[entry(fresh)],null,true).snapshot,current)
  assert.equal(dayDetails(null,old,[],null,true).snapshot,old)
  assert.equal(dayDetails(null,null,[],null,true).snapshot,null)
})
test('current-day corrections reuse bounds, microsecond zero, overlap validation and saved timezone',()=>{
  const s=snapshot(),segment=s.segments[0],draft=nativeDraft(s,segment)
  assert.equal(buildNativeCorrection(s,segment,{...draft,to:'2026-11-03T08:30'},now,catalog).desired.started_at,segment.started_at)
  assert.throws(()=>buildNativeCorrection(s,segment,{...draft,to:'2026-11-03T10:30'},now,catalog),/overlapper/)
  assert.throws(()=>buildNativeCorrection(s,segment,{...draft,from:'2026-11-03T07:59'},now,catalog),/arbeidsdagen/)
  assert.throws(()=>buildNativeCorrection(s,segment,{...draft,to:'2026-11-04T04:01'},now,catalog),/arbeidsdagen/)
  const zero=buildNativeCorrection(s,segment,{...draft,resetToZero:true},now,catalog)
  assert.equal(zero.desired.ended_at,segment.started_at);assert.equal(zero.expected.ended_at,segment.ended_at)
})
test('current day need not exist in paginated history; shared correction lane reconciles lost reply and refreshes statistics',async()=>{
  let s=snapshot(),writes=0,stats=0
  const api={list:async()=>({rows:[],next_cursor:null,server_time:server}),statistics:async()=>{stats++;return {server_time:server,period:{kind:'week',anchor:'2026-11-02'}}},
    correctNative:async input=>{writes++;s={...s,segments:s.segments.map(row=>row.id===input.segmentId?{...row,...input.desired}:row)};throw Error('Lost reply')},nativeSnapshot:async()=>s}
  const store=createFlowHistoryStore(api,'UTC');store.connect();await tick()
  const original=s,segment=s.segments[0],input=buildNativeCorrection(s,segment,{...nativeDraft(s,segment),to:'2026-11-03T08:30'},now,catalog)
  store.prepareCorrection();assert.equal(await store.correctNative(input),true)
  assert.equal(writes,1);assert.equal(store.getSnapshot().rows.length,0);assert.equal(store.getSnapshot().correctionBlocked,null)
  assert.ok(stats>=2);assert.equal(original.segments[0].ended_at,'2026-11-03T09:00:04.654321Z')
  store.disconnect()
})
test('validation keeps current-day draft editable; stale and unknown block until explicit reopen, never auto-retry',async()=>{
  for(const kind of ['validation','conflict','unknown']) {
    const s=snapshot(),editor={snapshot:s,segment:s.segments[0]};let writes=0
    const api={list:async()=>({rows:[],next_cursor:null,server_time:server}),statistics:async()=>({server_time:server,period:{kind:'week',anchor:'2026-11-02'}}),
      correctNative:async()=>{writes++;throw new NativeCorrectionError(kind,'Controlled correction failure')},nativeSnapshot:async()=>{throw Error('Offline')}}
    const store=createFlowHistoryStore(api,'UTC');store.connect();await tick()
    const input=buildNativeCorrection(s,editor.segment,{...nativeDraft(s,editor.segment),to:'2026-11-03T08:30'},now,catalog)
    assert.equal(await store.correctNative(input),false)
    assert.equal(store.getSnapshot().correctionBlocked,kind==='validation'?null:id(2))
    await store.refresh();assert.equal(writes,1)
    assert.equal(dayDetails(snapshot(),null,store.getSnapshot().rows,editor,true).snapshot,editor.snapshot)
    if(kind!=='validation'){assert.equal(await store.correctNative(input),false);assert.equal(writes,1)}
    store.prepareCorrection();assert.equal(store.getSnapshot().correctionBlocked,null)
    store.disconnect()
  }
})
