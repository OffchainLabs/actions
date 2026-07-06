/**
 * Pure, no-I/O selector over an already-produced `pack()` result (see
 * `pack.mjs`) — extracts just the packed/unpacked size numbers.
 *
 * This does NOT call `pack()` itself: the caller (Phase 3's orchestrator) is
 * expected to call `pack()` exactly ONCE per package and pass the same
 * result both here and to `installSize.mjs` (via `packResult.tgzPath`), so a
 * package is never packed twice just to compute two different metrics from
 * it.
 *
 * @param {{ packedSize: number|null, unpackedSize: number|null, tgzPath: string|null, error: string|null }} packResult
 *   - the object returned by `pack()`
 * @returns {{ packedSize: number|null, unpackedSize: number|null, error: string|null }}
 */
export function packedSize(packResult) {
  const { packedSize: packed, unpackedSize, error } = packResult;
  return { packedSize: packed, unpackedSize, error };
}
