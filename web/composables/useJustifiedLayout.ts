export interface JustifiableItem {
  id: string
  aspectRatio: number
}

export interface JustifiedRow<T extends JustifiableItem> {
  items: T[]
  widths: number[]
  height: number
}

/**
 * Pure function: pack items into justified rows.
 * Each row fills containerWidth exactly; the last (partial) row uses targetRowHeight.
 */
export function computeJustifiedLayout<T extends JustifiableItem>(
  items: ReadonlyArray<T>,
  containerWidth: number,
  targetRowHeight = 220,
  gap = 3,
): JustifiedRow<T>[] {
  if (!items.length || containerWidth <= 0) return []

  const rows: JustifiedRow<T>[] = []
  let rowItems: T[] = []
  let rowAspectSum = 0

  const finalizeRow = (partial: boolean) => {
    if (!rowItems.length) return
    const n = rowItems.length
    const height = partial
      ? targetRowHeight
      : (containerWidth - (n - 1) * gap) / rowAspectSum

    const rawWidths = rowItems.map(item => item.aspectRatio * height)
    // Integer widths — fix rounding drift on the last item
    const widths = rawWidths.map(w => Math.floor(w))
    const used = widths.reduce((s, w) => s + w, 0) + (n - 1) * gap
    widths[n - 1] += containerWidth - used  // absorb rounding remainder
    if (partial) widths[n - 1] = Math.floor(rawWidths[n - 1]) // last row: no stretching

    rows.push({ items: rowItems, widths, height: Math.round(height) })
    rowItems = []
    rowAspectSum = 0
  }

  for (const item of items) {
    rowItems.push(item)
    rowAspectSum += item.aspectRatio

    const projectedWidth = rowAspectSum * targetRowHeight + (rowItems.length - 1) * gap
    if (projectedWidth >= containerWidth) {
      finalizeRow(false)
    }
  }
  finalizeRow(true) // remaining items

  return rows
}

/**
 * Reactive composable wrapping computeJustifiedLayout.
 */
export function useJustifiedLayout<T extends JustifiableItem>(
  items: Ref<ReadonlyArray<T>>,
  containerWidth: Ref<number>,
  targetRowHeight: Ref<number> = ref(220),
  gap: Ref<number> = ref(3),
) {
  const rows = computed(() =>
    computeJustifiedLayout(items.value, containerWidth.value, targetRowHeight.value, gap.value),
  )
  return { rows }
}
