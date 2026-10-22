// Absolute ISO timestamps keep their six-digit fraction until after aggregation.
// Date.parse supplies the millisecond epoch (including offset/pre-1970 dates);
// the remaining three digits restore the microseconds it truncates.
export function timestampMicroseconds(value: string): bigint {
  const match = /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.(\d{1,6}))?(?:Z|[+-]\d\d:\d\d)$/.exec(value)
  const milliseconds = Date.parse(value)
  if (!match || !Number.isFinite(milliseconds)) throw new Error('Ugyldig absolutt tidspunkt.')
  return BigInt(milliseconds) * 1000n + BigInt((match[1] ?? '').padEnd(6, '0').slice(3))
}

export function clockMicroseconds(milliseconds: number): bigint {
  if (!Number.isFinite(milliseconds)) throw new Error('Ugyldig klokke.')
  const whole = Math.floor(milliseconds)
  return BigInt(whole) * 1000n + BigInt(Math.floor((milliseconds - whole) * 1000))
}
// The existing server clock is anchored to Date.parse(server_time). Restore
// that anchor's sub-millisecond remainder without changing its monotonic tick.
export function serverClockMicroseconds(milliseconds: number, serverTime?: string): bigint {
  return clockMicroseconds(milliseconds) + (serverTime
    ? timestampMicroseconds(serverTime) - BigInt(Date.parse(serverTime)) * 1000n : 0n)
}
export const minMicroseconds = (...times: bigint[]) => times.reduce((a, b) => a < b ? a : b)
export const positiveMicroseconds = (duration: bigint) => duration > 0n ? duration : 0n

// Existing duration APIs expose whole-millisecond Numbers. Floor ONCE after
// summing exact microseconds; never round a duration up across a minute boundary.
export function durationMilliseconds(microseconds: bigint): number {
  const whole = positiveMicroseconds(microseconds) / 1000n
  if (whole > BigInt(Number.MAX_SAFE_INTEGER)) throw new Error('Varigheten er for stor.')
  return Number(whole)
}

export function segmentMicroseconds(segment: { started_at: string; ended_at: string | null }, end: bigint, from?: bigint): bigint {
  const start = timestampMicroseconds(segment.started_at)
  return positiveMicroseconds(minMicroseconds(end, segment.ended_at ? timestampMicroseconds(segment.ended_at) : end)
    - (from !== undefined && from > start ? from : start))
}
