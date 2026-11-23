export type Answer = Record<string, string | string[]>
export type Field = { id: string; label: string; kind: 'single' | 'multiple' | 'select' | 'text'; options?: { id: string; text: string }[] }
export type Block = { type: 'text'; text: string } | { type: 'field'; id: string } | { type: 'image'; asset: string; alt: string }
export type Question = { number: number; title: string; kind: string; max_points: number; source_pages: number[]; review_status: 'verified' | 'manual'; review_note: string; grading: 'automatic' | 'self' | 'unverified'; prompt: { blocks: Block[]; fields: Field[] } }
export type Attempt = { id: string; exam_id: string; version: number; feedback: 'each' | 'end'; mode: 'practice' | 'exam'; show_clock: boolean; started_at: string; submitted_at: string | null; revision: number; current_question: number }
export type Response = { number: number; answer: Answer; revision: number; submitted_at: string | null; auto_points: number | null; self_assessment: 'full' | 'partial' | 'none' | null; last_request: string | null }
export type Snapshot = { attempt: Attempt; exam: { title: string; course: string; source_name: string; introduction: string; duration_minutes: number }; questions: Question[]; responses: Response[]; server_time: string }
export type Exam = { exam_id: string; version: number; title: string; course: string; duration_minutes: number; question_count: number; max_points: number }
export type Catalogue = { exams: Exam[]; attempts: Attempt[] }
export type Asset = { id: string; base64: string }
export type Guidance = { source: string; source_name: string; pages: number[]; correct: Answer; assets: Asset[] }
export const sameAnswer = (a: Answer, b: Answer) => JSON.stringify(a) === JSON.stringify(b)
export function answerState(q: Question, answer: Answer = {}): 'empty' | 'partial' | 'complete' {
  const filled = q.prompt.fields.filter(f => { const value = answer[f.id]; return Array.isArray(value) ? value.length > 0 : Boolean(value?.trim()) }).length
  return filled === 0 ? 'empty' : filled === q.prompt.fields.length ? 'complete' : 'partial'
}
export function resultSummary(data: Snapshot) {
  let automatic = 0, automaticMax = 0, self = 0, selfMax = 0, unassessed = 0, unanswered = 0, complete = 0, partial = 0
  for (const q of data.questions.filter(q => q.max_points > 0)) {
    const r = data.responses.find(r => r.number === q.number), state = answerState(q, r?.answer)
    if (state === 'empty') unanswered++; else if (state === 'complete') complete++; else partial++
    if (r?.auto_points !== null && r?.auto_points !== undefined) { automatic += r.auto_points; automaticMax += q.max_points }
    else if (r?.self_assessment) { self += q.max_points * ({ full: 1, partial: .5, none: 0 }[r.self_assessment]); selfMax += q.max_points }
    else if (state !== 'empty') unassessed++
  }
  return { automatic, automaticMax, self, selfMax, unassessed, unanswered, complete, partial }
}
export function examUrl(attempt?: string) {
  const url = new URL(window.location.href); url.searchParams.set('app','exams'); url.searchParams.delete('attempt')
  if (attempt) url.searchParams.set('attempt',attempt)
  url.hash = ''; return url.pathname + url.search
}
