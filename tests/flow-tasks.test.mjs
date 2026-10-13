import assert from 'node:assert/strict'
import test from 'node:test'
import { createClient } from '@supabase/supabase-js'
import { taskFields, taskQueue, deadlineLabel, taskDayTime, createTaskApi, taskApplied } from '../src/lib/flow-tasks.ts'
import { startActivityCommand } from '../src/lib/flow-activity.ts'
import { createFlowApi, mapFlowTask } from '../src/lib/flow-work.ts'
import { createFlowStore } from '../src/lib/flow-work-store.ts'

const id=n=>`10000000-0000-4000-8000-${String(n).padStart(12,'0')}`
const at='2026-10-13T12:00:00Z', now=Date.parse(at)
const task=(n,deadline=null)=>({id:id(n),title:'Task '+n,description:'',area_id:null,deadline_at:deadline,status:'active',completed_at:null,created_at:at,updated_at:at})
const state=current=>({current,server_time:at,next_boundary_at:'2026-10-13T04:00:00Z',next_cutoff_at:'2026-10-14T04:00:00Z',legacy_active:false})
const day={id:id(90),started_at:'2026-10-13T08:00:00Z',ended_at:null,cutoff_at:'2026-10-14T04:00:00Z'}
const snapshot={work_day:day,segments:[
  {id:id(91),task_id:id(1),started_at:'2026-10-13T08:00:00Z',ended_at:'2026-10-13T09:00:00Z'},
  {id:id(92),task_id:id(2),started_at:'2026-10-13T09:00:00Z',ended_at:'2026-10-13T10:00:00Z'},
  {id:id(93),task_id:id(1),started_at:'2026-10-13T11:00:00Z',ended_at:null},
],server_time:at}

test('queue is deterministic: overdue, upcoming, no deadline; completed excluded, nothing auto-completes',()=>{
  const values=[task(1),task(2,'2026-10-14T10:00:00Z'),task(3,'2026-10-12T10:00:00Z'),task(4,'2026-10-11T10:00:00Z'),task(5,'2026-10-13T14:00:00Z'),task(6)]
  const original=structuredClone(values)
  assert.deepEqual(taskQueue(values,now).map(t=>t.id),[4,3,5,2,1,6].map(id))
  assert.deepEqual(taskQueue(values,now+86400000).map(t=>t.id),[4,3,5,2,1,6].map(id))
  assert.deepEqual(values,original)
  assert.deepEqual(taskQueue([{...task(1),status:'completed',completed_at:at}],now),[])
  assert.deepEqual(taskQueue([task(2,at),task(1,at)],now).map(t=>t.id),[id(1),id(2)])
  assert.equal(deadlineLabel(task(1),now),'Ingen frist')
  assert.equal(deadlineLabel(task(1,'2026-10-11T11:00:00Z'),now),'Forfalt med 2 dager')
  assert.equal(deadlineLabel(task(1,'2026-10-13T06:00:00Z'),now),'Forfalt med 6 t')
  assert.equal(deadlineLabel(task(1,'2026-10-13T11:59:59Z'),now),'Forfalt med under 1 t')
  assert.doesNotMatch(deadlineLabel({...task(1,'2026-10-12T10:00:00Z'),status:'completed',completed_at:at},now),/Forfalt/)
})
test('deadline input validates local DST and preserves unchanged absolute precision; no assumed Oslo zone',()=>{
  const previous=process.env.TZ
  try {
    for(const zone of ['UTC','Europe/Oslo','America/New_York']) {
      process.env.TZ=zone
      const fields=taskFields('  Read  ','', '', '2026-11-12T14:00')
      assert.equal(fields.title,'Read'); assert.equal(fields.areaId,null)
      assert.equal(new Date(fields.deadline).getHours(),14)
      assert.equal(taskFields('Read','', '', '').deadline,null)
      assert.throws(()=>taskFields('Read','', '', '2026-02-30T14:00'))
    }
    process.env.TZ='Europe/Oslo'
    assert.throws(()=>taskFields('Read','','','2026-03-29T02:30'),/finnes ikke/)
    assert.throws(()=>taskFields('Read','','','2026-10-25T02:30'),/to ganger/)
    const exact='2026-10-25T01:30:00.123456Z'
    assert.equal(taskFields('Read','','','2026-10-25T02:30:00',exact).deadline,exact)
    assert.throws(()=>taskFields('  ','','',''))
    assert.throws(()=>taskFields('x'.repeat(201),'','',''))
    assert.throws(()=>taskFields('Title','x'.repeat(2001),'',''))
  } finally { if(previous===undefined) delete process.env.TZ; else process.env.TZ=previous }
})
test('task work sums multiple native periods, excludes pauses/other tasks, clips at cutoff',()=>{
  assert.deepEqual(taskDayTime(snapshot,id(1),now),{work:7200000,current:3600000})
  assert.deepEqual(taskDayTime(snapshot,id(2),now),{work:3600000,current:0})
  assert.deepEqual(taskDayTime(null,id(1),now),{work:0,current:0})
  assert.deepEqual(taskDayTime(snapshot,id(1),Date.parse(day.cutoff_at)+99999),taskDayTime(snapshot,id(1),Date.parse(day.cutoff_at)))
})
test('shared activity builder selects start/resume/atomic switch and rejects archived/completed tasks',()=>{
  let n=200; const uuid=()=>id(n++), catalog={areas:[],tasks:[task(1)]}, activity={areaId:null,taskId:id(1)}
  const started=startActivityCommand(activity,state(null),catalog,uuid,()=> 'UTC')
  assert.equal(started.kind,'start'); assert.equal(started.areaId,null); assert.equal(started.taskId,id(1))
  const switched=startActivityCommand(activity,state(snapshot),catalog,uuid)
  assert.equal(switched.kind,'activity'); assert.equal(switched.expectedId,id(93)); assert.equal(switched.expectedCount,3)
  const paused=structuredClone(snapshot); paused.segments.at(-1).ended_at=at
  assert.equal(startActivityCommand(activity,state(paused),catalog,uuid).expectedId,null)
  assert.throws(()=>startActivityCommand(activity,state(null),catalog,uuid,()=>null),/tidssone/)
  assert.throws(()=>startActivityCommand(activity,state(null),{areas:[],tasks:[{...task(1),status:'completed',completed_at:at}]},uuid))
  assert.throws(()=>startActivityCommand({areaId:id(8),taskId:null},state(null),{areas:[{id:id(8),is_archived:true}],tasks:[]},uuid))
})
test('task SDK uses safe RPC payloads and validates aggregate; no user IDs or client timestamps',async()=>{
  const requests=[]; let fail=false
  const client=createClient('https://example.supabase.co','sb_publishable_test',{auth:{persistSession:false},global:{fetch:async(url,options)=>{
    requests.push({url:String(url),body:JSON.parse(options.body)})
    return new Response(JSON.stringify(fail?{message:'private SQL detail'}:String(url).endsWith('flow_task_time')?
      {task_id:id(1),work_milliseconds:1234.56,server_time:at}:task(1)),{status:fail?400:200})
  }}})
  const api=createTaskApi(client),signal=new AbortController().signal
  const command={kind:'save-task',taskId:id(1),expected:null,...taskFields('Task 1','','','')}
  await api.mutate(command,signal); await api.mutate({kind:'status-task',taskId:id(1),expected:at,status:'completed'},signal)
  assert.equal((await api.time(id(1),signal)).work_milliseconds,1234.56)
  assert.deepEqual(Object.keys(requests[0].body).sort(),['p_task_id','p_title','p_description','p_area_id','p_deadline_at','p_expected_updated_at'].sort())
  assert.equal(requests[1].body.p_status,'completed'); assert.deepEqual(requests[2].body,{p_task_id:id(1)})
  fail=true; await assert.rejects(api.mutate(command,signal),error=>!error.message.includes('SQL'))
  await assert.rejects(api.time(id(1),signal))
  assert.throws(()=>mapFlowTask({...task(1),updated_at:'invalid'}))
})
test('catalog loads later pages instead of silently dropping tasks at API row limit',async()=>{
  const offsets=[]
  const client=createClient('https://example.supabase.co','sb_publishable_test',{auth:{persistSession:false},global:{fetch:async url=>{
    const address=new URL(url)
    if(address.pathname.endsWith('flow_areas')) return new Response('[]')
    const offset=Number(address.searchParams.get('offset')); offsets.push(offset)
    return new Response(JSON.stringify(offset===0?Array.from({length:500},(_,i)=>task(i+1)):[task(501)]))
  }}})
  const catalog=await createFlowApi(client).catalog(new AbortController().signal)
  assert.equal(catalog.tasks.length,501); assert.deepEqual(offsets,[0,500])
})
const tick=()=>new Promise(r=>setImmediate(r))
test('single store reconciles committed task completion and timer pause after lost reply',async()=>{
  let row=task(1),current=structuredClone(snapshot),writes=0
  const api={load:async()=>state(current),catalog:async()=>({areas:[],tasks:[row]}),snapshot:async()=>current,
    mutate:async command=>{writes++; row={...row,status:command.status,completed_at:at,updated_at:'2026-10-13T12:00:01Z'}; current.segments.at(-1).ended_at=at; throw new Error('Lost reply')},act:async()=>{throw Error('Must not call timer API')}}
  const store=createFlowStore(api,{timezone:()=> 'UTC'}); store.connect(); await tick()
  const command={kind:'status-task',taskId:id(1),expected:at,status:'completed'}
  assert.equal(await store.dispatch(command),true)
  assert.equal(writes,1); assert.equal(store.getSnapshot().phase,'paused'); assert.equal(store.getSnapshot().catalog.tasks[0].status,'completed')
  assert.match(store.getSnapshot().notice,/bekreftet/); assert.equal(store.getSnapshot().pending,null)
  store.disconnect()
})
test('failed task write/read preserves exact command; retry is explicit and other timer writes remain blocked',async()=>{
  let fail=false,row=task(1),seen=[]
  const api={load:async()=>{if(fail)throw Error('Offline');return state(null)},catalog:async()=>({areas:[],tasks:[row]}),
    mutate:async c=>{seen.push(c);if(fail)throw Error('Offline'); row={...row,title:c.title}},act:async()=>{throw Error('Must not run')}}
  const store=createFlowStore(api,{timezone:()=> 'UTC'});store.connect();await tick();fail=true
  const command={kind:'save-task',taskId:id(1),expected:at,...taskFields('Renamed','','','')}
  assert.equal(await store.dispatch(command),false); assert.equal(store.getSnapshot().phase,'error')
  assert.deepEqual(store.getSnapshot().pending,command); assert.equal(await store.dispatch(command),false)
  fail=false;assert.equal(await store.retry(),true);assert.deepEqual(seen,[command,command])
  assert.equal(taskApplied(command,store.getSnapshot().catalog.tasks),true);store.disconnect()
})
