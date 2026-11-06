/* On-demand AI tutor: a one-click suggestion + threaded chat.
   NEVER auto-fires — the LLM is only hit when a human asks. The suggestion is
   built from the local flags and sends nothing until it is clicked. */
import { useState } from 'react'

export default function TutorPanel({ onSubmit, replyState, flags = [], initialThread = [] }) {
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

  const suggestion = flags[0]
    ? { text: `Your rig shows ${flags[0]}. Ask why?`, question: `Why is my rig showing ${flags[0]}?` }
    : { text: 'Explain what my rig is doing right now.', question: 'Explain the current state of my rig.' }

  return (
    <aside className="tutor-panel">
      <h3>AI Tutor</h3>
      <button className="tutor-suggest" onClick={() => ask(suggestion.question)}>{suggestion.text}</button>
      <div className="tutor-thread">
        {thread.map((m, i) => (
          <p key={i} className={m.role === 'user' ? 'tutor-user' : 'tutor-ai'}>{m.content}</p>
        ))}
        {replyState?.reply && <p className="tutor-ai">{replyState.reply}</p>}
        {replyState?.error && <p className="tutor-error">Tutor unavailable: {replyState.error}</p>}
      </div>
      <form onSubmit={(e) => { e.preventDefault(); ask(input) }}>
        <input value={input} onChange={(e) => setInput(e.target.value)} placeholder="Ask about your rig…" aria-label="Ask the tutor" />
        <button type="submit">Send</button>
      </form>
    </aside>
  )
}
