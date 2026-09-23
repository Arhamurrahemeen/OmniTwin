import { useCallback, useEffect, useRef, useState } from 'react'
import { getRoster, importRoster } from '../api'
import RegisterDevice from './RegisterDevice'

export default function RosterPanel() {
  const [students, setStudents]   = useState([])
  const [error, setError]         = useState('')
  const [msg, setMsg]             = useState('')
  const [creatingFor, setCreatingFor] = useState(null)
  const [registeringHw, setRegisteringHw] = useState(false)
  const fileRef = useRef(null)

  const load = useCallback(() => {
    getRoster()
      .then(setStudents)
      .catch(() => setError('Could not load roster'))
  }, [])

  useEffect(() => { load() }, [load])

  const onImport = async (e) => {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file) return
    setError('')
    setMsg('')
    try {
      const res = await importRoster(file)
      setMsg(`Imported ${res.created} new student${res.created === 1 ? '' : 's'}, ${res.skipped} skipped.`)
      load()
    } catch {
      setError('CSV import failed — check the format (name,email).')
    }
  }

  return (
    <aside className="panel roster-panel">
      <div className="panel-title-row">
        <p className="panel-title">Roster</p>
        <div className="roster-actions">
          <button className="add-btn" title="Register hardware kit" onClick={() => setRegisteringHw(true)}>+</button>
          <button className="add-btn" title="Import student list (CSV)" onClick={() => fileRef.current?.click()}>⬆</button>
        </div>
        <input
          ref={fileRef}
          type="file"
          accept=".csv"
          style={{ display: 'none' }}
          onChange={onImport}
        />
      </div>

      {msg && <p className="muted ok-text">{msg}</p>}
      {error && <p className="muted roster-error">{error}</p>}

      {students.length === 0 && !error && (
        <p className="muted">No students — import a CSV (name,email).</p>
      )}

      {students.map(s => (
        <div
          key={s.student_id}
          className={`roster-row${s.remaining > 0 ? ' roster-row--free' : ''}`}
          role={s.remaining > 0 ? 'button' : undefined}
          tabIndex={s.remaining > 0 ? 0 : undefined}
          onClick={s.remaining > 0 ? () => setCreatingFor(s.student_id) : undefined}
          onKeyDown={s.remaining > 0 ? (e) => e.key === 'Enter' && setCreatingFor(s.student_id) : undefined}
          title={s.remaining > 0 ? 'Create a project for this student' : undefined}
        >
          <span className="roster-name">{s.name}</span>
          <span className="roster-email">{s.email}</span>
          <span className="roster-quota">1 project · {s.remaining > 0 ? `${s.remaining} slot${s.remaining === 1 ? '' : 's'} remaining` : 'quota reached'}</span>
        </div>
      ))}

      {creatingFor && (
        <RegisterDevice
          mode="project"
          initialOwner={creatingFor}
          onCreated={() => { setCreatingFor(null); load() }}
          onClose={() => setCreatingFor(null)}
        />
      )}

      {registeringHw && (
        <RegisterDevice
          mode="hardware"
          onCreated={() => { setRegisteringHw(false); load() }}
          onClose={() => setRegisteringHw(false)}
        />
      )}
    </aside>
  )
}