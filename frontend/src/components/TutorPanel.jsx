/* On-demand AI tutor: "Ask the Tutor" button + threaded chat.
   NEVER auto-fires — the LLM is only hit when a human asks. */
import { useState } from 'react'

export default function TutorPanel({ onSubmit, replyState, initialThread = [] }) {
  const [input, setInput] = useState('')
  const [thread, setThread] = useState(() => initialThread)

  const ask = async (question) => {
    if (!question.trim()) return
    const userMsg = { role: 'user', content: question.trim() }
    const next = [...thread, userMsg]
    setThread(next)
    setInput('')
    await onSubmit({ messages: next })
  }

  return (
    <aside className="tutor-panel">
      <h3>AI Tutor</h3>
      <button className="btn-primary" onClick={() => ask('Explain the current state of my rig.')}>
        Ask the Tutor
      </button>
      <div className="tutor-thread">
        {thread.map((m, i) => (
          <p key={i} className={m.role === 'user' ? 'tutor-user' : 'tutor-ai'}>{m.content}</p>
        ))}
        {replyState?.reply && <p className="tutor-ai">{replyState.reply}</p>}
        {replyState?.error && <p className="tutor-error">Tutor unavailable: {replyState.error}</p>}
      </div>
      <form onSubmit={(e) => { e.preventDefault(); ask(input) }}>
        <input value={input} onChange={(e) => setInput(e.target.value)} placeholder="Ask about your rig…" />
        <button type="submit">Send</button>
      </form>
    </aside>
  )
}