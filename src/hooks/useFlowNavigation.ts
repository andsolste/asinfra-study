import { useCallback, useEffect, useState } from 'react'
import { flowLocationUrl, readFlowLocation } from '../lib/flow-navigation'
import type { FlowLocation } from '../lib/flow-navigation'

export function useFlowNavigation() {
  const [location, setLocation] = useState(() => readFlowLocation(window.location.href))
  useEffect(() => {
    const restore = () => setLocation(readFlowLocation(window.location.href))
    window.addEventListener('popstate', restore)
    return () => window.removeEventListener('popstate', restore)
  }, [])
  const navigate = useCallback((next: FlowLocation) => {
    const href = flowLocationUrl(window.location.href, next)
    if (href !== window.location.href) window.history.pushState(window.history.state, '', href)
    setLocation(readFlowLocation(href))
  }, [])
  return { location, navigate }
}
