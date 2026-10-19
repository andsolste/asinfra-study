import assert from 'node:assert/strict'
import test from 'node:test'
import { readFile } from 'node:fs/promises'
import { createClient } from '@supabase/supabase-js'
import { csvHeaders,csvHeader,csvRow,csvText,durationClock,durationSeconds,exportFilename,mapExportPage,createExportApi,downloadCsv,timestampMicroseconds } from '../src/lib/flow-export.ts'
import { createExportStore } from '../src/lib/flow-export-store.ts'
import { mapFlowStatistics,periodDates,addDays,currentPeriod,flowPeriodLabel,shiftFlowPeriod } from '../src/lib/flow-statistics.ts'
import { reportModel } from '../src/lib/flow-report.ts'

const id=n=>`10000000-0000-4000-8000-${String(n).padStart(12,'0')}`
const server='2026-10-19T12:00:00.123456Z',date='2026-10-19',tick=()=>new Promise(r=>setImmediate(r))
function summary(kind='total',total=1000){
  const dates=periodDates({kind,anchor:date}),days=[]
  if(dates)for(let d=dates.from;d<dates.to;d=addDays(d,1))days.push({date:d,total:d===dates.from?total:0,areas:d===dates.from&&total?[{id:null,work:total}]:[]})
  return mapFlowStatistics({period:{kind,anchor:kind==='total'?null:date,from_date:dates?.from??null,to_date:dates?.to??null,timezone:'UTC'},server_time:server,total,days,
    areas:total?[{id:null,name:'Annet',code:null,is_archived:false,work:total}]:[],contributions:total?[{source:'legacy-study',area_id:null,task_id:null,title:null,status:null,work:total}]:[],
    task_date:date,task_today:null,task_current:null,legacy_timezone_error:null})
}
function row(n=1,changes={}){
  const start=new Date(Date.parse('2026-10-19T10:00Z')+n*1000).toISOString(),end=new Date(Date.parse(start)+1000).toISOString()
  return {source:'flow',ordinal:n,segment_id:id(n),flow_date:date,timezone:'UTC',started_at:start,ended_at:end,work_microseconds:'1000000',
    area_id:null,area_name:'Annet',area_code:null,area_archived:false,task_id:null,task_title:null,task_status:null,task_deadline:null,description:'',...changes}
}
function pages(count=501){
  const rows=Array.from({length:count},(_,i)=>row(i+1)),stats=summary('total',count*1000)
  const base={job_id:id(9000),period:stats.period,server_time:server,expires_at:'2026-10-19T12:30:00.123456Z',total_rows:count}
  return [{...base,rows:rows.slice(0,500),next_cursor:count>500?{job:base.job_id,after:500}:null,statistics:stats},
    {...base,rows:rows.slice(500),next_cursor:null}]
}
// Small RFC-4180 parser for assertions, including embedded quotes/newlines.
function cells(csv){
  const result=[],row=[];let value='',quoted=false
  for(let i=0;i<csv.length;i++){
    const c=csv[i]
    if(c==='"'){if(quoted&&csv[i+1]==='"'){value+='"';i++}else quoted=!quoted}
    else if(c===','&&!quoted){row.push(value);value=''}
    else if(c==='\r'&&csv[i+1]==='\n'&&!quoted){row.push(value);result.push([...row]);row.length=0;value='';i++}
    else value+=c
  }
  return result
}
test('current export period resolves immediately, preferring the native Flow date over the display timezone',async()=>{
  for(const [now,nativeToday,displayDate] of [
    ['2026-10-19T03:00Z','2026-10-18','2026-10-19'], // Sunday/Monday differ after timezone travel.
    ['2026-11-01T04:30Z','2026-10-31','2026-11-01'], // Native day still belongs to the previous month.
  ])for(const kind of ['day','week','month']){
    const native=currentPeriod(kind,Date.parse(now),'Europe/Oslo',nativeToday)
    assert.equal(native.anchor,nativeToday)
    assert.notEqual(flowPeriodLabel(native),'Velg en gyldig visningstidssone')
    for(const direction of [-1,1])assert.notDeepEqual(shiftFlowPeriod(native,direction),native)
    assert.equal(currentPeriod(kind,Date.parse(now),'Europe/Oslo').anchor,displayDate)
    assert.equal(currentPeriod(kind,Date.parse(now),null,nativeToday).anchor,nativeToday)
  }
  for(const kind of ['day','week','month']){
    assert.equal(currentPeriod(kind,Date.parse('2026-10-19T03:59:59Z'),'UTC',null).anchor,'2026-10-18')
    assert.equal(currentPeriod(kind,Date.parse('2026-10-19T04:00:00Z'),'UTC',null).anchor,'2026-10-19')
    assert.equal(currentPeriod(kind,Date.parse(server),'invalid-zone',null).anchor,null)
  }
  assert.deepEqual(currentPeriod('total',Date.parse(server),'UTC',date),{kind:'total',anchor:null})
  const ui=await readFile(new URL('../src/components/FlowExport.tsx',import.meta.url),'utf8')
  assert.match(ui,/select\(currentPeriod\(period\.kind, history\.now\(\), history\.timezone, history\.statistics\?\.task_date\)\)/)
})

test('CSV headers/order/BOM/CRLF and Unicode/quotes/commas/newlines preserve data',()=>{
  assert.equal(csvHeader.charCodeAt(0),0xFEFF);assert.deepEqual(cells(csvHeader.slice(1))[0],[...csvHeaders])
  const r=row(1,{area_id:id(800),area_name:'Nettverk, sikkerhet 🧭',area_code:'ØV',task_id:id(801),task_title:'React, "hooks" og æøå 🚀',task_status:'completed',task_deadline:'2026-10-20T10:00:00Z',description:'Linje 1\nLinje "2", æøå'})
  const values=cells(csvRow(r))[0]
  assert.equal(values.length,15);assert.equal(values[0],'Flow');assert.equal(values[8],r.area_name);assert.equal(values[11],r.task_title)
  assert.equal(values[12],'Fullført');assert.equal(values[13],r.task_deadline);assert.equal(values[14],r.description)
  assert.ok(csvRow(r).endsWith('\r\n'))
})
test('CSV source/Annet/no task/legacy description have no fabricated task matching or internal IDs',()=>{
  const old=row(1,{source:'legacy-study',description:'Dette er ikke en task'})
  const values=cells(csvRow(old))[0]
  assert.equal(values[0],'Eldre registrering');assert.equal(values[3],'Visningstidssone, ikke historisk metadata')
  assert.equal(values[8],'Annet');assert.equal(values[11],'Uten oppgave / eldre registrering');assert.equal(values[14],old.description)
  assert.equal(cells(csvRow(row()))[0][11],'Uten oppgave');assert.ok(!csvRow(old).includes(old.segment_id))
})
test('CSV neutralizes formulas, controls, whitespace/full-width prefixes; quotes alone are not the defence',()=>{
  for(const value of ['=SUM(A1:A2)','+CMD...','-1+2','@something',' \t=1+2','\u200B=1+2','＝1+2','＋1','－1','＠x','\tplain','\r\n=1']){
    const parsed=cells(csvText(value)+'\r\n')[0][0]
    assert.equal(parsed,"'\t"+value)
  }
  assert.equal(cells(csvText('trygt, "sitert"\næøå')+'\r\n')[0][0],'trygt, "sitert"\næøå')
  assert.equal(cells(csvRow(row()))[0][7],'1','Numeric work seconds are not mutated as text')
})
test('microsecond precision stays exact through summation; display uses whole seconds only',()=>{
  const micro=876544n+987654n
  assert.equal(durationSeconds(micro),'1.864198');assert.equal(durationSeconds(3600000000n),'3600');assert.equal(durationClock(3712345678n),'01:01:52')
  assert.equal(durationClock(360001000000n),'100:00:01')
  assert.equal(timestampMicroseconds('2026-10-19T11:00:00.123456+01:00'),timestampMicroseconds('2026-10-19T10:00:00.123456Z'))
})
test('filenames reuse Flow period dates without PII, including week/month/year boundaries',()=>{
  assert.equal(exportFilename({kind:'day',anchor:date}),'flow-2026-10-19.csv')
  assert.equal(exportFilename({kind:'week',anchor:'2027-01-01'}),'flow-2026-12-28_til_2027-01-03.csv')
  assert.equal(exportFilename({kind:'month',anchor:'2028-02-29'}),'flow-2028-02.csv')
  assert.equal(exportFilename({kind:'total',anchor:null}),'flow-total.csv')
})
test('runtime export mapping rejects corrupt durations, future work, wrong source/task, cursor and ordinal',()=>{
  const p=pages(1)[0];assert.equal(mapExportPage(p).rows.length,1)
  for(const change of [r=>r.rows[0].work_microseconds='999',r=>r.rows[0].ended_at='2027-01-01T00:00:00Z',r=>r.rows[0].source='fake',
    r=>{r.rows[0].source='legacy-study';r.rows[0].task_id=id(77)},r=>r.rows[0].ordinal=2,
    r=>r.next_cursor={job:id(777),after:1},r=>r.total_rows=2]){
    const bad=structuredClone(p);change(bad);assert.throws(()=>mapExportPage(bad))
  }
  const fine=pages(1)[0];fine.rows[0].ended_at='2026-10-19T10:00:02.123456Z';fine.rows[0].work_microseconds='1123456'
  assert.equal(mapExportPage(fine).rows[0].work_microseconds,'1123456')
})
test('SDK uses server job/cursor, no owner/now/cutoff, and curates errors',async()=>{
  const calls=[];let response=pages()[0],failed=null
  const client=createClient('https://example.supabase.co','sb_publishable_test',{auth:{persistSession:false},global:{fetch:async(url,options)=>{
    calls.push({name:String(url).split('/').at(-1),body:JSON.parse(options.body)})
    return new Response(JSON.stringify(failed??response),{status:failed?400:200})
  }}})
  const api=createExportApi(client),signal=new AbortController().signal
  await api.start({kind:'total',anchor:null},'UTC',signal)
  assert.deepEqual(calls[0].body,{p_kind:'total',p_date:null,p_timezone:'UTC'})
  response=pages()[1];await api.page({job:id(9000),after:500},signal)
  assert.deepEqual(calls[1].body,{p_cursor:{job:id(9000),after:500},p_limit:500})
  response=null;await api.discard(id(9000));assert.equal(calls.at(-1).name,'flow_export_discard')
  failed={code:'40001',message:'private SQL text'}
  await assert.rejects(api.start({kind:'total',anchor:null},'UTC',signal),e=>e.message.includes('endret')&&!e.message.includes('private'))
})
function fake(count=501){
  const p=pages(count),saved=[],discards=[],signals=[]
  const api={start:async(_period,_zone,signal)=>{signals.push(signal);return p[0]},page:async(_cursor,signal)=>{signals.push(signal);return p[1]},discard:async id=>discards.push(id),statistics:async period=>summary(period.kind)}
  const store=createExportStore(api,file=>saved.push(file));store.connect();return {api,store,p,saved,discards,signals}
}
test('CSV downloads only after complete validated pagination and exact statistics reconciliation',async()=>{
  const f=fake();await f.store.csv({kind:'total',anchor:null},'UTC')
  assert.equal(f.saved.length,1);assert.equal(f.saved[0].count,501);assert.equal(cells(f.saved[0].content.slice(1)).length,502)
  assert.equal(f.store.getSnapshot().count,501);assert.equal(f.store.getSnapshot().phase,'ready');assert.deepEqual(f.discards,[id(9000)])
  f.store.disconnect()
})
test('empty export is consistently a header-only CSV, not a failed job',async()=>{
  const f=fake(0);await f.store.csv({kind:'total',anchor:null},'UTC');assert.equal(f.saved[0].content,csvHeader);assert.equal(f.saved[0].count,0);f.store.disconnect()
})
test('mid-export failure, duplicate/missing rows, wrong total or changing reference never downloads partial data; retry is fresh',async()=>{
  for(const type of ['failed','duplicate','gap','sum','reference']){
    const f=fake()
    if(type==='failed')f.api.page=async()=>{throw Error('Forbindelsen feilet')}
    if(type==='duplicate')f.p[1].rows[0].segment_id=f.p[0].rows[0].segment_id
    if(type==='gap')f.p[1].rows[0].ordinal=503
    if(type==='sum')f.p[0].statistics.total=999
    if(type==='reference')f.p[1].server_time='2026-10-19T12:01:00Z'
    await f.store.csv({kind:'total',anchor:null},'UTC');assert.equal(f.saved.length,0);assert.equal(f.store.getSnapshot().phase,'error')
    const fresh=pages();f.api.start=async()=>fresh[0];f.api.page=async()=>fresh[1]
    await f.store.csv({kind:'total',anchor:null},'UTC');assert.equal(f.saved.length,1);f.store.disconnect()
  }
})
test('cancel, logout/unmount and a new export abort the old request; late success never downloads',async()=>{
  for(const action of ['cancel','disconnect','new']){
    const f=fake();let resolve
    f.api.page=(_cursor,signal)=>{f.signals.push(signal);return new Promise(r=>{resolve=r})}
    const old=f.store.csv({kind:'total',anchor:null},'UTC');await tick()
    if(action==='cancel')f.store.cancel()
    if(action==='disconnect')f.store.disconnect()
    if(action==='new'){
      const fresh=pages(0);f.api.start=async()=>fresh[0];await f.store.csv({kind:'total',anchor:null},'UTC')
    }
    assert.equal(f.signals[1].aborted,true);resolve(f.p[1]);await old
    assert.equal(f.saved.length,action==='new'?1:0);f.store.disconnect()
  }
})
test('late first-page response after close is discarded without downloading',async()=>{
  const f=fake();let resolve;f.api.start=()=>new Promise(r=>{resolve=r})
  const pending=f.store.csv({kind:'total',anchor:null},'UTC');f.store.disconnect();resolve(f.p[0]);await pending
  assert.equal(f.saved.length,0);assert.deepEqual(f.discards,[id(9000)])
})
test('report uses aggregate API only for all periods, supports zero, cancels stale previews and refuses partial zone results',async()=>{
  const f=fake();f.api.start=async()=>{throw Error('Raw API must not be called')}
  for(const kind of ['day','week','month','total']){
    f.api.statistics=async p=>summary(p.kind,0);await f.store.report({kind,anchor:date},'UTC')
    assert.equal(f.store.getSnapshot().report.total,0)
  }
  let resolve;f.api.statistics=()=>new Promise(r=>{resolve=r})
  const pending=f.store.report({kind:'week',anchor:date},'UTC');f.store.cancel();resolve(summary('week'));await pending
  assert.equal(f.store.getSnapshot().report,null)
  f.api.statistics=async()=>({...summary('week'),legacy_timezone_error:'invalid-timezone'})
  await f.store.report({kind:'week',anchor:date},null);assert.equal(f.store.getSnapshot().phase,'error');assert.equal(f.store.getSnapshot().report,null)
  f.store.disconnect()
})
test('report presentation preserves all four periods, zero, areas/days/contributions, server generation time and privacy',()=>{
  for(const kind of ['day','week','month','total']){
    const data=summary(kind),model=reportModel({...data,email:'never-export@example.test',user_id:id(999)})
    assert.equal(model.total,'00:00:01');assert.equal(model.legacy,true);assert.match(model.generated,/2026.*12:00/)
    assert.equal(model.contributions[0].area,'Annet');assert.equal(model.contributions[0].task,'Uten oppgave / eldre registrering')
    assert.ok(!JSON.stringify(model).includes('never-export'));assert.ok(!JSON.stringify(model).includes(id(999)))
    assert.equal(reportModel(summary(kind,0)).total,'00:00:00')
  }
})
test('download uses a local Blob/object URL and always removes/revokes it, never a network upload',()=>{
  const originalDocument=global.document,originalCreate=URL.createObjectURL,originalRevoke=URL.revokeObjectURL,originalTimeout=global.setTimeout
  const calls=[];let link
  try{
    URL.createObjectURL=blob=>{assert.equal(blob.type,'text/csv;charset=utf-8');return 'blob:local-test'}
    URL.revokeObjectURL=url=>calls.push(['revoke',url])
    global.document={createElement:()=>link={click:()=>calls.push(['click']),remove:()=>calls.push(['remove'])},body:{append:()=>calls.push(['append'])}}
    global.setTimeout=fn=>{fn();return 0}
    downloadCsv({content:csvHeader,filename:'flow-total.csv',count:0})
    assert.equal(link.download,'flow-total.csv');assert.deepEqual(calls,[['append'],['click'],['remove'],['revoke','blob:local-test']])
  }finally{global.document=originalDocument;URL.createObjectURL=originalCreate;URL.revokeObjectURL=originalRevoke;global.setTimeout=originalTimeout}
})
test('print is isolated from app/dialog/navigation, uses light A4/Letter-friendly layout and report UI has no account props',async()=>{
  const css=await readFile(new URL('../src/styles.css',import.meta.url),'utf8'),ui=await readFile(new URL('../src/components/FlowExport.tsx',import.meta.url),'utf8'),report=await readFile(new URL('../src/components/FlowReport.tsx',import.meta.url),'utf8')
  assert.match(css,/@media print/);assert.match(css,/body:has\(\.flow-print-root\) > \* \{ display: none !important/)
  assert.match(css,/dialog, dialog::backdrop/);assert.match(css,/min-width: 0; width: 100%/);assert.match(css,/break-inside: avoid/)
  assert.match(ui,/createPortal/);assert.match(ui,/window\.print\(\)/);assert.doesNotMatch(report,/email|auth\.uid|user_id|supabase/i)
})
