import assert from 'node:assert/strict'
import test from 'node:test'
import { createClient } from '@supabase/supabase-js'
import { addDays, currentLogicalDate, currentPeriod, periodDates, shiftFlowPeriod, changeFlowKind, flowPeriodLabel,
  dateLabel, logicalDayAxisLabel, areaAppearance, mapFlowStatistics, createStatisticsApi } from '../src/lib/flow-statistics.ts'
import { createFlowHistoryApi, mapFlowHistoryPage, dayTimeline, nativeHistoryWork } from '../src/lib/flow-history.ts'
import { createFlowHistoryStore } from '../src/lib/flow-history-store.ts'
import { taskDayTime } from '../src/lib/flow-tasks.ts'

const id=n=>`10000000-0000-4000-8000-${String(n).padStart(12,'0')}`
const server='2026-10-19T12:00:00Z', date='2026-10-19', tick=()=>new Promise(r=>setImmediate(r))
const area={id:id(1),name:'Et langt områdenavn',code:'ASI',is_archived:false,work:60000}
function stats(kind='week',anchor=date,areas=[area]) {
  const dates=periodDates({kind,anchor}),total=areas.reduce((n,a)=>n+a.work,0)
  const days=[]
  if(dates) for(let d=dates.from;d<dates.to;d=addDays(d,1)) days.push({date:d,total:d===dates.from?total:0,areas:d===dates.from?areas.map(a=>({id:a.id,work:a.work})):[]})
  return mapFlowStatistics({period:{kind,anchor:kind==='total'?null:anchor,from_date:dates?.from??null,to_date:dates?.to??null,timezone:'UTC'},
    server_time:server,legacy_timezone_error:null,total,areas,days,
    contributions:areas.map(a=>({area_id:a.id,task_id:null,source:'legacy-study',title:null,status:null,work:a.work})),task_date:date,task_today:null,task_current:null})
}
function native(n=2) {
  const day=id(n)
  return {source:'flow',id:day,started_at:'2026-10-18T23:00:00Z',snapshot:{server_time:server,
    work_day:{id:day,logical_date:'2026-10-18',timezone:'UTC',boundary_at:'2026-10-18T04:00:00Z',cutoff_at:'2026-10-19T04:00:00Z',started_at:'2026-10-18T23:00:00Z',ended_at:'2026-10-19T04:00:00Z',created_at:'2026-10-18T23:00:00Z'},
    segments:[
      {id:id(n+100),work_day_id:day,area_id:area.id,task_id:id(90),started_at:'2026-10-18T23:00:00Z',ended_at:'2026-10-19T00:00:00Z',created_at:'2026-10-18T23:00:00Z'},
      {id:id(n+200),work_day_id:day,area_id:null,task_id:null,started_at:'2026-10-19T00:00:00Z',ended_at:'2026-10-19T01:00:00Z',created_at:'2026-10-19T00:00:00Z'},
      {id:id(n+300),work_day_id:day,area_id:area.id,task_id:id(90),started_at:'2026-10-19T01:30:00Z',ended_at:'2026-10-19T02:00:00Z',created_at:'2026-10-19T01:30:00Z'},
    ]}}
}
function legacy(n=3) {
  return {source:'legacy-study',id:id(n),started_at:'2026-10-17T08:00:00Z',snapshot:{
    session:{id:id(n),subject_id:area.id,description:'This is not a task',started_at:'2026-10-17T08:00:00Z',ended_at:'2026-10-17T09:00:00Z'},
    subject:{...area,created_at:'2026-01-01T00:00:00Z'},segments:[{id:id(n+100),session_id:id(n),started_at:'2026-10-17T08:00:00Z',ended_at:'2026-10-17T09:00:00Z'}]}}
}
function page(rows=[native(),legacy()],more=false) {
  const last=rows.at(-1)
  return {rows,server_time:server,next_cursor:more?{at:last.started_at,source:last.source,id:last.id}:null}
}
const clone=x=>structuredClone(x)

test('logical 04:00 date in UTC/Oslo/New York; midnight is previous day, exact boundary is next',()=>{
  for(const [zone,before,at] of [
    ['UTC','2026-10-19T03:59:59Z','2026-10-19T04:00:00Z'],
    ['Europe/Oslo','2026-10-19T01:59:59Z','2026-10-19T02:00:00Z'],
    ['America/New_York','2026-10-19T07:59:59Z','2026-10-19T08:00:00Z'],
  ]) {
    assert.equal(currentLogicalDate(Date.parse(before),zone),'2026-10-18')
    assert.equal(currentLogicalDate(Date.parse(at),zone),'2026-10-19')
    assert.equal(currentPeriod('day',Date.parse(before),zone).anchor,'2026-10-18')
  }
  assert.equal(currentLogicalDate(Date.parse(server),'guess-zone'),null)
  assert.equal(currentLogicalDate(Date.parse('2026-10-19T00:30Z'),'UTC'),'2026-10-18')
  assert.deepEqual(currentPeriod('total'),{kind:'total',anchor:null})
})
test('date-only calendar arithmetic survives DST, all month lengths, leap/year boundaries and browser timezone changes',()=>{
  const old=process.env.TZ
  try {
    for(const zone of ['UTC','Europe/Oslo','America/New_York','Pacific/Auckland']) {
      process.env.TZ=zone
      for(const [anchor,count] of [['2026-02-10',28],['2028-02-29',29],['2026-04-30',30],['2026-10-25',31]]) {
        const period={kind:'month',anchor},dates=periodDates(period);let date=dates.from,days=0
        while(date<dates.to){days++;date=addDays(date,1)}assert.equal(days,count)
        assert.deepEqual(shiftFlowPeriod(shiftFlowPeriod(period,1),-1),{kind:'month',anchor:dates.from})
        assert.equal(logicalDayAxisLabel({date:dates.from},'month',0,count),'1')
      }
      assert.deepEqual(periodDates({kind:'week',anchor:'2026-10-25'}),{from:'2026-10-19',to:'2026-10-26'})
      assert.equal(shiftFlowPeriod({kind:'month',anchor:'2026-12-31'},1).anchor,'2027-01-01')
      assert.equal(shiftFlowPeriod({kind:'day',anchor:'2028-03-01'},-1).anchor,'2028-02-29')
      assert.match(dateLabel('2026-10-19'),/19.*oktober/)
      assert.equal(flowPeriodLabel({kind:'total',anchor:null}),'All registrert arbeidstid')
    }
  }finally{if(old===undefined)delete process.env.TZ;else process.env.TZ=old}
})
test('period switching anchors current vs historical dates; native today can differ from browser zone',()=>{
  const now=Date.parse('2026-10-19T03:00Z')
  assert.equal(changeFlowKind({kind:'week',anchor:'2026-10-18'},'day',now,'UTC').anchor,'2026-10-18')
  assert.equal(changeFlowKind({kind:'week',anchor:'2026-10-11'},'day',now,'UTC').anchor,'2026-10-05')
  assert.equal(changeFlowKind({kind:'week',anchor:'2026-10-18'},'day',Date.parse(server),'Europe/Oslo','2026-10-18').anchor,'2026-10-18')
  assert.deepEqual(changeFlowKind({kind:'week',anchor:date},'total'),{kind:'total',anchor:null})
})
test('aggregate mapper preserves precise totals, stable area IDs/Annet, earliest busiest tie and empty states',()=>{
  const summary=stats('week',date,[{...area,work:600.123},{...area,id:null,name:'Annet',work:600.456}])
  assert.ok(Math.abs(summary.total-1200.579)<1e-9);assert.equal(summary.busiestDay.date,date);assert.equal(summary.areas[1].id,null)
  assert.deepEqual(areaAppearance(null),{color:'#94A3B8',pattern:0})
  for(const kind of ['day','week','month','total']) {
    const empty=stats(kind,date,[]);assert.equal(empty.total,0);assert.equal(empty.mostActive,null);assert.equal(empty.busiestDay,null)
  }
  const invalid=clone(stats('day'))
  invalid.total=999;assert.throws(()=>mapFlowStatistics(invalid))
  const duplicate=clone(stats('total'));duplicate.areas.push(duplicate.areas[0]);assert.throws(()=>mapFlowStatistics(duplicate))
  const fakeTask=clone(stats('total'));fakeTask.contributions[0].task_id=id(99);assert.throws(()=>mapFlowStatistics(fakeTask))
  const badDate=clone(stats('week'));badDate.days[0].date='2026-10-20';assert.throws(()=>mapFlowStatistics(badDate))
})
test('history normalizes both sources with independent identities and preserves microsecond cursor verbatim',()=>{
  const data=mapFlowHistoryPage(page())
  assert.deepEqual(data.rows.map(r=>r.key),['flow:'+id(2),'legacy-study:'+id(3)])
  const same=legacy(2);same.started_at=native().started_at;same.snapshot.session.started_at=same.started_at
  same.snapshot.session.ended_at=same.started_at;same.snapshot.segments=[]
  assert.equal(mapFlowHistoryPage(page([same,native()])).rows.length,2)
  const precise=legacy(3);precise.started_at='2026-10-17T08:00:00.123456Z';precise.snapshot.session.started_at=precise.started_at;precise.snapshot.segments[0].started_at=precise.started_at
  const mapped=mapFlowHistoryPage(page([precise],true));assert.equal(mapped.next_cursor.at,precise.started_at)
  assert.throws(()=>mapFlowHistoryPage(page([native(),native()])))
  assert.throws(()=>mapFlowHistoryPage({...page([precise],true),next_cursor:{at:server,id:id(3),source:'legacy-study'}}))
})
test('native timeline includes gaps and trailing pause, never boundary-to-first or a pause at touching switches',()=>{
  const snapshot=mapFlowHistoryPage(page()).rows[0].snapshot,periods=dayTimeline(snapshot)
  assert.deepEqual(periods.map(p=>p.kind),['work','work','pause','work','pause'])
  assert.equal(periods[0].start,snapshot.work_day.started_at)
  assert.equal(periods[2].start,'2026-10-19T01:00:00.000Z');assert.equal(periods[2].end,'2026-10-19T01:30:00Z')
  assert.equal(periods.at(-1).end,'2026-10-19T04:00:00.000Z')
  assert.equal(nativeHistoryWork(snapshot),150*60000)
  assert.equal(taskDayTime(snapshot,id(90),Date.parse(server)).work,90*60000)
  const expired=native();expired.snapshot.work_day.ended_at=null;expired.snapshot.segments.at(-1).ended_at=null
  assert.equal(dayTimeline(mapFlowHistoryPage(page([expired])).rows[0].snapshot).at(-1).end,'2026-10-19T04:00:00.000Z')
  const running=native();running.snapshot.work_day.cutoff_at='2026-10-20T04:00:00Z';running.snapshot.work_day.ended_at=null
  assert.throws(()=>mapFlowHistoryPage(page([running])))
})
test('SDK sends logical dates, explicit timezone, opaque cursor and source-specific mutation RPCs',async()=>{
  const requests=[];let response=page()
  const client=createClient('https://example.supabase.co','sb_publishable_test',{auth:{persistSession:false},global:{fetch:async(url,options)=>{
    requests.push({name:String(url).split('/').at(-1),args:JSON.parse(options.body)});return new Response(JSON.stringify(response))
  }}})
  const h=createFlowHistoryApi(client),s=createStatisticsApi(client),signal=new AbortController().signal
  const cursor={at:'2026-10-17T08:00:00.123456Z',source:'legacy-study',id:id(3)}
  await h.list(cursor,signal);assert.deepEqual(requests.at(-1).args,{p_limit:25,p_cursor:cursor})
  response=stats('month');await s.statistics({kind:'month',anchor:date},'Europe/Oslo',signal)
  assert.equal(requests.at(-1).args.p_date,date);assert.equal(requests.at(-1).args.p_timezone,'Europe/Oslo')
  response=stats('total');await s.statistics({kind:'total',anchor:null},null,signal,id(90));assert.equal(requests.at(-1).args.p_task_id,id(90))
  response=legacy().snapshot
  await h.editLegacy(id(3),{subjectId:area.id,description:'Edit',startedAt:'2026-10-17T08:00:00Z',endedAt:'2026-10-17T09:00:00Z',segments:[]},signal)
  assert.equal(requests.at(-1).name,'flow_history_edit_legacy')
  response=id(3);await h.removeLegacy(id(3),signal);assert.equal(requests.at(-1).name,'study_session_history_delete')
  response=id(102);await h.attribute({segmentId:id(102),areaId:null,taskId:null,expectedAreaId:area.id,expectedTaskId:id(90)},signal)
  assert.equal(requests.at(-1).name,'flow_history_attribute');assert.equal(requests.at(-1).args.p_expected_task_id,id(90))
  assert.ok(requests.every(r=>!('p_user_id' in r.args)&&!('p_now' in r.args)))
})
function fakeApi() {
  let pages=[page([native()],true),page([legacy()])]
  const calls=[]
  return {calls,setPages:value=>{pages=value},api:{
    list:async cursor=>{calls.push(['list',cursor]);return mapFlowHistoryPage(pages[cursor?1:0])},
    statistics:async period=>{calls.push(['statistics',period]);return stats(period.kind,period.anchor??date)},
    area:async()=>Object.fromEntries(['day','week','month','total'].map(k=>[k,stats(k)])),
    editLegacy:async()=>{},removeLegacy:async()=>{},attribute:async()=>{},
  }}
}
test('store mixes cursor pages, rejects duplicates, retains old page on error and cancels stale reads',async()=>{
  const f=fakeApi(),store=createFlowHistoryStore(f.api,'UTC');store.connect();await tick()
  await store.more();assert.deepEqual(store.getSnapshot().rows.map(r=>r.source),['flow','legacy-study']);assert.equal(store.getSnapshot().cursor,null)
  f.setPages([page([native()],true),page([native()])]);await store.refresh();await store.more()
  assert.equal(store.getSnapshot().rows.length,1);assert.match(store.getSnapshot().listError,/historikken/)
  let resolve;f.api.list=()=>new Promise(r=>{resolve=r});const old=store.refresh();await tick();store.disconnect()
  resolve(mapFlowHistoryPage(page([legacy()])));await old;assert.equal(store.getSnapshot().rows[0].source,'flow')
})
test('rapid day/week/month/total switches clear stale charts and old successes/failures cannot replace latest period',async()=>{
  const f=fakeApi(),pending=[];f.api.statistics=(period,zone,signal)=>new Promise((resolve,reject)=>pending.push({period,signal,resolve,reject}))
  const store=createFlowHistoryStore(f.api,'UTC');store.connect();await tick();pending[0].resolve(stats());await tick()
  const a=store.selectPeriod({kind:'day',anchor:date}),b=store.selectPeriod({kind:'month',anchor:date}),c=store.selectPeriod({kind:'total',anchor:null})
  assert.equal(store.getSnapshot().statistics,null)
  pending[3].resolve(stats('total'));await c;pending[2].reject(Error('old fail'));await b;pending[1].resolve(stats('day'));await a
  assert.equal(store.getSnapshot().period.kind,'total');assert.equal(store.getSnapshot().statisticsError,null);assert.equal(pending[1].signal.aborted,true)
  store.disconnect()
})
test('area reads have independent cancellation and support Annet, all four metrics and legacy task-less contributions',async()=>{
  const f=fakeApi(),pending=[];f.api.area=(id,zone,signal)=>new Promise(resolve=>pending.push({id,signal,resolve}))
  const store=createFlowHistoryStore(f.api,'UTC');store.connect();await tick()
  const a=store.selectArea(area.id),b=store.selectArea(null)
  pending[1].resolve(Object.fromEntries(['day','week','month','total'].map(k=>[k,stats(k,date,[{...area,id:null,name:'Annet'}])])));await b
  pending[0].resolve(Object.fromEntries(['day','week','month','total'].map(k=>[k,stats(k)])));await a
  assert.equal(store.getSnapshot().selectedArea.id,null);assert.equal(store.getSnapshot().area.total.areas[0].id,null)
  assert.equal(store.getSnapshot().area.total.contributions[0].task_id,null);assert.equal(pending[0].signal.aborted,true)
  await store.selectArea(undefined);assert.equal(store.getSnapshot().selectedArea,null);store.disconnect()
})
test('confirmed/uncertain source-aware edits refresh history/statistics/area; failed recovery blocks blind repeat',async()=>{
  for(const method of ['editLegacy','removeLegacy','attribute']) for(const lost of [false,true]) {
    const f=fakeApi();let writes=0
    f.api[method]=async()=>{writes++;f.setPages([page([])]);if(lost)throw Error('Lost reply')}
    const store=createFlowHistoryStore(f.api,'UTC');store.connect();await tick();await store.selectArea(area.id)
    const result=await store[method](id(3),{})
    assert.equal(result,!lost);assert.equal(writes,1);assert.equal(store.getSnapshot().rows.length,0);assert.equal(store.getSnapshot().statisticsStatus,'ready');assert.equal(store.getSnapshot().areaStatus,'ready')
    assert.equal(store.getSnapshot().error!==null,lost);store.disconnect()
  }
  const f=fakeApi(),store=createFlowHistoryStore(f.api,'UTC');store.connect();await tick()
  let writes=0;f.api.editLegacy=async()=>{writes++;f.api.list=async()=>{throw Error('Offline')};throw Error('Unknown')}
  assert.equal(await store.editLegacy(id(3),{}),false);assert.equal(store.getSnapshot().status,'error')
  assert.equal(await store.editLegacy(id(3),{}),false);assert.equal(writes,1);store.disconnect()
})
