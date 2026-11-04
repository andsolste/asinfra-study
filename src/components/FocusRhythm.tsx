import { useEffect, useState } from 'react'
import type { FlowWorkspaceData } from '../hooks/useFlowWorkDay'
import { useFocusRhythm } from '../hooks/useFocusRhythm'
import { focusClock, focusPresets } from '../lib/focus-rhythm'

export default function FocusRhythm({ owner, data }: { owner: string; data: FlowWorkspaceData }) {
  const focus = useFocusRhythm(owner, data), { settings, progress } = focus
  const [custom, setCustom] = useState(false)
  const [lengths, setLengths] = useState({ focus: String(settings.focusMinutes), pause: String(settings.breakMinutes) })
  const [error, setError] = useState<string | null>(null)
  const [saved, setSaved] = useState(false)
  const preset = focusPresets.find(([a, b]) => a === settings.focusMinutes && b === settings.breakMinutes)
  useEffect(() => { setLengths({ focus: String(settings.focusMinutes), pause: String(settings.breakMinutes) }) }, [settings.focusMinutes, settings.breakMinutes])
  const message = focus.checking ? 'Kontrollerer Flow-status før nedtellingen fortsetter.'
    : progress.kind === 'idle' ? 'Fokus begynner når du starter en arbeidsperiode.'
    : progress.due ? progress.kind === 'focus' ? 'Tid for pause. Velg Pause når det passer.' : 'Pausen er ferdig. Fortsett når du er klar.'
    : progress.kind === 'focus' ? 'Arbeid som vanlig. Du velger selv når du tar pause.' : 'Flow er pauset. Arbeid starter først når du velger Fortsett.'

  return <section className="focus-rhythm" aria-label="Fokusrytme">
    <details><summary>Fokusrytme <span>{settings.enabled ? `${settings.focusMinutes} / ${settings.breakMinutes} min` : 'Av'}</span></summary>
      <label className="focus-toggle"><input type="checkbox" checked={settings.enabled}
        onChange={e => focus.update({ ...settings, enabled: e.target.checked })} />Bruk fokusrytme</label>
      <form onSubmit={e => {
        e.preventDefault(); setError(null); setSaved(false)
        try { focus.update({ ...settings, focusMinutes: Number(lengths.focus), breakMinutes: Number(lengths.pause) }); setSaved(true) }
        catch (err) { setError(err instanceof Error ? err.message : 'Kontroller minuttene.') }
      }}>
        <div className="auth-field"><label htmlFor="focus-preset">Fokus / pause</label>
          <select id="focus-preset" value={custom || !preset ? 'custom' : `${preset[0]}/${preset[1]}`} onChange={e => {
            setError(null); setSaved(false)
            if (e.target.value === 'custom') { setCustom(true); setLengths({ focus: String(settings.focusMinutes), pause: String(settings.breakMinutes) }) }
            else { const [a, b] = e.target.value.split('/').map(Number); setCustom(false); focus.update({ ...settings, focusMinutes: a, breakMinutes: b }) }
          }}>
            {focusPresets.map(([a, b]) => <option key={a} value={`${a}/${b}`}>{a} / {b} minutter</option>)}
            <option value="custom">Egendefinert</option>
          </select></div>
        {(custom || !preset) && <>
          <div className="focus-lengths">
            <div className="auth-field"><label htmlFor="focus-length">Fokus (minutter)</label><input id="focus-length" type="number" min={1} max={240} step={1} required value={lengths.focus} onChange={e => { setLengths({ ...lengths, focus: e.target.value }); setSaved(false) }} /></div>
            <div className="auth-field"><label htmlFor="break-length">Pause (minutter)</label><input id="break-length" type="number" min={1} max={60} step={1} required value={lengths.pause} onChange={e => { setLengths({ ...lengths, pause: e.target.value }); setSaved(false) }} /></div>
          </div><button type="submit" className="secondary-button">Lagre fokusinnstillinger</button>
        </>}
        {error && <p className="auth-error" role="alert">{error}</p>}{saved && <p role="status">Fokusinnstillinger lagret.</p>}
      </form>
      <p className="timer-meta">Aktivitetsskifte beholder fokusperioden. Etter en registrert pause begynner en ny fokusperiode når du fortsetter, også ved en kort pause. Ingen perioder avsluttes eller starter automatisk.</p>
      <button type="button" className="text-button" disabled={focus.permission === 'unsupported' || focus.permission === 'denied' && !settings.notifications}
        onClick={() => { if (settings.notifications) focus.update({ ...settings, notifications: false }); else void focus.requestNotifications() }}>
        {settings.notifications ? 'Slå av nettleservarsler' : 'Aktiver nettleservarsler'}</button>
      <p className="timer-meta">{focus.permission === 'unsupported' ? 'Sikker varsling mellom faner støttes ikke her. Beskjeder vises i Flow.'
        : focus.permission === 'denied' ? 'Nettleservarsler er blokkert. Beskjeder vises fortsatt i Flow.'
        : settings.notifications && focus.permission === 'granted' ? 'Nettleservarsler er på. Appen må være åpen; nettleseren kan utsette varsler i bakgrunnen eller under dvale.'
        : 'Nettleservarsler er valgfrie. Tillatelse spørres bare når du aktiverer dem.'}</p>
      {!focus.persistent && <p className="timer-meta">Nettleserlagring er utilgjengelig. Innstillingene gjelder denne fanen; bare beskjeder i Flow brukes.</p>}
      {focus.noticeError && <p className="timer-meta">Nettleservarselet kunne ikke leveres sikkert. Bruk beskjeden i Flow.</p>}
      <p className="timer-meta">Innstillingene huskes for din konto i denne nettleseren.</p>
    </details>
    {settings.enabled && <>
      {progress.kind !== 'idle' && <p className="focus-countdown"><span>{progress.kind === 'focus' ? 'Fokus gjenstår' : 'Pause gjenstår'}</span><strong>{focusClock(progress.remaining)}</strong></p>}
      <p className="focus-message" role="status">{message}</p>
    </>}
  </section>
}
