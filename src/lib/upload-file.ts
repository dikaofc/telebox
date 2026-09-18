/**
 * Duck-typing for the uploaded chunk field.
 *
 * The upload route previously used `chunk instanceof File`. That check is
 * fragile: FormData implementations across runtimes (undici versions,
 * workerd, host-level polyfills) do not guarantee instances of the handler's
 * global `File`, and when the check fails it rejects every chunk with a
 * generic error. Every real File/Blob satisfies the structural checks below,
 * and a non-file value cannot appear under a form field with those
 * properties, so this is safe and strictly more robust.
 */
export function isFileLike(value: unknown): value is File {
  if (typeof value !== "object" || value === null) return false;
  const v = value as { size?: unknown; arrayBuffer?: unknown; stream?: unknown };
  return (
    typeof v.size === "number" &&
    typeof v.arrayBuffer === "function" &&
    typeof v.stream === "function"
  );
}
