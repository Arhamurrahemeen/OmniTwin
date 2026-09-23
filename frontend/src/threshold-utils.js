export function updateThreshold(prev, sensor, bound, raw) {
  return { ...prev, [sensor]: { ...prev[sensor], [bound]: raw } }
}

export function buildThresholds(sensorList, thresholds) {
  const result = {}
  for (const sensor of sensorList) {
    const t = thresholds[sensor] ?? {}
    const minRaw = t.min !== '' && t.min !== undefined ? parseFloat(t.min) : null
    const maxRaw = t.max !== '' && t.max !== undefined ? parseFloat(t.max) : null
    const minVal = (minRaw !== null && !isNaN(minRaw)) ? minRaw : null
    const maxVal = (maxRaw !== null && !isNaN(maxRaw)) ? maxRaw : null
    if (minVal !== null || maxVal !== null) {
      result[sensor] = { min: minVal, max: maxVal }
    }
  }
  return result
}
