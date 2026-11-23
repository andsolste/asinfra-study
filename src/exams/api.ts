import { supabase } from '../lib/supabase'
import type { Answer, Asset, Catalogue, Guidance, Snapshot } from './model'
export type Save = { attempt: string; number: number; expected: number; answer: Answer; submit: boolean; request: string }
export type Start = { id: string; exam: string; version: number; feedback: 'each' | 'end'; mode: 'practice' | 'exam'; clock: boolean }
export type ExamApi = {
  catalogue(): Promise<Catalogue>; get(id: string): Promise<Snapshot>; start(input: Start): Promise<Snapshot>
  save(input: Save): Promise<Snapshot>; submit(id: string, revision: number): Promise<Snapshot>
  guidance(id: string, number: number): Promise<Guidance>; asset(id: string, asset: string): Promise<Asset>
  assess(id: string, number: number, revision: number, assessment: string | null, request: string): Promise<Snapshot>
}
async function rpc<T>(name: string, args = {}): Promise<T> {
  if (!supabase) throw new Error('Supabase er ikke konfigurert.')
  const result = await supabase.rpc(name,args)
  if (result.error) throw result.error
  if (!result.data) throw new Error('Tomt svar fra serveren.')
  return result.data as T
}
export const examApi: ExamApi = {
  catalogue: () => rpc('exam_catalogue'), get: id => rpc('exam_attempt_get',{p_attempt_id:id}),
  start: p => rpc('exam_attempt_start',{p_attempt_id:p.id,p_exam_id:p.exam,p_version:p.version,p_feedback:p.feedback,p_mode:p.mode,p_show_clock:p.clock}),
  save: p => rpc('exam_response_save',{p_attempt_id:p.attempt,p_number:p.number,p_expected_revision:p.expected,p_answer:p.answer,p_submit:p.submit,p_request_id:p.request}),
  submit: (id,revision) => rpc('exam_attempt_submit',{p_attempt_id:id,p_expected_revision:revision}),
  guidance: (id,number) => rpc('exam_guidance',{p_attempt_id:id,p_number:number}),
  asset: (id,asset) => rpc('exam_prompt_asset',{p_attempt_id:id,p_asset_id:asset}),
  assess: (id,number,revision,assessment,request) => rpc('exam_self_assess',{p_attempt_id:id,p_number:number,p_expected_revision:revision,p_assessment:assessment,p_request_id:request}),
}
