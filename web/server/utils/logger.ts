/**
 * Application logger.
 *
 * Wraps consola (bundled with Nitro) with a consistent tag so all app-level
 * log lines are distinguishable from framework noise.
 *
 *   import { logger } from '~/server/utils/logger'
 *   logger.info('Upload complete', { mediaId, objectKey })
 *   logger.error('Storage error', err)
 */
import { consola } from 'consola'

export const logger = consola.withTag('my-photos')
