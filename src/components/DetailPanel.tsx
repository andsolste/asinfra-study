import { useEffect, useRef } from 'react'
import type { ReactNode } from 'react'

type Props = {
  open: boolean
  title: string
  busy: boolean
  hasForms: boolean
  returnFocus: HTMLElement | null
  onClose: () => void
  children: ReactNode
}

export default function DetailPanel({ open, title, busy, hasForms, returnFocus, onClose, children }: Props) {
  const dialog = useRef<HTMLDialogElement>(null)
  const closeButton = useRef<HTMLButtonElement>(null)

  useEffect(() => {
    const element = dialog.current
    if (!element) return
    if (open && !element.open) {
      element.showModal()
      closeButton.current?.focus()
    } else if (!open && element.open) {
      element.close()
      returnFocus?.focus()
    }
  }, [open, returnFocus])

  return <dialog id="study-details" ref={dialog} className="detail-panel" aria-labelledby="detail-title"
    onCancel={event => { event.preventDefault(); if (!busy) onClose() }}
    onKeyDown={event => {
      if (event.key !== 'Tab') return
      const controls = Array.from(event.currentTarget.querySelectorAll<HTMLElement>(
        'button, a[href], input, select, textarea, summary, [tabindex]',
      )).filter(element => element.tabIndex >= 0 && !element.matches(':disabled') && element.getClientRects().length > 0)
      const first = controls[0], last = controls.at(-1)
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault(); last?.focus()
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault(); first?.focus()
      }
    }}
    onClose={() => { if (open && !dialog.current?.open) onClose() }}>
    <header className="detail-panel-header">
      <h2 id="detail-title">{title}</h2>
      <button ref={closeButton} type="button" className="secondary-button" aria-disabled={busy}
        aria-describedby={busy ? 'detail-busy' : undefined}
        aria-label={`Lukk ${title}`} onClick={() => { if (!busy) onClose() }}>Lukk</button>
    </header>
    <div className="detail-panel-content">
      {hasForms && <p className="detail-panel-hint">Ulagrede skjemaendringer forkastes når du lukker panelet.</p>}
      {busy && <p id="detail-busy" role="status">Vent til lagringen er kontrollert før du lukker.</p>}
      {children}
    </div>
  </dialog>
}
