/**
 * POST /api/v1/media/upload-url
 *
 * Generates a presigned S3 PUT URL so the client can upload directly to
 * RustFS without routing binary data through this server.
 *
 * Request body:
 *   { filename: string, contentType: string, libraryIds: string[] }
 *
 * Response:
 *   { uploadUrl: string, objectKey: string }
 */
import { PutObjectCommand } from '@aws-sdk/client-s3'
import { getSignedUrl } from '@aws-sdk/s3-request-presigner'
import { getStorageClient, getStorageBucket, ensureBucketExists } from '~/server/utils/storage'
import { logger } from '~/server/utils/logger'

export default defineEventHandler(async (event) => {
  const session = await getUserSession(event)
  if (!session?.user) throw createError({ statusCode: 401, message: 'Unauthorised' })

  const body = await readBody<{ filename: string; contentType: string; libraryIds: string[] }>(event)
  if (!body.filename || !body.contentType) {
    throw createError({ statusCode: 400, message: 'filename and contentType are required' })
  }

  const userId   = String((session.user as { id?: string | number }).id ?? 'unknown')
  const uuid     = crypto.randomUUID()
  const safeName = body.filename.replace(/[^a-zA-Z0-9._\-]/g, '_')
  const objectKey = `${userId}/${uuid}/${safeName}`

  logger.info(`upload-url requested`, { userId, filename: body.filename, contentType: body.contentType, objectKey })

  try {
    await ensureBucketExists()

    const client = getStorageClient()
    const bucket = getStorageBucket()

    const command = new PutObjectCommand({
      Bucket:      bucket,
      Key:         objectKey,
      ContentType: body.contentType,
    })

    // URL expires in 15 minutes — enough for any reasonable upload
    const uploadUrl = await getSignedUrl(client, command, { expiresIn: 900 })

    logger.success(`upload-url issued`, { objectKey })
    return { uploadUrl, objectKey }
  } catch (err) {
    logger.error(`upload-url failed`, { objectKey, err })
    throw createError({ statusCode: 502, message: 'Storage error: could not generate upload URL' })
  }
})
