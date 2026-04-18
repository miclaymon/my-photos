/**
 * S3-compatible storage client (RustFS).
 *
 * Credentials and endpoint are read from environment variables:
 *   STORAGE_ENDPOINT        — e.g. http://192.168.1.250:6969
 *   STORAGE_ACCESS_KEY_ID   — access key
 *   STORAGE_SECRET_ACCESS_KEY — secret key
 *   STORAGE_BUCKET_NAME     — bucket to use (default: photos)
 *   STORAGE_REGION          — region (default: us-east-1)
 */
import {
  S3Client,
  HeadBucketCommand,
  CreateBucketCommand,
  ListObjectsV2Command,
} from '@aws-sdk/client-s3'

function getStorageConfig() {
  const endpoint  = process.env.STORAGE_ENDPOINT
  const accessKey = process.env.STORAGE_ACCESS_KEY_ID
  const secretKey = process.env.STORAGE_SECRET_ACCESS_KEY
  const region    = process.env.STORAGE_REGION ?? 'us-east-1'
  const bucket    = process.env.STORAGE_BUCKET_NAME ?? 'photos'

  if (!endpoint || !accessKey || !secretKey) {
    throw new Error(
      'Missing storage config: STORAGE_ENDPOINT, STORAGE_ACCESS_KEY_ID, STORAGE_SECRET_ACCESS_KEY must all be set',
    )
  }

  return { endpoint, accessKey, secretKey, region, bucket }
}

let _client: S3Client | null = null

export function getStorageClient(): S3Client {
  if (_client) return _client
  const { endpoint, accessKey, secretKey, region } = getStorageConfig()

  _client = new S3Client({
    endpoint,
    region,
    credentials: { accessKeyId: accessKey, secretAccessKey: secretKey },
    forcePathStyle: true,   // required for RustFS / MinIO
  })
  return _client
}

export function getStorageBucket(): string {
  return getStorageConfig().bucket
}

/**
 * Ensure the configured bucket exists; create it if not.
 * Call once at startup or from a health-check endpoint.
 */
export async function ensureBucketExists(): Promise<void> {
  const client = getStorageClient()
  const bucket = getStorageBucket()

  try {
    await client.send(new HeadBucketCommand({ Bucket: bucket }))
  } catch (err: unknown) {
    const code = (err as { $metadata?: { httpStatusCode?: number }; Code?: string }).Code
    const status = (err as { $metadata?: { httpStatusCode?: number } }).$metadata?.httpStatusCode
    if (code === 'NoSuchBucket' || status === 404 || status === 301) {
      await client.send(new CreateBucketCommand({ Bucket: bucket }))
    } else {
      throw err
    }
  }
}

/**
 * Quick health check: connect and list the top-level bucket.
 * Returns basic stats or throws on connection failure.
 */
export async function storageHealthCheck(): Promise<{ ok: true; bucket: string; objectCount: number }> {
  const client = getStorageClient()
  const bucket = getStorageBucket()

  await ensureBucketExists()

  const result = await client.send(new ListObjectsV2Command({ Bucket: bucket, MaxKeys: 1 }))
  return { ok: true, bucket, objectCount: result.KeyCount ?? 0 }
}
