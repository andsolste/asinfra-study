import assert from 'node:assert/strict'
import test from 'node:test'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { createServer } from 'vite'
import react from '@vitejs/plugin-react'
import { focusDefaults, focusPresets, validateFocusSettings, focusProgress, focusForState, focusClock,
  createFocusPreferences, focusSettingsKey, focusNoticesKey, notifyFocusOnce } from '../src/lib/focus-rhythm.ts'
import { createFlowStore } from '../src/lib/flow-work-store.ts'
import { flowDurations, mapFlowSnapshot } from '../src/lib/flow-work.ts'

const id=n=>`10000000-0000-4000-8000-${String(n).padStart(12,'0')}`
const at=time=>`2026-11-03T${time}Z`,now=time=>Date.parse(at(time))
const settings={...focusDefaults,enabled:true}
function period(n,start,end=null){return {id:id(n),work_day_id:id(1),area_id:null,task_id:null,created_at:at(start),started_at:at(start),ended_at:end?at(end):null}}
function day(segments=[period(2,'08:00:03.123456')]){
  return mapFlowSnapshot({work_day:{id:id(1),logical_date:'2026-11-03',timezone:'UTC',boundary_at:at('04:00:00'),cutoff_at:'2026-11-04T04:00:00Z',started_at:segments[0].started_at,ended_at:null,created_at:at('08:00:03.123456')},segments,server_time:at('08:00:00')})
}
const state=current=>({current,server_time:current?.server_time??at('08:00:00'),next_boundary_at:at('04:00:00'),next_cutoff_at:'2026-11-04T04:00:00Z',legacy_active:false})
const memory=()=>{const values=new Map();return {getItem:k=>values.get(k)??null,setItem:(k,v)=>values.set(k,v)}}
const tick=()=>new Promise(r=>setImmediate(r))

test('focus is opt-in; every preset and whole-minute custom bounds validate without accepting malformed storage',()=>{
  assert.equal(focusDefaults.enabled,false);assert.equal(focusDefaults.notifications,false)
  assert.deepEqual(focusProgress(day(),now('09:00:00'),focusDefaults),{kind:'idle'})
  for(const [focusMinutes,breakMinutes] of focusPresets) assert.equal(validateFocusSettings({...settings,focusMinutes,breakMinutes}).focusMinutes,focusMinutes)
  for(const values of [{focusMinutes:1,breakMinutes:1},{focusMinutes:240,breakMinutes:60}])assert.ok(validateFocusSettings({...settings,...values}))
  for(const invalid of [null,{}, {...settings,enabled:1},{...settings,notifications:'yes'},
    ...[0,-1,1.1,241,NaN,Infinity,'25',null].map(focusMinutes=>({...settings,focusMinutes})),
    ...[0,61,2.5,'5'].map(breakMinutes=>({...settings,breakMinutes}))])assert.throws(()=>validateFocusSettings(invalid))
})

test('focus uses exact registered work; touching activity switches do not restart and corrections recompute canonical durations',()=>{
  const s=day([period(2,'08:00:03.123456','08:10:04.654321'),period(3,'08:10:04.654321')]),copy=structuredClone(s)
  assert.equal(focusProgress(s,now('08:20:03'),settings).remaining,300124)
  assert.equal(focusProgress(s,now('08:20:03'),settings).eventId,focusProgress(day(),now('08:20:03'),settings).eventId)
  const exact=now('08:25:03')+.123456*1000
  assert.equal(focusProgress(s,exact-.001,settings).due,false)
  assert.equal(focusProgress(s,exact,settings).due,true)
  assert.equal(focusProgress(s,now('10:00:00'),settings).remaining,0,'No automatic next cycle')
  assert.deepEqual(s,copy,'Focus never modifies Flow data')
  s.segments[0].started_at=s.work_day.started_at=at('08:02:00')
  assert.equal(focusProgress(s,now('08:25:00'),settings).remaining,120000)
  assert.equal(flowDurations(s,now('08:25:00')).work,23*60000)
})

test('Pause starts from the actual server end; early/late Continue resets only after a real gap',()=>{
  const paused=day([period(2,'08:00:03.123456','08:20:04.654321')])
  const before=focusProgress(paused,now('08:21:04'),settings)
  assert.equal(before.kind,'break');assert.equal(before.remaining,240655)
  assert.equal(focusProgress(paused,now('08:25:04'),settings).due,false)
  assert.equal(focusProgress(paused,now('08:25:05'),settings).due,true)
  assert.equal(focusProgress(paused,now('09:00:00'),settings).kind,'break','Never auto-resume')
  for(const start of ['08:22:00','08:30:00']){
    const resumed=day([...paused.segments,period(3,start)])
    const p=focusProgress(resumed,Date.parse(at(start))+60000,settings)
    assert.equal(p.kind,'focus');assert.equal(p.remaining,24*60000)
    assert.notEqual(p.eventId,before.eventId)
  }
  const touching=day([...paused.segments,period(3,'08:20:04.654321')])
  assert.equal(focusProgress(touching,now('08:25:05'),settings).due,true)
})

test('zero periods do not invent work or split a contiguous activity chain; latest actual end anchors a pause',()=>{
  const s=day([period(2,'08:00:00','08:10:00'),period(3,'08:05:00','08:05:00'),period(4,'08:10:00')])
  assert.equal(focusProgress(s,now('08:20:00'),settings).remaining,5*60000)
  const zero=day([period(2,'08:00:00','08:00:00')])
  assert.equal(focusProgress(zero,now('08:01:00'),settings).remaining,4*60000)
  assert.equal(flowDurations(zero,now('08:01:00')).work,0)
})

test('reload, throttling and sleep jump to timestamp-derived state; midnight/04:00 and frozen DST bounds stop stale cycles',()=>{
  const s=day(),copy=JSON.parse(JSON.stringify(s))
  assert.deepEqual(focusProgress(s,now('09:00:00'),settings),focusProgress(copy,now('09:00:00'),settings))
  assert.equal(focusProgress(copy,now('08:50:00'),settings).due,true,'One current overdue phase, no missed-tick catch-up loops')
  for(const [boundary,cutoff,from] of [
    ['2026-03-28T04:00:00+01:00','2026-03-29T04:00:00+02:00','2026-03-29T03:40:00+02:00'],
    ['2026-10-24T04:00:00+02:00','2026-10-25T04:00:00+01:00','2026-10-25T03:40:00+01:00'],
  ]){
    const d=day();Object.assign(d.work_day,{boundary_at:boundary,cutoff_at:cutoff,timezone:'Europe/Oslo',started_at:from});d.segments[0].started_at=from;d.server_time=from
    assert.equal(focusProgress(d,Date.parse(cutoff)-60000,settings).remaining,6*60000)
    assert.deepEqual(focusProgress(d,Date.parse(cutoff),settings),{kind:'idle'})
    d.work_day.ended_at=cutoff;assert.deepEqual(focusProgress(d,Date.parse(cutoff)+3600000,settings),{kind:'idle'})
  }
  const midnight=day([period(2,'23:45:00')]);midnight.server_time=at('23:45:00')
  assert.equal(focusProgress(midnight,Date.parse('2026-11-04T00:05:00Z'),settings).remaining,5*60000)
})

test('loading, stale/pending and unknown writes suppress focus; accepted recovery uses current server work with no extra timer actions',async()=>{
  let offline=false,s=day(),clock=0,writes=0
  const store=createFlowStore({load:async()=>{if(offline)throw Error('offline');return state(s)},catalog:async()=>({areas:[],tasks:[]}),act:async()=>{writes++;throw Error('lost') }}, {timezone:()=> 'UTC',clock:()=>clock})
  const view=()=>focusForState({...store.getSnapshot(),now:store.now()},settings)
  assert.deepEqual(view(),{kind:'idle'});store.connect();await tick();clock=1800000
  assert.equal(view().due,true)
  offline=true;await store.dispatch({kind:'activity',dayId:id(1),expectedId:id(2),expectedCount:1,nextId:null,areaId:null,taskId:null})
  assert.deepEqual(view(),{kind:'idle'});assert.equal(writes,1)
  offline=false;s=day([period(2,'08:00:03.123456','08:10:00')]);s.server_time=at('08:30:00');await store.refresh()
  assert.equal(view().kind,'break');assert.equal(view().due,true);assert.equal(writes,1)
  store.disconnect()
})

test('settings survive reload and synchronize tabs while owner keys, cleared/corrupt data and denied storage stay isolated',()=>{
  const storage=memory(),a=createFocusPreferences(id(1),()=>storage),b=createFocusPreferences(id(1),()=>storage),other=createFocusPreferences(id(2),()=>storage)
  a.update({...settings,focusMinutes:42,breakMinutes:7,notifications:true});b.refresh()
  assert.deepEqual(b.getSnapshot(),a.getSnapshot());assert.deepEqual(createFocusPreferences(id(1),()=>storage).getSnapshot(),a.getSnapshot())
  assert.deepEqual(other.getSnapshot().settings,focusDefaults)
  storage.setItem(focusSettingsKey(id(1)),'malformed');b.refresh();assert.deepEqual(b.getSnapshot().settings,focusDefaults)
  storage.setItem(focusSettingsKey(id(1)),JSON.stringify({version:1,...settings,focusMinutes:0}));b.refresh();assert.equal(b.getSnapshot().settings.enabled,false)
  storage.setItem(focusSettingsKey(id(1)),null);b.refresh();assert.equal(b.getSnapshot().settings.enabled,false)
  const blocked=createFocusPreferences(id(1),()=>{throw Error('denied')});blocked.update(settings)
  assert.equal(blocked.getSnapshot().settings.enabled,true);assert.equal(blocked.getSnapshot().persistent,false)
})

function notifications(){
  const storage=memory(),shown=[],queues=new Map()
  const locks={request(name,callback){const next=(queues.get(name)??Promise.resolve()).then(callback);queues.set(name,next.catch(()=>{}));return next}}
  const event=focusProgress(day(),now('09:00:00'),settings)
  const options={owner:id(1),event,eligible:()=>true,storage:()=>storage,locks,show:(...args)=>shown.push(args)}
  return {storage,shown,locks,event,options}
}

test('simultaneous tabs, rerenders/reloads and wake-up deliver at most one notice per canonical phase',async()=>{
  const {options,shown,event,storage}=notifications()
  const results=await Promise.all(Array.from({length:6},()=>notifyFocusOnce(options)))
  assert.equal(results.filter(s=>s==='sent').length,1);assert.equal(shown.length,1)
  assert.equal(await notifyFocusOnce({...options,event:{...event,remaining:0}}),'seen')
  assert.equal(shown.length,1);assert.match(shown[0][0],/Tid for pause/)
  assert.match(shown[0][1].body,/Velg Pause/);assert.ok(!shown[0][1].body.includes('Oppgave'))
  assert.ok(JSON.parse(storage.getItem(focusNoticesKey(id(1)))).includes(event.eventId))
  await notifyFocusOnce({...options,event:{...event,kind:'break',eventId:event.eventId.replace(':focus:',':break:')}})
  assert.equal(shown.length,2);assert.match(shown[1][0],/Pausen er ferdig/)
  await notifyFocusOnce({...options,owner:id(2)});assert.equal(shown.length,3,'No state shared with another account')
})

test('unsupported/denied storage, missing locks, native Notification failures and ineligible stale/account states degrade to in-app only',async()=>{
  const {options,shown,storage}=notifications()
  assert.equal(await notifyFocusOnce({...options,locks:null}),'unavailable')
  assert.equal(await notifyFocusOnce({...options,storage:()=>null}),'unavailable')
  assert.equal(await notifyFocusOnce({...options,storage:()=>({getItem:()=>{throw Error('denied')}})}),'unavailable')
  assert.equal(await notifyFocusOnce({...options,storage:()=>({getItem:()=>null,setItem:()=>{throw Error('full')}})}),'unavailable')
  storage.setItem(focusNoticesKey(id(1)),'malformed');assert.equal(await notifyFocusOnce(options),'unavailable')
  storage.setItem(focusNoticesKey(id(1)),'[]')
  assert.equal(await notifyFocusOnce({...options,eligible:()=>false}),'skipped')
  assert.equal(await notifyFocusOnce({...options,show:()=>{throw Error('mobile unsupported')}}),'unavailable')
  assert.equal(await notifyFocusOnce(options),'seen','Failed delivery cannot keep retrying an OS notice')
  assert.equal(shown.length,0)
  assert.equal(focusProgress(day(),now('09:00:00'),settings).due,true,'In-app message remains available')
})

test('queued notice rechecks eligibility after the tab lock, including a pause or logout in another tab',async()=>{
  const {options,shown}=notifications();let release,live=true
  const pending=notifyFocusOnce({...options,eligible:()=>live,locks:{request:async(name,run)=>{await new Promise(r=>release=r);return run()}}})
  live=false;release();assert.equal(await pending,'skipped');assert.equal(shown.length,0)
})

test('countdown never rounds completion early and formats long custom intervals',()=>{
  assert.equal(focusClock(1),'0:01');assert.equal(focusClock(60001),'1:01');assert.equal(focusClock(0),'0:00');assert.equal(focusClock(-1),'0:00');assert.equal(focusClock(240*60000),'240:00')
})

test('focus UI is compact, opt-in, labelled and explicit about notifications/early resume; recovery has no stale countdown', {timeout:30000},async t=>{
  const server=await createServer({configFile:false,envFile:false,appType:'custom',logLevel:'silent',server:{middlewareMode:true,hmr:false},plugins:[react()]})
  t.after(()=>server.close());const {default:Focus}=await server.ssrLoadModule('/src/components/FocusRhythm.tsx')
  const workspace={phase:'running',pending:null,data:state(day()),now:now('09:00:00'),readRevision:1,latestRead:()=>1,reload:()=>assert.fail('Render cannot call API')}
  let html=renderToStaticMarkup(createElement(Focus,{owner:id(1),data:workspace}))
  assert.match(html,/Fokusrytme/);assert.match(html,/Bruk fokusrytme/);assert.doesNotMatch(html,/focus-countdown/)
  assert.match(html,/25 \/ 5 minutter/);assert.match(html,/50 \/ 10 minutter/);assert.match(html,/90 \/ 15 minutter/)
  assert.match(html,/Aktiver nettleservarsler/);assert.match(html,/etter en registrert pause/i)
  const storage=memory();createFocusPreferences(id(1),()=>storage).update(settings)
  const original=global.window;global.window={localStorage:storage}
  try{
    html=renderToStaticMarkup(createElement(Focus,{owner:id(1),data:workspace}))
    assert.match(html,/Tid for pause/);assert.match(html,/role="status"/);assert.match(html,/0:00/)
    for(const phase of ['loading','recovering','error']){
      html=renderToStaticMarkup(createElement(Focus,{owner:id(1),data:{...workspace,phase}}))
      assert.match(html,/Kontrollerer Flow-status/);assert.doesNotMatch(html,/focus-countdown/)
    }
  }finally{if(original===undefined)delete global.window;else global.window=original}
})
