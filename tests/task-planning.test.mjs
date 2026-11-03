import assert from 'node:assert/strict'
import test from 'node:test'
import { createClient } from '@supabase/supabase-js'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { createServer } from 'vite'
import react from '@vitejs/plugin-react'
import { currentWeek, weekStartForDate, weekStartFromInput, weekInput, shiftWeek, weeklyTasks, weekLabel, planningFields, moveToWeek } from '../src/lib/task-planning.ts'
import { mapFlowTask } from '../src/lib/flow-work.ts'
import { createTaskApi, taskApplied, TaskActionError } from '../src/lib/flow-tasks.ts'
import { createFlowStore } from '../src/lib/flow-work-store.ts'

const at = '2026-11-03T12:00:00.123456Z', id = n => `10000000-0000-4000-8000-${String(n).padStart(12,'0')}`
const task = (n, fields = {}) => ({ id:id(n),title:'Oppgave '+n,description:'Behold',area_id:null,deadline_at:at,week_start:'2026-11-02',priority:'normal',status:'active',completed_at:null,created_at:at,updated_at:at,...fields })
const state = { current:null,server_time:at,next_boundary_at:'2026-11-03T04:00:00Z',next_cutoff_at:'2026-11-04T04:00:00Z',legacy_active:false }
const tick = () => new Promise(resolve => setImmediate(resolve))

test('ISO weeks: Monday/Sunday, week 53, year boundaries, leap year, invalid dates and round trips', () => {
  for (const [date, week, input] of [
    ['2021-01-01','2020-12-28','2020-W53'],['2021-01-03','2020-12-28','2020-W53'],
    ['2021-01-04','2021-01-04','2021-W01'],['2025-12-31','2025-12-29','2026-W01'],
    ['2027-01-01','2026-12-28','2026-W53'],['2027-01-04','2027-01-04','2027-W01'],
    ['2024-02-29','2024-02-26','2024-W09'],['2026-03-29','2026-03-23','2026-W13'],
  ]) {
    assert.equal(weekStartForDate(date), week); assert.equal(weekInput(week), input); assert.equal(weekStartFromInput(input), week)
  }
  assert.equal(shiftWeek('2026-12-28',1),'2027-01-04'); assert.equal(shiftWeek('2027-01-04',-1),'2026-12-28')
  assert.equal(weekLabel('2025-12-29'),'Uke 1 · 2026'); assert.equal(weekStartFromInput(''),null)
  for (const value of ['2021-W53','2026-W00','2026-W54','2026-W1','bad','0000-W01']) assert.throws(() => weekStartFromInput(value))
  for (const value of ['2026-02-30','2026-13-01','2026-1-01']) assert.throws(() => weekStartForDate(value))
  for (let n=0;n<800;n++) { const monday=shiftWeek('2018-01-01',n); assert.equal(weekStartFromInput(weekInput(monday)),monday) }
})
test('calendar weeks respect the local calendar, including Sunday/Monday around DST; no timer 04:00 shift', () => {
  const old = process.env.TZ
  try {
    for (const zone of ['UTC','Europe/Oslo','America/New_York']) {
      process.env.TZ=zone
      assert.equal(currentWeek(new Date(2026,10,1,23,59).getTime()),'2026-10-26')
      assert.equal(currentWeek(new Date(2026,10,2,0,0).getTime()),'2026-11-02')
      assert.equal(currentWeek(new Date(2026,10,2,3,30).getTime()),'2026-11-02')
    }
    assert.equal(currentWeek(0),null); assert.equal(currentWeek(NaN),null)
  } finally { if(old===undefined)delete process.env.TZ;else process.env.TZ=old }
})
test('priority sort, progress empty/all/reopened and earlier unfinished only; unscheduled tasks unchanged', () => {
  const rows=[task(1,{priority:'low'}),task(3,{priority:'high'}),task(2,{priority:'high',status:'completed',completed_at:at}),
    task(4,{week_start:null}),task(5,{week_start:'2026-10-26'}),task(6,{week_start:'2026-10-26',status:'completed',completed_at:at}),task(7,{week_start:'2026-11-09'})]
  const original=structuredClone(rows),plan=weeklyTasks(rows,'2026-11-02')
  assert.deepEqual(plan.tasks.map(t=>t.id),[2,3,1].map(id)); assert.deepEqual(plan.previous.map(t=>t.id),[id(5)])
  assert.equal(plan.completed,1); assert.equal(plan.total,3)
  assert.deepEqual(weeklyTasks([],'2026-11-02'),{tasks:[],previous:[],completed:0,total:0})
  const all=rows.map(row=>({...row,status:'completed',completed_at:at}));assert.equal(weeklyTasks(all,'2026-11-02').completed,3)
  all[0].status='active'; assert.equal(weeklyTasks(all,'2026-11-02').completed,2)
  assert.deepEqual(rows,original); assert.equal(weeklyTasks(rows,'2026-11-09').previous.length,3)
})
test('planning fields and runtime mapper validate metadata; moving preserves precision, priority and frozen revision', () => {
  const original=task(1),command=moveToWeek(original,'2026-11-09')
  assert.equal(command.expected,at); assert.equal(command.deadline,at);assert.equal(command.description,original.description)
  assert.equal(command.weekStart,'2026-11-09'); assert.equal(command.priority,'normal')
  assert.deepEqual(planningFields('','high'),{weekStart:null,priority:'high'})
  assert.throws(()=>planningFields('2026-W45','urgent')); assert.throws(()=>moveToWeek(original,'2026-11-03'))
  assert.equal(taskApplied(command,[{...original,week_start:'2026-11-09'}]),true)
  assert.equal(taskApplied(command,[original]),false)
  assert.equal(taskApplied(command,[{...original,week_start:'2026-11-09',priority:'high'}]),false)
  assert.equal(mapFlowTask(original).week_start,'2026-11-02')
  for(const fields of [{week_start:'2026-11-03'},{week_start:'2026-02-30'},{priority:'urgent'},{priority:null}]) assert.throws(()=>mapFlowTask({...original,...fields}))
})
test('SDK sends atomic eight-argument save; completion/reopen still use the original status API', async () => {
  const requests=[], original=task(1),command=moveToWeek(original,'2026-11-09')
  const client=createClient('https://example.supabase.co','sb_publishable_test',{auth:{persistSession:false},global:{fetch:async(url,options)=>{
    requests.push({url:String(url),body:JSON.parse(options.body)})
    return new Response(JSON.stringify({...original,week_start:'2026-11-09'}))
  }}})
  const api=createTaskApi(client),signal=new AbortController().signal
  await api.mutate(command,signal)
  assert.deepEqual(requests[0].body,{p_task_id:id(1),p_title:original.title,p_description:'Behold',p_area_id:null,p_deadline_at:at,p_expected_updated_at:at,p_week_start:'2026-11-09',p_priority:'normal'})
  for (const status of ['completed','active']) await api.mutate({kind:'status-task',taskId:id(1),expected:at,status},signal)
  assert.ok(requests.slice(1).every(r=>r.url.endsWith('/rpc/flow_task_status') && Object.keys(r.body).length===3))
})
test('shared store: lost planning reply reconciles metadata without duplicate writes; stale move never rebases itself', async () => {
  let row=task(1),mode='lost',writes=[]
  const api={load:async()=>state,catalog:async()=>({areas:[],tasks:[row]}),mutate:async command=>{
    writes.push(command)
    if(mode==='stale')throw new TaskActionError('Oppgaven er endret i en annen fane.')
    row={...row,week_start:command.weekStart,priority:command.priority,updated_at:'2026-11-03T12:01:00.654321Z'}
    throw Error('Lost response')
  },act:async()=>assert.fail('Planning must not call timer transitions')}
  const store=createFlowStore(api,{timezone:()=> 'UTC'});store.connect();await tick()
  const command=moveToWeek(row,'2026-11-09')
  assert.equal(await store.dispatch(command),true);assert.equal(writes.length,1);assert.equal(store.getSnapshot().pending,null)
  mode='stale'; const stale=moveToWeek(row,'2026-11-16')
  row={...row,week_start:'2026-11-23',updated_at:'2026-11-03T12:02:00.123456Z'}
  assert.equal(await store.dispatch(stale),false)
  assert.equal(store.getSnapshot().catalog.tasks[0].week_start,'2026-11-23')
  assert.equal(writes[1].expected,stale.expected);assert.notEqual(writes[1].expected,row.updated_at)
  assert.match(store.getSnapshot().notice,/annen fane/);await store.refresh();assert.equal(writes.length,2)
  store.disconnect();store.connect();await tick();assert.equal(store.getSnapshot().catalog.tasks[0].week_start,'2026-11-23');store.disconnect()
})
test('unknown planning result keeps exact retry payload, blocks timer, and checks all planning fields after refresh', async () => {
  let row=task(1),offline=false,writes=0
  const api={load:async()=>{if(offline)throw Error('offline');return state},catalog:async()=>({areas:[],tasks:[row]}),
    mutate:async command=>{writes++;if(offline)throw Error('offline');row={...row,week_start:command.weekStart,priority:command.priority}},act:async()=>assert.fail('Blocked timer')}
  const store=createFlowStore(api,{timezone:()=> 'UTC'});store.connect();await tick()
  const command=moveToWeek(row,'2026-11-09');offline=true
  assert.equal(await store.dispatch(command),false);assert.deepEqual(store.getSnapshot().pending,command)
  assert.equal(await store.dispatch({kind:'start'}),false)
  offline=false;await store.refresh();assert.equal(writes,1);assert.equal(store.getSnapshot().pending,null)
  assert.equal(store.getSnapshot().catalog.tasks[0].week_start,'2026-11-02')
  store.disconnect()
})
test('weekly UI and task form: native controls, priority labels, progress, empty/loading/error and no accidental writes', {timeout:30000}, async t => {
  const server=await createServer({configFile:false,envFile:false,appType:'custom',logLevel:'silent',server:{middlewareMode:true,hmr:false},plugins:[react()]})
  t.after(()=>server.close())
  const {default:Weekly}=await server.ssrLoadModule('/src/components/WeeklyTasks.tsx')
  const {default:Form}=await server.ssrLoadModule('/src/components/TaskForm.tsx')
  const workspace=tasks=>({phase:'idle',pending:null,data:state,now:Date.parse(at),catalog:{areas:[],tasks},dispatch:()=>assert.fail('Rendering cannot mutate')})
  const html=renderToStaticMarkup(createElement(Weekly,{data:workspace([task(1),task(2,{status:'completed',completed_at:at}),task(3,{week_start:'2026-10-26'})]),onOpen:()=>{}}))
  assert.match(html,/1 av 2 fullført/);assert.match(html,/<progress value="1" max="2"/)
  assert.match(html,/Gjenåpne Oppgave 2/);assert.match(html,/Fullfør Oppgave 1/)
  assert.match(html,/Ufullført fra tidligere uker \(1\)/);assert.match(html,/Flytt Oppgave 3 til valgt uke/)
  assert.match(html,/Forrige planleggingsuke/);assert.match(html,/Neste planleggingsuke/)
  const empty=renderToStaticMarkup(createElement(Weekly,{data:workspace([]),onOpen:()=>{}}))
  assert.match(empty,/0 av 0 fullført/);assert.match(empty,/<progress value="0" max="1"/)
  for(const phase of ['loading','error']) {
    const view=renderToStaticMarkup(createElement(Weekly,{data:{...workspace([]),phase,data:null,now:0},onOpen:()=>{}}))
    assert.match(view,phase==='error'?/Hent status ved timeren/:/Henter ukeplan/)
  }
  const form=renderToStaticMarkup(createElement(Form,{data:workspace([task(1)]),task:task(1,{priority:'high'}),onSaved:()=>{},onCancel:()=>{}}))
  assert.match(form,/id="task-week" type="week"[^>]*value="2026-W45"/)
  assert.match(form,/<option value="high" selected="">Høy/);assert.match(form,/Fjern uke/)
})
