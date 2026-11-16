import type { FlowCatalog, FlowCommand, FlowState, FlowSnapshot, createFlowApi } from './flow-work.ts'
import { activityUsable, FlowActionError } from './flow-work.ts'
import { TaskActionError, taskApplied } from './flow-tasks.ts'
import type { TaskCommand } from './flow-tasks.ts'
type Command = FlowCommand | TaskCommand
type TimerCommand = Extract<FlowCommand, { kind: 'activity' }>
const isTask = (command: Command): command is TaskCommand => command.kind === 'save-task' || command.kind === 'status-task'

export type FlowPhase = 'loading' | 'idle' | 'running' | 'paused' | 'recovering' | 'error'
type State = { phase: FlowPhase; data: FlowState | null; closed: FlowSnapshot | null; catalog: FlowCatalog; pending: Command | null;
  error: string | null; notice: string | null; anchor: { server: number; received: number } | null; readRevision: number;
  timerWaiting: 'pause' | 'resume' | null }
type Options = { timezone: () => string | null; clock?: () => number }

function matchesTimerCommand(command: TimerCommand, state: State) {
  const current = state.data?.current
  if (!current || current.work_day.id !== command.dayId || current.segments.length !== command.expectedCount) return false
  const open = current.segments.find(segment => segment.ended_at === null)
  if ((open?.id ?? null) !== command.expectedId) return false
  if (command.nextId === null) return Boolean(open)
  const last = current.segments.at(-1)
  return !open && !!last && last.area_id === command.areaId && last.task_id === command.taskId
    && activityUsable(command, state.catalog)
}

// No persisted local timer. Snapshots, IDs and server clock are authoritative.
export function createFlowStore(api: ReturnType<typeof createFlowApi>, options: Options) {
  const clock = options.clock ?? (() => performance.now())
  let state: State = { phase: 'loading', data: null, closed: null, catalog: { areas: [], tasks: [] }, pending: null, error: null, notice: null,
    anchor: null, readRevision: 0, timerWaiting: null }
  let readSequence = 0
  let request: AbortController | null = null, connected = false, queued = false
  let waitingTimer: { command: TimerCommand; resolve: (applied: boolean) => void } | null = null
  const listeners = new Set<() => void>()
  const update = (values: Partial<State>) => { state = { ...state, ...values }; listeners.forEach(fn => fn()) }
  function accept(data: FlowState, catalog: FlowCatalog, received: number, closed: FlowSnapshot | null, readRevision: number, notice: string | null = null) {
    const current = data.current
    update({ data, catalog, closed, phase: current ? current.segments.some(s => s.ended_at === null) ? 'running' : 'paused' : 'idle',
      pending: null, error: null, notice, anchor: { server: Date.parse(data.server_time), received }, readRevision })
  }
  async function read(signal: AbortSignal) {
    const readRevision = ++readSequence
    const previous = state.data?.current
    const [work, catalog] = await Promise.all([
      api.load(signal, options.timezone()).then(data => ({ data, received: clock() })), api.catalog(signal),
    ])
    let closed = state.closed
    if (!work.data.current && previous) {
      const final = await api.snapshot(signal, previous.work_day.id)
      if (final?.work_day.ended_at) closed = final
    }
    return { ...work, catalog, closed, readRevision }
  }
  async function run(command: Command | null, readNotice: string | null = null): Promise<boolean> {
    if (!connected || request) return false
    const controller = new AbortController(); request = controller
    const timeout = setTimeout(() => controller.abort(), 15000)
    update({ phase: state.data ? 'recovering' : 'loading', error: null,
      ...(command ? { pending: command, timerWaiting: null } : {}) })
    let confirmed = false
    try {
      if (command) { if (isTask(command)) await api.mutate(command, controller.signal); else await api.act(command, controller.signal) }
      const result = await read(controller.signal)
      if (request !== controller) return false
      const activity = command && !isTask(command) ? command : null
      const next = activity?.kind === 'start' ? activity.segmentId : activity?.nextId
      const applied = !command || (isTask(command) ? taskApplied(command, result.catalog.tasks) : next ? result.data.current?.segments.some(s => s.id === next)
        : activity?.kind === 'activity' && !result.data.current?.segments.some(s => s.id === activity.expectedId && s.ended_at === null))
      accept(result.data, result.catalog, result.received, result.closed, result.readRevision,
        applied ? readNotice : 'Status er endret i en annen fane eller dagen er utløpt. Kontroller aktiviteten.')
      confirmed = Boolean(applied)
    } catch (error) {
      if (request !== controller) return false
      // A failed/unknown write may already be committed. READ, never blindly create
      // another UUID/segment. If this read also fails, preserve the exact retry IDs.
      if (command && !controller.signal.aborted) {
        try {
          const result = await read(controller.signal)
          if (request !== controller) return false
          confirmed = isTask(command) && Boolean(taskApplied(command, result.catalog.tasks))
          if (request === controller) accept(result.data, result.catalog, result.received, result.closed, result.readRevision,
            confirmed ? 'Oppgaveendringen er bekreftet etter ny statuskontroll.'
              : `${error instanceof FlowActionError || error instanceof TaskActionError ? error.message : 'Handlingen kunne ikke bekreftes.'} Status er hentet på nytt; kontroller oppgave og aktivitet før du fortsetter.`)
        } catch {
          if (request === controller) update({ phase: 'error', error: 'Kunne ikke kontrollere handlingen. Arbeid kan være lagret. Hent status eller prøv samme handling igjen.' })
        }
      } else update({ phase: 'error', error: 'Kunne ikke hente sikker status. Kontroller forbindelsen og prøv igjen.' })
    } finally {
      clearTimeout(timeout)
      if (request === controller) {
        request = null
        const timer = waitingTimer
        waitingTimer = null
        let rejectedNotice: string | null = null
        if (timer) {
          if (confirmed && matchesTimerCommand(timer.command, state)) {
            // Run the user's original command before any redundant background read.
            // Its expected IDs/count still guard the write if another tab wins the race.
            void run(timer.command).then(timer.resolve)
          } else {
            const action = timer.command.nextId === null ? 'Pause' : 'Fortsett'
            const reason = confirmed ? 'statusen for arbeidsperioden endret seg' : 'Flow ikke kunne bekrefte status'
            rejectedNotice = `${action} ble ikke utført fordi ${reason}.`
            update({ timerWaiting: null, notice: rejectedNotice })
            timer.resolve(false)
          }
        }
        if (queued && connected && !request) { queued = false; void run(null, rejectedNotice) }
      }
    }
    return confirmed
  }
  return {
    subscribe(fn: () => void) { listeners.add(fn); return () => { listeners.delete(fn) } },
    getSnapshot: () => state,
    // A gap must wait for an accepted read STARTED after its observation, not an
    // older in-flight response or the immediate return from a queued refresh.
    latestRead: () => readSequence,
    now: () => state.anchor ? state.anchor.server + Math.max(0, clock() - state.anchor.received) : 0,
    connect() { connected = true; void run(null) },
    disconnect() {
      connected = false; queued = false; request?.abort(); request = null
      if (waitingTimer) {
        waitingTimer.resolve(false)
        waitingTimer = null
        update({ timerWaiting: null })
      }
    },
    refresh() { if (request) { queued = true; return Promise.resolve(false) } return run(null) },
    dispatch(command: Command) {
      if (!['idle', 'running', 'paused'].includes(state.phase) || state.pending) return Promise.resolve(false)
      return run(command)
    },
    dispatchTimer(command: TimerCommand) {
      if (!connected || state.pending || waitingTimer || !matchesTimerCommand(command, state)) return Promise.resolve(false)
      if (state.phase === 'running' || state.phase === 'paused') return run(command)
      if (!request || state.phase !== 'recovering') return Promise.resolve(false)
      return new Promise<boolean>(resolve => {
        waitingTimer = { command, resolve }
        update({ timerWaiting: command.nextId === null ? 'pause' : 'resume' })
      })
    },
    retry() { return run(state.pending) },
  }
}
