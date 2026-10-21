import { useEffect, useState } from 'react'
import type { MouseEvent } from 'react'
import { flowLocationUrl, flowViews } from '../lib/flow-navigation'
import type { FlowLocation, FlowView } from '../lib/flow-navigation'

// Keep real links (including open-in-new-tab); only ordinary clicks are SPA navigation.
export function followFlowLink(event: MouseEvent<HTMLAnchorElement>, action: () => void) {
  if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return
  event.preventDefault(); action()
}

export default function FlowNavigation({ location, navigate }: {
  location: FlowLocation; navigate: (next: FlowLocation) => void
}) {
  const [keyboardOpen, setKeyboardOpen] = useState(false)
  useEffect(() => {
    let height = window.innerHeight
    const update = () => {
      const editing = document.activeElement?.matches('input, textarea, select, [contenteditable="true"]') ?? false
      if (!editing) height = window.innerHeight
      setKeyboardOpen(editing && height - (window.visualViewport?.height ?? window.innerHeight) > 120)
    }
    window.visualViewport?.addEventListener('resize', update)
    window.addEventListener('resize', update)
    document.addEventListener('focusin', update); document.addEventListener('focusout', update)
    return () => {
      window.visualViewport?.removeEventListener('resize', update)
      window.removeEventListener('resize', update)
      document.removeEventListener('focusin', update); document.removeEventListener('focusout', update)
    }
  }, [])
  return <nav className="flow-navigation" aria-label="Hovednavigasjon" data-keyboard-open={keyboardOpen}>
    {(Object.keys(flowViews) as FlowView[]).map(view => {
      const next = { view, insight: location.insight }
      return <a key={view} href={flowLocationUrl(window.location.href, next)} aria-current={location.view === view ? 'page' : undefined}
        onClick={event => followFlowLink(event, () => navigate(next))}>{flowViews[view]}</a>
    })}
  </nav>
}
