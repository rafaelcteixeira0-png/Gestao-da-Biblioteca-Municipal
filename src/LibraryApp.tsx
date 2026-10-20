import { useEffect, useState } from 'react'
import App from './App'
import { OperationalPage } from './components/OperationalPage'

export default function LibraryApp() {
  const [operational, setOperational] = useState(
    () => window.location.hash.split('?')[0] === '#atendimento',
  )
  useEffect(() => {
    const update = () =>
      setOperational(window.location.hash.split('?')[0] === '#atendimento')
    window.addEventListener('hashchange', update)
    return () => window.removeEventListener('hashchange', update)
  }, [])
  return operational ? <OperationalPage /> : <App />
}
