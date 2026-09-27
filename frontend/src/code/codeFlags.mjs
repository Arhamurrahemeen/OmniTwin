// codeFlags.mjs — zero-LLM static analysis of student source
// Same philosophy as anomalyFlags(): cheap local checks first

const CHECKS = [
  // Blocking calls in loop/task
  {
    id: 'blocking-delay',
    name: 'Blocking delay() in loop',
    pattern: /\bdelay\s*\(\s*\d+\s*\)/g,
    contextLines: 2,
    severity: 'warn',
    message: 'delay() blocks the entire loop. Use millis() non-blocking pattern or RTOS task delay.',
  },
  {
    id: 'blocking-delaymicroseconds',
    name: 'Blocking delayMicroseconds() in loop',
    pattern: /\bdelayMicroseconds\s*\(\s*\d+\s*\)/g,
    contextLines: 2,
    severity: 'info',
    message: 'delayMicroseconds() blocks. OK for very short timing, but consider hardware timers.',
  },

  // printf format mismatches
  {
    id: 'printf-format-mismatch',
    name: 'printf/scanf format specifier mismatch',
    pattern: /(?:Serial\.|printf|sprintf|snprintf|fprintf)\s*\([^)]*%[dfsxX][^)]*\)/g,
    contextLines: 3,
    severity: 'warn',
    message: 'Check format specifiers match argument types (%d=int, %f=float, %s=string). Mismatch = UB.',
  },

  // Missing bounds checks on array/index
  {
    id: 'array-bounds',
    name: 'Array/buffer access without bounds check',
    pattern: /\[\s*\w+\s*\]/g,
    contextLines: 3,
    severity: 'info',
    message: 'Array index used without visible bounds check. Ensure index < array size.',
  },

  // I2C return value ignored
  {
    id: 'i2c-ignored-return',
    name: 'Wire.endTransmission() return value ignored',
    pattern: /Wire\.endTransmission\s*\(\s*\)/g,
    contextLines: 2,
    severity: 'warn',
    message: 'Wire.endTransmission() returns 0=success, !=0=NAK/error. Ignoring it misses bus faults.',
  },
  {
    id: 'i2c-requestfrom-ignored',
    name: 'Wire.requestFrom() return value ignored',
    pattern: /Wire\.requestFrom\s*\([^)]+\)\s*;/g,
    contextLines: 2,
    severity: 'warn',
    message: 'Wire.requestFrom() returns bytes received. Check it before reading.',
  },

  // Magic numbers
  {
    id: 'magic-number',
    name: 'Hardcoded magic number (candidate for const)',
    pattern: /\b(?:0x[0-9a-fA-F]{2,}|\d{3,})\b/g,
    contextLines: 2,
    severity: 'info',
    message: 'Literal numeric constant. Consider named #define or const for clarity.',
    filter: (match, line) => {
      // Filter out common non-magic: 0, 1, 2, 10, 100, 1000, 115200, 9600, pin numbers < 40
      const n = parseInt(match, match.startsWith('0x') ? 16 : 10)
      if ([0,1,2,10,100,1000,9600,115200,57600,38400,19200,14400,4800,2400,1200].includes(n)) return false
      if (n > 0 && n < 40 && /pinMode|digitalWrite|analogWrite|attach|begin\s*\(/.test(line)) return false // likely pin number
      return true
    }
  },

  // Unchecked malloc (AVR/ESP)
  {
    id: 'unchecked-malloc',
    name: 'malloc/calloc/realloc without NULL check',
    pattern: /\b(?:malloc|calloc|realloc)\s*\([^)]*\)\s*(?![^;]*==\s*NULL)/g,
    contextLines: 3,
    severity: 'warn',
    message: 'Dynamic allocation without NULL check. On AVR/ESP32, heap exhaustion crashes silently.',
  },

  // String literal in loop (heap fragmentation)
  {
    id: 'string-in-loop',
    name: 'String object construction in loop',
    pattern: /\bString\s*\(/g,
    contextLines: 2,
    severity: 'info',
    message: 'String allocation in loop fragments heap. Use char buffers or reserve().',
  },

  // Missing volatile for ISR-shared vars
  {
    id: 'missing-volatile',
    name: 'ISR-shared variable missing volatile',
    pattern: /\b(?:int|long|float|bool|uint8_t|uint16_t|uint32_t)\s+\w+\s*[=;]/g,
    contextLines: 3,
    severity: 'info',
    message: 'Variable shared with ISR must be volatile. Check if this var is modified in interrupt.',
    filter: (match, _line, _source) => {
      // Heuristic: if variable name suggests ISR use
      return /(?:count|tick|flag|state|buffer|index|pos|head|tail)/i.test(match)
    }
  },

  // Recursive function without base case (stack overflow)
  {
    id: 'recursive-no-base',
    name: 'Potential infinite recursion',
    pattern: /\b(\w+)\s*\([^)]*\)\s*\{[^}]*\b\1\s*\(/g,
    contextLines: 5,
    severity: 'warn',
    message: 'Function calls itself unconditionally. Ensure base case exists.',
  },

  // Division by variable without zero check
  {
    id: 'div-by-var',
    name: 'Division by variable without zero check',
    pattern: /\/\s*\w+/g,
    contextLines: 2,
    severity: 'info',
    message: 'Division by variable. Ensure divisor cannot be zero.',
  },
]

function getContextLines(source, matchIndex, contextLines = 2) {
  const lines = source.substring(0, matchIndex).split('\n')
  const lineNum = lines.length
  const allLines = source.split('\n')
  const start = Math.max(0, lineNum - contextLines - 1)
  const end = Math.min(allLines.length, lineNum + contextLines)
  return {
    line: lineNum,
    snippet: allLines.slice(start, end).join('\n'),
  }
}

export function codeFlags(files) {
  // files: [{ name, content }]
  const allFlags = []

  for (const file of files) {
    const source = file.content
    for (const check of CHECKS) {
      const regex = new RegExp(check.pattern.source, check.pattern.flags)
      let match
      while ((match = regex.exec(source))) {
        if (check.filter && !check.filter(match[0], source.split('\n')[getContextLines(source, match.index).line - 1] || '', source)) {
          continue
        }
        const ctx = getContextLines(source, match.index, check.contextLines)
        allFlags.push({
          file: file.name,
          line: ctx.line,
          check: check.id,
          name: check.name,
          severity: check.severity,
          message: check.message,
          snippet: ctx.snippet.trim(),
          match: match[0],
        })
      }
    }
  }

  // Sort: errors/warnings first, then by file/line
  return allFlags.sort((a, b) => {
    const sevOrder = { error: 0, warn: 1, info: 2 }
    const sevDiff = sevOrder[a.severity] - sevOrder[b.severity]
    if (sevDiff !== 0) return sevDiff
    if (a.file !== b.file) return a.file.localeCompare(b.file)
    return a.line - b.line
  })
}

// Format for tutor context
export function formatCodeFlagsForTutor(flags) {
  if (!flags.length) return 'No static code issues found.'
  return flags.map(f =>
    `[${f.severity.toUpperCase()}] ${f.file}:${f.line} — ${f.name}: ${f.message}`
  ).join('\n')
}