import type { ExamApi, Save } from './api'
import type { Answer, Snapshot } from './model'
import { sameAnswer } from './model.ts'

type State = { data: Snapshot | null; number: number; draft: Answer; dirty: boolean; busy: boolean; locking: boolean; error: string | null; blocked: boolean }
// One serialized editor. Revisions are frozen at write time; refreshing never
// rebases an uncertain write or overwrites the student's unsaved answer.
export function createExamEditor(api: ExamApi, uuid = () => crypto.randomUUID()) {
  let state: State = { data:null,number:2,draft:{},dirty:false,busy:false,locking:false,error:null,blocked:false }
  let pending: Save | null = null
  const listeners = new Set<() => void>()
  const set = (next: Partial<State>) => { state={...state,...next}; listeners.forEach(l=>l()) }
  const response = (data=state.data) => data?.responses.find(r=>r.number===state.number)
  function install(data: Snapshot, number=state.data?.attempt.id===data.attempt.id?state.number:data.attempt.current_question) {
    if(!data.questions.some(q=>q.number===number))number=data.questions[0].number
    pending=null; set({data,number,draft:data.responses.find(r=>r.number===number)?.answer??{},dirty:false,busy:false,locking:false,error:null,blocked:false})
  }
  function accept(data: Snapshot, operation: Save) {
    pending=null
    const edited = !sameAnswer(state.draft,operation.answer)
    set({data,busy:false,locking:false,blocked:false,error:null,dirty:edited && !operation.submit,draft:operation.submit?operation.answer:state.draft})
  }
  async function recover() {
    if (!pending || state.busy) return false
    const operation=pending; set({busy:true,error:null})
    try {
      const fresh=await api.get(operation.attempt), row=fresh.responses.find(r=>r.number===operation.number)
      if (row?.last_request===operation.request) { accept(fresh,operation); return true }
      set({busy:false,blocked:true,error:'Svaret er ikke bekreftet lagret. Utkastet er beholdt. Prøv samme lagring igjen, eller hent serverversjonen.'})
    } catch { set({busy:false,blocked:true,error:'Kunne ikke kontrollere lagringen. Utkastet er beholdt.'}) }
    return false
  }
  async function save(submit=false, retry=false): Promise<boolean> {
    if (!state.data || state.busy || state.blocked && !retry) return false
    if (state.data.attempt.submitted_at || response()?.submitted_at) return true
    if (!state.dirty && !submit && !retry) return true
    const operation=retry?pending:{attempt:state.data.attempt.id,number:state.number,expected:response()?.revision??0,answer:structuredClone(state.draft),submit,request:uuid()}
    if (!operation) return false
    pending=operation; set({busy:true,locking:operation.submit,error:null})
    try { accept(await api.save(operation),operation); return true }
    catch {
      set({busy:false,locking:false,blocked:true,error:'Lagringen kunne ikke bekreftes. Kontrollerer serveren …'})
      return recover()
    }
  }
  return {
    getSnapshot:()=>state, subscribe:(listener:()=>void)=>{listeners.add(listener);return()=>{listeners.delete(listener)}}, install,
    edit(answer:Answer) { if (!state.data || state.locking || state.blocked || response()?.submitted_at || state.data.attempt.submitted_at || pending?.submit) return; set({draft:answer,dirty:!sameAnswer(answer,response()?.answer??{})}) },
    save, recover, retry:()=>save(false,true),
    async navigate(number:number) { if (state.busy || state.blocked || !await save() || state.dirty) return false; install(state.data!,number); return true },
    async refresh(discard=false) {
      if (!state.data || state.busy || !discard && (state.dirty || state.blocked)) return false
      const draftAtRead=state.draft
      set({busy:true})
      try {
        const fresh=await api.get(state.data.attempt.id)
        if(state.draft!==draftAtRead){set({busy:false});return false}
        install(fresh);return true
      } catch {set({busy:false,error:'Kunne ikke hente forsøket.'});return false}
    },
    async finish() {
      if (state.busy || state.blocked || !await save() || state.dirty || !state.data) return false
      set({busy:true,locking:true}); const old=state.data
      try {install(await api.submit(old.attempt.id,old.attempt.revision));return true}
      catch {
        // Final submission has no client-side scoring or unlock. Only the
        // server's confirmed submission releases guidance.
        try { const fresh=await api.get(old.attempt.id); if (fresh.attempt.submitted_at) {install(fresh);return true} }
        catch { /* Keep the original snapshot and require an explicit read. */ }
        set({busy:false,locking:false,blocked:true,error:'Innleveringen er ikke bekreftet. Hent serverversjonen før du prøver igjen.'}); return false
      }
    },
    async assess(assessment:string|null) {
      if (!state.data || state.busy || state.blocked) return false
      const old=state.data, row=response(), number=state.number
      if (!row?.submitted_at) return false
      set({busy:true}); const request=uuid()
      try {install(await api.assess(old.attempt.id,number,row.revision,assessment,request));return true}
      catch {
        try { const fresh=await api.get(old.attempt.id); if(fresh.responses.find(r=>r.number===number)?.last_request===request){install(fresh);return true} } catch { /* Explicit reload below. */ }
        set({busy:false,blocked:true,error:'Egenvurderingen er ikke bekreftet. Hent serverversjonen.'});return false
      }
    },
  }
}
