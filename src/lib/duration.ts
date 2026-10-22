function minuteText(minutes: bigint): string {
  const hours = minutes / 60n, rest = minutes % 60n
  return hours ? `${hours} t${rest ? ` ${rest} min` : ''}` : `${rest} min`
}

// Presentation only. Call with the aggregate, never sum formatted row minutes.
export function formatDuration(milliseconds: number): string {
  if (!Number.isFinite(milliseconds)) throw new Error('Ugyldig varighet.')
  return minuteText(BigInt(Math.floor(Math.max(0, milliseconds) / 60000)))
}
export function formatMicrosecondDuration(microseconds: bigint): string {
  return minuteText((microseconds > 0n ? microseconds : 0n) / 60000000n)
}
