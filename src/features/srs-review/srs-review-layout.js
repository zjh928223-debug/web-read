export function calculateSingleLineFontSize(options = {}) {
  const availableWidth = Number(options.availableWidth)
  const naturalWidth = Number(options.naturalWidth)
  const currentFontSize = Number(options.currentFontSize)
  const minimumFontSize = Math.max(12, Number(options.minimumFontSize) || 22)
  if (
    !Number.isFinite(availableWidth)
    || !Number.isFinite(naturalWidth)
    || !Number.isFinite(currentFontSize)
    || availableWidth <= 0
    || naturalWidth <= availableWidth
  ) return null
  return Math.max(
    minimumFontSize,
    Math.floor(currentFontSize * availableWidth / naturalWidth * 0.98),
  )
}
