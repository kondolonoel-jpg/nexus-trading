import { useEffect, useRef } from 'react'

/** Appelle fn immédiatement puis toutes les `ms` millisecondes (annule au démontage). */
export function usePoll(fn, ms, deps = []) {
  const ref = useRef(fn)
  ref.current = fn
  useEffect(() => {
    let alive = true
    const run = () => { if (alive) ref.current() }
    run()
    const id = setInterval(run, ms)
    return () => { alive = false; clearInterval(id) }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ms, ...deps])
}
