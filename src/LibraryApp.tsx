import { useEffect, useState } from 'react'
import App from './App'
import { OperationalPage } from './components/OperationalPage'

function currentArea() {
  return window.location.hash.split('?')[0]
}

export default function LibraryApp() {
  const [area, setArea] = useState(currentArea)
  useEffect(() => {
    const update = () => setArea(currentArea())
    window.addEventListener('hashchange', update)
    return () => window.removeEventListener('hashchange', update)
  }, [])
  if (area === '#atendimento-teste')
    return <OperationalPage mode="demo" key="demo" />
  if (area === '#atendimento')
    return <OperationalPage mode="persisted" key="persisted" />
  return <App />
}
