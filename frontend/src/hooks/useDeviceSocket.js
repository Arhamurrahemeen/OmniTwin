import { useEffect, useRef, useState } from 'react'

const MAX_MESSAGES = 200
const RECONNECT_DELAY = 3000

export function useDeviceSocket(deviceId) {
  const [messages, setMessages] = useState([])
  const [connected, setConnected] = useState(false)
  const wsRef = useRef(null)
  const timerRef = useRef(null)

  useEffect(() => {
    if (!deviceId) {
      setMessages([])
      setConnected(false)
      return
    }

    let cancelled = false

    function connect() {
      if (cancelled) return
      const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:'
      const ws = new WebSocket(`${protocol}//${window.location.host}/ws/${deviceId}`)
      wsRef.current = ws

      ws.onopen = () => { if (!cancelled) setConnected(true) }

      ws.onmessage = (event) => {
        if (cancelled) return
        try {
          const data = JSON.parse(event.data)
          setMessages(prev => {
            const next = [...prev, data]
            return next.length > MAX_MESSAGES ? next.slice(-MAX_MESSAGES) : next
          })
        } catch {}
      }

      ws.onclose = () => {
        if (cancelled) return
        setConnected(false)
        timerRef.current = setTimeout(connect, RECONNECT_DELAY)
      }

      ws.onerror = () => {
        ws.close()
      }
    }

    setMessages([])
    connect()

    return () => {
      cancelled = true
      clearTimeout(timerRef.current)
      wsRef.current?.close()
      wsRef.current = null
      setConnected(false)
    }
  }, [deviceId])

  return { messages, connected }
}
