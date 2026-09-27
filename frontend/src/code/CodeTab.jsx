// CodeTab.jsx — Project folder intake, file tree, editor, codeFlags
import { useState, useCallback, useEffect, useMemo } from 'react'
import { parseProject, findingsToLayout } from './parser'
import { codeFlags } from './codeFlags'

const EXTENSIONS = ['.c', '.h', '.cpp', '.ino', '.cc', '.cxx']

export default function CodeTab({ onProjectParsed, onLayoutGenerated, registry }) {
  const [dirHandle, setDirHandle] = useState(null)
  const [files, setFiles] = useState([])           // [{ name, path, content }]
  const [selectedFile, setSelectedFile] = useState(null)
  const [findings, setFindings] = useState(null)
  const [flags, setFlags] = useState([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)

  // Request directory access
  const pickFolder = useCallback(async () => {
    try {
      setLoading(true)
      setError(null)
      const handle = await window.showDirectoryPicker({ mode: 'read' })
      setDirHandle(handle)
      const allFiles = await readProjectFiles(handle)
      setFiles(allFiles)
      if (allFiles.length > 0) setSelectedFile(allFiles[0])
    } catch (err) {
      if (err.name !== 'AbortError') setError(err.message)
    } finally {
      setLoading(false)
    }
  }, [])

  // Recursively read project files
  async function readProjectFiles(handle, prefix = '') {
    const results = []
    for await (const [name, entry] of handle.entries()) {
      const fullPath = prefix ? `${prefix}/${name}` : name
      if (entry.kind === 'file') {
        const ext = '.' + name.split('.').pop().toLowerCase()
        if (EXTENSIONS.includes(ext)) {
          const file = await entry.getFile()
          const content = await file.text()
          results.push({ name: fullPath, path: fullPath, content })
        }
      } else if (entry.kind === 'directory') {
        const subFiles = await readProjectFiles(entry, fullPath)
        results.push(...subFiles)
      }
    }
    return results
  }

  // Parse whenever files change
  useEffect(() => {
    if (files.length === 0) {
      setFindings(null)
      setFlags([])
      return
    }
    const parsed = parseProject(files)
    setFindings(parsed)
    const fl = codeFlags(files)
    setFlags(fl)
    onProjectParsed?.(parsed, fl)

    // Generate layout from findings
    const layout = findingsToLayout(parsed, registry)
    onLayoutGenerated?.(layout)
  }, [files, registry, onProjectParsed, onLayoutGenerated])

  // File tree
  const fileTree = useMemo(() => {
    const root = { name: '', children: {}, isFile: false }
    for (const f of files) {
      const parts = f.path.split('/')
      let node = root
      for (let i = 0; i < parts.length; i++) {
        const part = parts[i]
        if (!node.children[part]) {
          node.children[part] = {
            name: part,
            children: {},
            isFile: i === parts.length - 1,
            fullPath: f.path,
          }
        }
        node = node.children[part]
      }
    }
    return root
  }, [files])

  function renderTree(node, depth = 0) {
    if (node.isFile) {
      const isSelected = selectedFile?.path === node.fullPath
      return (
        <div
          key={node.fullPath}
          className={`code-file ${isSelected ? 'selected' : ''}`}
          style={{ paddingLeft: `${depth * 16 + 8}px` }}
          onClick={() => setSelectedFile(files.find(f => f.path === node.fullPath))}
          title={node.fullPath}
        >
          {node.name}
          {flags.filter(f => f.file === node.fullPath).length > 0 && (
            <span className="code-flag-count">{flags.filter(f => f.file === node.fullPath).length}</span>
          )}
        </div>
      )
    }
    return (
      <div key={node.name}>
        {depth > 0 && (
          <div className="code-dir" style={{ paddingLeft: `${depth * 16}px` }}>
            {node.name}/
          </div>
        )}
        {Object.values(node.children).sort((a, b) => (a.isFile === b.isFile ? 0 : a.isFile ? 1 : -1))
          .map(child => renderTree(child, depth + 1))}
      </div>
    )
  }

  if (!dirHandle) {
    return (
      <div className="code-tab">
        <div className="code-empty">
          <h3>Open Project Folder</h3>
          <p>Grant access to your firmware source folder (.c, .h, .ino, .cpp)</p>
          <button className="btn-primary" onClick={pickFolder} disabled={loading}>
            {loading ? 'Opening…' : 'Select Folder'}
          </button>
          {error && <p className="code-error">{error}</p>}
        </div>
      </div>
    )
  }

  return (
    <div className="code-tab">
      <div className="code-toolbar">
        <span className="code-folder">📁 {dirHandle.name}</span>
        <button className="btn-secondary" onClick={pickFolder} disabled={loading}>
          Change Folder
        </button>
        <button className="btn-secondary" onClick={() => setSelectedFile(null)}>
          Close Editor
        </button>
      </div>

      <div className="code-split">
        {/* File tree + flags sidebar */}
        <aside className="code-sidebar">
          <div className="code-tree">{renderTree(fileTree)}</div>
          {flags.length > 0 && (
            <details className="code-flags-summary" open>
              <summary>⚠️ Code Flags ({flags.length})</summary>
              <ul className="code-flags-list">
                {flags.slice(0, 20).map((f, i) => (
                  <li key={i} className={`code-flag ${f.severity}`} title={f.message}>
                    <span className="code-flag-file">{f.file}</span>
                    <span className="code-flag-line">:{f.line}</span>
                    <span className="code-flag-name"> {f.name}</span>
                  </li>
                ))}
                {flags.length > 20 && <li className="code-flag-more">…and {flags.length - 20} more</li>}
              </ul>
            </details>
          )}
        </aside>

        {/* Editor pane */}
        <section className="code-editor-pane">
          {selectedFile ? (
            <div className="code-editor-wrap">
              <div className="code-editor-header">
                <span>{selectedFile.name}</span>
                <span className="code-editor-confidence">
                  Confidence: {findings?.confidence || 'none'}
                </span>
              </div>
              <pre className="code-editor" spellCheck="false">
                <code>{selectedFile.content}</code>
              </pre>
              {flags.filter(f => f.file === selectedFile.name).length > 0 && (
                <details className="code-file-flags" open>
                  <summary>Flags in this file ({flags.filter(f => f.file === selectedFile.name).length})</summary>
                  <ul>
                    {flags.filter(f => f.file === selectedFile.name).map((f, i) => (
                      <li key={i} className={`code-flag ${f.severity}`}>
                        Line {f.line}: {f.name} — {f.message}
                        <pre className="code-flag-snippet">{f.snippet}</pre>
                      </li>
                    ))}
                  </ul>
                </details>
              )}
            </div>
          ) : (
            <div className="code-editor-empty">
              Select a file from the tree to view source
            </div>
          )}
        </section>
      </div>

      {/* Parsed findings summary */}
      {findings && (
        <details className="code-findings-summary">
          <summary>Parsed Hardware (confidence: {findings.confidence})</summary>
          <div className="code-findings-grid">
            {findings.i2c.pins && (
              <div className="code-finding-item">
                <strong>I2C Pins:</strong> SDA={findings.i2c.pins.sda}, SCL={findings.i2c.pins.scl}
                <span className="code-confidence">{findings.i2c.confidence}</span>
              </div>
            )}
            {findings.i2c.addresses.length > 0 && (
              <div className="code-finding-item">
                <strong>I2C Addresses:</strong> {findings.i2c.addresses.map(a => '0x' + a.toString(16)).join(', ')}
              </div>
            )}
            {findings.sensors.length > 0 && (
              <div className="code-finding-item">
                <strong>Sensors:</strong>
                <ul>
                  {findings.sensors.map(s => (
                    <li key={s.type + s.pin}>{s.type.toUpperCase()} on GPIO{s.pin} ({s.confidence})</li>
                  ))}
                </ul>
              </div>
            )}
            {findings.pins.length > 0 && (
              <div className="code-finding-item">
                <strong>Declared Pins:</strong>
                <ul>
                  {findings.pins.map(p => (
                    <li key={p.pin}>GPIO{p.pin} — {p.label} ({p.mode}, {p.confidence})</li>
                  ))}
                </ul>
              </div>
            )}
            {findings.libraries.length > 0 && (
              <div className="code-finding-item">
                <strong>Libraries:</strong> {findings.libraries.map(l => l.name).join(', ')}
              </div>
            )}
            {findings.serial.baud && (
              <div className="code-finding-item">
                <strong>Serial:</strong> {findings.serial.baud} baud
              </div>
            )}
          </div>
        </details>
      )}
    </div>
  )
}