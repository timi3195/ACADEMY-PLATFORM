import { useEffect, useRef } from 'react'
import { useLocation, useNavigationType } from 'react-router-dom'

export default function RouteScrollReset() {
  const location = useLocation()
  const navigationType = useNavigationType()
  const initialLoad = useRef(true)

  useEffect(() => {
    if (initialLoad.current || navigationType !== 'POP') {
      window.scrollTo(0, 0)
    }
    initialLoad.current = false
  }, [location.key, navigationType])

  return null
}
