// Pure selector over an already-produced pack() result — doesn't call
// pack() itself, since the caller must call it exactly once per package and
// reuse the result for installSize too (via packResult.tgzPath).
export function packedSize(packResult) {
  const { packedSize: packed, unpackedSize, error } = packResult;
  return { packedSize: packed, unpackedSize, error };
}
