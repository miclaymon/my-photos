/**
 * Binary upload proxy — fetches a presigned S3 URL from FastAPI then streams
 * the file body directly to S3 (bypassing FastAPI for the binary data).
 *
 * Why not proxy to FastAPI directly: the CachyOS 6.19 kernel silently drops
 * TCP sends ≥ ~4050 bytes on the loopback interface.  Sending a multi-MB file
 * body from undici to uvicorn over loopback triggers this bug (UND_ERR_SOCKET).
 *
 * Fix: split the work so that only a tiny JSON call goes over loopback
 * (GET /presign-upload → FastAPI), while the large binary body goes to S3 over
 * the real network interface (192.168.x.x) where the kernel bug does not apply.
 *
 * The Service Worker PUTs to /api/v1/media/upload?object_key=<key> (same-origin)
 * instead of directly to S3, which would be blocked by CORS.
 */

export default defineEventHandler(async (event) => {
  const apiUrl: string = (useRuntimeConfig().dataApiUrl as string | undefined) ?? 'http://localhost:8000'

  const session = await getUserSession(event)
  const sess    = session as Record<string, unknown>
  const accessToken = sess.accessToken as string | undefined
  if (!accessToken) throw createError({ statusCode: 401, message: 'Unauthorised' })

  const objectKey = getQuery(event).object_key as string | undefined
  if (!objectKey) throw createError({ statusCode: 400, message: 'object_key is required' })

  const contentType = getHeader(event, 'content-type') ?? 'application/octet-stream'

  // Step 1 — get a presigned S3 PUT URL from FastAPI.
  // This is a tiny JSON request over loopback — well under the ~4050-byte limit.
  let presignedUrl: string
  try {
    const presignRes = await fetch(
      `${apiUrl}/api/v1/media/presign-upload?object_key=${encodeURIComponent(objectKey)}&content_type=${encodeURIComponent(contentType)}`,
      { headers: { Authorization: `Bearer ${accessToken}` } },
    )
    if (!presignRes.ok) {
      const detail = await presignRes.text().catch(() => '')
      throw new Error(`${presignRes.status}${detail ? ': ' + detail : ''}`)
    }
    const presignData = await presignRes.json() as { url: string }
    presignedUrl = presignData.url
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err)
    console.error('[upload proxy] presign failed:', msg)
    throw createError({ statusCode: 502, message: `Presign failed: ${msg}` })
  }

  // Step 2 — read the binary body from the incoming request.
  const body = await readRawBody(event, false)
  if (!body || body.length === 0) throw createError({ statusCode: 400, message: 'Empty body' })

  // Step 3 — PUT directly to S3 via the presigned URL.
  // S3 is at 192.168.x.x (real network interface) — no loopback kernel bug.
  const s3Res = await fetch(presignedUrl, {
    method:  'PUT',
    body,
    headers: { 'content-type': contentType },
  })

  if (!s3Res.ok) {
    const detail = await s3Res.text().catch(() => '')
    console.error('[upload proxy] S3 PUT failed:', s3Res.status, detail)
    throw createError({ statusCode: 502, message: `S3 upload failed (${s3Res.status})${detail ? ': ' + detail : ''}` })
  }

  return {}
})
