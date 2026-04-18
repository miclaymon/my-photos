/**
 * Downloads an image from the configured S3-compatible bucket and returns a Buffer.
 * Uses the S3 GetObject API directly — no presigned URLs needed for server-side access.
 */
import { GetObjectCommand } from '@aws-sdk/client-s3'
import { getStorageClient, getStorageBucket } from '~/server/utils/storage'

export async function loadImageBuffer(objectKey: string): Promise<Buffer> {
  const client = getStorageClient()
  const bucket = getStorageBucket()

  const res = await client.send(new GetObjectCommand({ Bucket: bucket, Key: objectKey }))

  const chunks: Uint8Array[] = []
  for await (const chunk of res.Body as AsyncIterable<Uint8Array>) {
    chunks.push(chunk)
  }
  return Buffer.concat(chunks)
}
