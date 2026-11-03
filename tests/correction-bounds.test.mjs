import assert from 'node:assert/strict'
import test from 'node:test'
import {buildNativeCorrection,nativeDraft,correctionMatches} from '../src/lib/native-period.ts'
import {mapFlowSnapshot,flowDurations,recordedDayEnd} from '../src/lib/flow-work.ts'
import {dayTimeline,nativeHistoryWork,mapFlowHistoryPage} from '../src/lib/flow-history.ts'
import {taskDayTime} from '../src/lib/flow-tasks.ts'
import {dayDetails} from '../src/lib/day-details.ts'

const id=n=>`10000000-0000-4000-8000-${String(n).padStart(12,'0')}`
const now=Date.parse('2026-11-04T12:00Z'),server=new Date(now).toISOString(),catalog={areas:[],tasks:[]}
function snapshot(){
  const from='2026-11-03T08:07:03.123456Z',to='2026-11-03T08:46:04.654321Z'
  return mapFlowSnapshot({server_time:server,work_day:{id:id(1),logical_date:'2026-11-03',timezone:'UTC',boundary_at:'2026-11-03T04:00:00Z',cutoff_at:'2026-11-04T04:00:00Z',started_at:from,ended_at:to,created_at:from},
    segments:[{id:id(2),work_day_id:id(1),started_at:from,ended_at:to,area_id:null,task_id:id(3),created_at:from}]})
}
function corrected(s,desired){
  const next=structuredClone(s);Object.assign(next.segments[0],desired)
  next.work_day.started_at=next.segments.map(s=>s.started_at).sort()[0]
  return mapFlowSnapshot(next)
}
test('both editors share logical-boundary validation, preserving exact originals when first/last time moves',()=>{
  const s=snapshot(),row=s.segments[0],draft=nativeDraft(s,row)
  const earlier=buildNativeCorrection(s,row,{...draft,from:'2026-11-03T08:06'},now,catalog)
  assert.equal(earlier.desired.started_at,'2026-11-03T08:06:00.000Z');assert.equal(earlier.desired.ended_at,row.ended_at)
  assert.equal(earlier.expected.started_at,row.started_at);assert.equal(earlier.expected.ended_at,row.ended_at)
  const later=buildNativeCorrection(s,row,{...draft,to:'2026-11-04T03:30'},now,catalog)
  assert.equal(later.desired.started_at,row.started_at);assert.equal(later.desired.ended_at,'2026-11-04T03:30:00.000Z')
  const boundary=buildNativeCorrection(s,row,{...draft,from:'2026-11-03T04:00',to:'2026-11-04T04:00'},now,catalog)
  assert.equal(boundary.desired.started_at,'2026-11-03T04:00:00.000Z')
  for(const fields of [{from:'2026-11-03T03:59'},{from:'2026-11-04T04:00',to:'2026-11-04T04:00'},{to:'2026-11-04T04:01'}])assert.throws(()=>buildNativeCorrection(s,row,{...draft,...fields},now,catalog),/arbeidsdagen/)
  assert.throws(()=>buildNativeCorrection(s,row,{...draft,to:'2026-11-03T10:00'},Date.parse('2026-11-03T09:59Z'),catalog),/fremtiden/)
})
test('closed lifecycle markers do not truncate corrected work, task time or timeline; pause is nonnegative and sums to elapsed',()=>{
  const old=snapshot(),s=corrected(old,{started_at:'2026-11-03T08:06:00Z',ended_at:'2026-11-03T10:00:00Z'})
  assert.equal(s.work_day.ended_at,old.work_day.ended_at)
  assert.equal(flowDurations(s,now).work,114*60000);assert.equal(nativeHistoryWork(s),114*60000)
  assert.deepEqual(taskDayTime(s,id(3),now),{work:114*60000,current:0})
  assert.equal(recordedDayEnd(s),s.segments[0].ended_at)
  assert.deepEqual(flowDurations(s,now),{work:114*60000,elapsed:114*60000,pause:0,current:0})
  const timeline=dayTimeline(s);assert.equal(timeline[0].start,s.work_day.started_at);assert.equal(timeline[0].end,'2026-11-03T10:00:00Z')
  const entry=mapFlowHistoryPage({server_time:server,next_cursor:null,rows:[{source:'flow',id:s.work_day.id,started_at:s.work_day.started_at,snapshot:s}]}).rows[0]
  assert.equal(entry.snapshot.segments[0].ended_at,'2026-11-03T10:00:00Z')
  assert.equal(dayDetails(null,old,[entry],null,true).snapshot,entry.snapshot)
})
test('first activity may move after lifecycle close; current and zero-period geometry still uses canonical segment extent',()=>{
  const old=snapshot(),late=corrected(old,{started_at:'2026-11-03T09:00:00Z',ended_at:'2026-11-03T09:30:00Z'})
  assert.ok(Date.parse(late.work_day.started_at)>Date.parse(late.work_day.ended_at))
  assert.deepEqual(flowDurations(late,now),{work:1800000,elapsed:1800000,pause:0,current:0})
  const zero=corrected(old,{started_at:'2026-11-03T09:00:00.123456Z',ended_at:'2026-11-03T09:00:00.123456Z'})
  assert.deepEqual(flowDurations(zero,now),{work:0,elapsed:0,pause:0,current:0});assert.equal(dayTimeline(zero)[0].start,zero.work_day.started_at)
  const paused=snapshot();paused.work_day.ended_at=null
  assert.equal(recordedDayEnd(paused),null)
  const duration=flowDurations(paused,Date.parse('2026-11-03T12:00Z'))
  // Each public Number is floored after exact microsecond aggregation.
  assert.ok(Math.abs(duration.work+duration.pause-duration.elapsed)<=1)
})
test('closed-day trailing pause remains, multiple corrected periods count once and no future/cutoff time is invented',()=>{
  const s=snapshot();s.work_day.started_at='2026-11-03T08:00:00Z';s.work_day.ended_at='2026-11-03T09:00:00Z'
  s.segments[0].started_at='2026-11-03T08:00:00Z';s.segments[0].ended_at='2026-11-03T08:30:00Z'
  s.segments.push({...s.segments[0],id:id(9),started_at:'2026-11-03T10:00:00Z',ended_at:'2026-11-03T10:30:00Z'})
  const mapped=mapFlowSnapshot(s),total=flowDurations(mapped,now)
  assert.deepEqual(total,{work:3600000,elapsed:9000000,pause:5400000,current:0})
  assert.equal(taskDayTime(mapped,id(3),now).work,total.work)
  assert.deepEqual(dayTimeline(mapped).map(p=>p.kind),['work','pause','work'])
  assert.equal(flowDurations(mapped,Date.parse('2026-11-03T10:15Z')).work,45*60000)
  assert.equal(flowDurations(mapped,now+10*86400000).work,total.work)
  mapped.segments[1].ended_at='2026-11-04T04:00:00.000001Z';assert.throws(()=>mapFlowSnapshot(mapped))
})
test('DST uses stored 23/25-hour 04:00 bounds, preserving logical date and original timestamp precision',()=>{
  for(const [from,boundary,cutoff,hours,date]of [
    ['2026-03-28T08:07:03.123456+01:00','2026-03-28T04:00:00+01:00','2026-03-29T04:00:00+02:00',23,'2026-03-28'],
    ['2026-10-24T08:07:03.123456+02:00','2026-10-24T04:00:00+02:00','2026-10-25T04:00:00+01:00',25,'2026-10-24'],
  ]){
    const s=snapshot();s.work_day={...s.work_day,logical_date:date,timezone:'Europe/Oslo',boundary_at:boundary,cutoff_at:cutoff,started_at:from,ended_at:from}
    s.segments[0]={...s.segments[0],started_at:from,ended_at:from}
    const draft=nativeDraft(s,s.segments[0])
    const input=buildNativeCorrection(s,s.segments[0],{...draft,from:date+'T04:00',to:cutoff.slice(0,16)},now,catalog)
    const mapped=corrected(s,input.desired)
    assert.equal(flowDurations(mapped,now).work,hours*3600000)
    assert.equal(mapped.work_day.logical_date,date);assert.equal(mapped.work_day.timezone,'Europe/Oslo')
    assert.equal(input.expected.started_at,from)
  }
})
test('derived day start never rebases frozen editor values or lost-reply acknowledgement',()=>{
  const s=snapshot(),row=s.segments[0],editor={snapshot:s,segment:row}
  const input=buildNativeCorrection(s,row,{...nativeDraft(s,row),from:'2026-11-03T08:06'},now,catalog)
  const saved=corrected(s,input.desired)
  assert.equal(correctionMatches(saved,input),true)
  const context=dayDetails(null,saved,[{source:'flow',id:saved.work_day.id,snapshot:saved}],editor,true)
  assert.equal(context.snapshot,s);assert.equal(context.stale,true)
  assert.equal(editor.segment.started_at,'2026-11-03T08:07:03.123456Z')
  assert.equal(input.expected.started_at,editor.segment.started_at)
})
