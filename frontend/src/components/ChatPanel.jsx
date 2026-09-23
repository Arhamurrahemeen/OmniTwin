import { useRef, useState } from 'react'
import { postChat } from '../api'

export default function ChatPanel({ device }) {
  const [open, setOpen] = useState(false)
  const [messages, setMessages] = useState([])
  const [input, setInput] = useState('')
  const [loading, setLoading] = useState(false)
  const bottomRef = useRef(null)

  const send = async () => {
    const text = input.trim()
    if (!text || loading) return

    const userMsg = { role: 'user', text }
    setMessages(prev => [...prev, userMsg])
    setInput('')
    setLoading(true)

    try {
      const data = await postChat(device?.device_id ?? 'unknown', text)
      setMessages(prev => [...prev, { role: 'ai', text: data.reply ?? 'No response.' }])
    } catch {
      setMessages(prev => [...prev, { role: 'ai', text: 'Connection error. Please try again.' }])
    } finally {
      setLoading(false)
      setTimeout(() => bottomRef.current?.scrollIntoView({ behavior: 'smooth' }), 50)
    }
  }

  const onKey = (e) => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send() }
  }

  return (
    <>
      <button
        className="chat-fab"
        onClick={() => setOpen(o => !o)}
        title="TwinLab Assistant"
      >
        {open ? '✕' : '💬'}
      </button>

      {open && (
        <div className="chat-panel">
          <div className="chat-header">
            <span className="chat-title">TwinLab</span>
            {device && <span className="chat-device">{device.name}</span>}
            <span className="chat-sub">Urdu / English</span>
          </div>

          <div className="chat-messages">
            {messages.length === 0 && (
              <p className="chat-empty">
                Ask about your device — in Urdu or English.<br />
                <em>e.g. "kya masla hai?" or "What is wrong?"</em>
              </p>
            )}
            {messages.map((m, i) => (
              <div key={i} className={`chat-bubble chat-bubble--${m.role}`}>
                {m.text}
              </div>
            ))}
            {loading && (
              <div className="chat-bubble chat-bubble--ai chat-bubble--loading">
                <span className="dot" /><span className="dot" /><span className="dot" />
              </div>
            )}
            <div ref={bottomRef} />
          </div>

          <div className="chat-input-row">
            <textarea
              className="chat-input"
              rows={2}
              placeholder="Type in Urdu or English…"
              value={input}
              onChange={e => setInput(e.target.value)}
              onKeyDown={onKey}
            />
            <button className="chat-send" onClick={send} disabled={loading || !input.trim()}>
              ➤
            </button>
          </div>
        </div>
      )}
    </>
  )
}
