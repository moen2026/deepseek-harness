/**
 * Volcengine OpenAPI control-plane client for the video-volc provider. It
 * registers a public reference-image URL as a private Seedance asset entry
 * (grouped, reviewed, and addressable as `asset://<id>`) so generations can
 * reference reviewed material. Requests authenticate with the standard
 * Volcengine HMAC-SHA256 request signature over an AK/SK pair read from
 * *environment variable names* at call time; neither credential enters
 * configuration files or logs.
 * @module @deepseek-ai/dsh-video-volc/asset
 */

import { createHash, createHmac } from 'node:crypto'
import { VideoError } from '@deepseek-ai/dsh-video'
import { describeMessage, isRecord, sleep, toProviderFailure } from './internal.ts'

/** Base URL of the public Volcengine OpenAPI control plane. */
export const VOLC_DEFAULT_ASSET_BASE_URL = 'https://ark.cn-beijing.volcengineapi.com'

/** Volcengine OpenAPI version of the Ark asset-management actions. */
export const VOLC_ASSET_API_VERSION = '2024-01-01'

/** Asset status that finishes processing successfully. */
const ASSET_DONE_STATUS = 'Active'

/** Asset status that finishes processing with a failure. */
const ASSET_FAILED_STATUS = 'Failed'

/** Group type holding AIGC-generated assets. */
const ASSET_GROUP_TYPE = 'AIGC'

/** Deployment-supplied control-plane description. */
export interface VolcAssetClientConfig {
  /** Control-plane base URL; the action queries are appended. Defaults to the public plane. */
  readonly assetBaseURL?: string
  /** Signing region. Defaults to `cn-beijing`. */
  readonly region?: string
  /** Project name the asset entries are filed under. */
  readonly project: string
  /** Name of the environment variable holding the access key; never the key itself. */
  readonly assetAuthEnv: string
  /** Name of the environment variable holding the secret key; never the key itself. */
  readonly assetSecretEnv: string
  /** Asset group the provider files references into; omitted groups are created on first use. */
  readonly groupId?: string
  /** Delay between asset-status polls in milliseconds. */
  readonly pollIntervalMs: number
  /** Overall timeout covering one reference's registration in milliseconds. */
  readonly timeoutMs: number
}

/** Registers reference images as private Seedance assets. */
export interface VolcAssetClient {
  /**
   * Register one public image URL as a private asset and return its
   * `asset://` reference, ready for a generation request.
   */
  assetize(url: string, signal?: AbortSignal): Promise<string>
}

/**
 * Build an {@link VolcAssetClient} over the public control plane.
 * @param config - the control-plane description.
 * @returns a client that registers public reference images as private assets.
 */
export function createVolcAssetClient(config: VolcAssetClientConfig): VolcAssetClient {
  const baseURL = (config.assetBaseURL ?? VOLC_DEFAULT_ASSET_BASE_URL).replace(/\/+$/, '')
  const region = config.region ?? 'cn-beijing'
  const knownGroupId = config.groupId
  return {
    async assetize(url, signal) {
      const accessKey = process.env[config.assetAuthEnv]
      const secretKey = process.env[config.assetSecretEnv]
      if (accessKey === undefined || accessKey.trim() === '' || secretKey === undefined || secretKey.trim() === '') {
        throw new VideoError(
          `video-volc: environment variables "${config.assetAuthEnv}" and "${config.assetSecretEnv}" must both be set`,
          'VIDEO_PROVIDER_FAILED',
        )
      }
      const timeoutSignal = AbortSignal.timeout(config.timeoutMs)
      const composed = signal === undefined ? timeoutSignal : AbortSignal.any([timeoutSignal, signal])
      const groupId = knownGroupId ?? await createGroup(baseURL, region, config, accessKey, secretKey, composed, timeoutSignal)
      const assetId = await createAsset(baseURL, region, config, accessKey, secretKey, groupId, url, composed, timeoutSignal)
      await pollAsset(baseURL, region, config, accessKey, secretKey, assetId, composed, timeoutSignal)
      return `asset://${assetId}`
    },
  }
}

/** Read one Volcengine OpenAPI response, mapping its error envelope onto a typed provider failure. */
async function callAction(
  baseURL: string,
  region: string,
  action: string,
  body: Record<string, unknown>,
  accessKey: string,
  secretKey: string,
  signal: AbortSignal,
  timeoutSignal: AbortSignal,
): Promise<Record<string, unknown>> {
  let response: Response
  try {
    response = await fetch(`${baseURL}/?Action=${action}&Version=${VOLC_ASSET_API_VERSION}`, {
      method: 'POST',
      signal,
      headers: signedHeaders('POST', `${baseURL}/?Action=${action}&Version=${VOLC_ASSET_API_VERSION}`, body, accessKey, secretKey, region),
      body: JSON.stringify(body),
    })
  } catch (error) {
    throw toProviderFailure(error, timeoutSignal, `${action} request failed`, accessKey, secretKey)
  }
  if (!response.ok) {
    throw new VideoError(`video-volc: control-plane ${action} responded ${response.status}`, 'VIDEO_PROVIDER_FAILED')
  }
  let payload: unknown
  try {
    payload = await response.json()
  } catch (error) {
    if (error instanceof SyntaxError) {
      throw new VideoError(`video-volc: control-plane ${action} returned a non-JSON body`, 'VIDEO_PROVIDER_FAILED', { cause: error })
    }
    throw toProviderFailure(error, timeoutSignal, `${action} body read failed`, accessKey, secretKey)
  }
  if (!isRecord(payload)) {
    throw new VideoError(`video-volc: control-plane ${action} returned a non-JSON body`, 'VIDEO_PROVIDER_FAILED')
  }
  const metadata = isRecord(payload.ResponseMetadata) ? payload.ResponseMetadata : undefined
  const failure = metadata !== undefined && isRecord(metadata.Error) ? metadata.Error : undefined
  if (failure !== undefined) {
    throw new VideoError(
      `video-volc: control-plane ${action} was rejected: ${describeMessage(failure.Code)} ${describeMessage(failure.Message)}`,
      'VIDEO_PROVIDER_FAILED',
    )
  }
  return isRecord(payload.Result) ? payload.Result : payload
}

/** File the provider's reference images into one group, creating it on first use. */
async function createGroup(
  baseURL: string,
  region: string,
  config: VolcAssetClientConfig,
  accessKey: string,
  secretKey: string,
  signal: AbortSignal,
  timeoutSignal: AbortSignal,
): Promise<string> {
  const result = await callAction(baseURL, region, 'CreateAssetGroup', {
    Filter: { ProjectName: config.project },
    Name: 'dsh-video-volc',
    Type: ASSET_GROUP_TYPE,
  }, accessKey, secretKey, signal, timeoutSignal)
  const id = result.Id
  if (typeof id !== 'string' || id === '') {
    throw new VideoError('video-volc: CreateAssetGroup response carried no group id', 'VIDEO_PROVIDER_FAILED')
  }
  return id
}

/** Submit one public image URL for private-asset review and return its id. */
async function createAsset(
  baseURL: string,
  region: string,
  config: VolcAssetClientConfig,
  accessKey: string,
  secretKey: string,
  groupId: string,
  url: string,
  signal: AbortSignal,
  timeoutSignal: AbortSignal,
): Promise<string> {
  const result = await callAction(baseURL, region, 'CreateAsset', {
    Filter: { ProjectName: config.project },
    GroupId: groupId,
    Name: assetName(url),
    AssetType: 'Image',
    URL: url,
  }, accessKey, secretKey, signal, timeoutSignal)
  const id = result.Id
  if (typeof id !== 'string' || id === '') {
    throw new VideoError('video-volc: CreateAsset response carried no asset id', 'VIDEO_PROVIDER_FAILED')
  }
  return id
}

/** Poll the asset until its review settles, then hand back its id. */
async function pollAsset(
  baseURL: string,
  region: string,
  config: VolcAssetClientConfig,
  accessKey: string,
  secretKey: string,
  assetId: string,
  signal: AbortSignal,
  timeoutSignal: AbortSignal,
): Promise<void> {
  for (;;) {
    const result = await callAction(baseURL, region, 'GetAsset', {
      Filter: { ProjectName: config.project },
      Id: assetId,
    }, accessKey, secretKey, signal, timeoutSignal)
    const status = result.Status
    if (status === ASSET_DONE_STATUS) return
    if (status === ASSET_FAILED_STATUS) {
      throw new VideoError(
        `video-volc: reference asset failed review: ${describeMessage(result.Message)}`,
        'VIDEO_PROVIDER_FAILED',
      )
    }
    try {
      await sleep(config.pollIntervalMs, signal)
    } catch (error) {
      throw toProviderFailure(error, timeoutSignal, 'asset polling was interrupted', accessKey, secretKey)
    }
  }
}

/** Derive the asset name from the reference URL's last path segment. */
function assetName(url: string): string {
  const path = new URL(url).pathname
  const stem = path.slice(path.lastIndexOf('/') + 1).replace(/\.[^.]+$/, '')
  const decoded = decodeURIComponent(stem)
  return decoded === '' ? 'reference' : decoded
}

/**
 * Build the signed request headers for one Volcengine OpenAPI call: the
 * HMAC-SHA256 request signature over the canonical method, path, sorted query,
 * sorted headers, and the hashed body, keyed by the day-scoped signing key.
 */
function signedHeaders(
  method: string,
  rawUrl: string,
  body: Record<string, unknown>,
  accessKey: string,
  secretKey: string,
  region: string,
): Record<string, string> {
  const url = new URL(rawUrl)
  const canonicalUri = url.pathname
  const queryPairs = [...url.searchParams.entries()].sort(([first], [second]) => first.localeCompare(second))
  const canonicalQuery = queryPairs.map(([name, value]) => `${name}=${value}`).join('&')
  const amzDate = new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z')
  const dateStamp = amzDate.slice(0, 8)
  const headers: Record<string, string> = {
    'content-type': 'application/json',
    host: url.host,
    'x-date': amzDate,
  }
  const signedEntries = Object.entries(headers).sort(([first], [second]) => first.localeCompare(second))
  const canonicalHeaders = signedEntries.map(([name, value]) => `${name}:${value.trim()}\n`).join('')
  const payloadHash = createHash('sha256').update(JSON.stringify(body), 'utf8').digest('hex')
  const canonicalRequest = [
    method.toUpperCase(),
    canonicalUri,
    canonicalQuery,
    canonicalHeaders,
    signedEntries.map(([name]) => name).join(';'),
    payloadHash,
  ].join('\n')
  const credentialScope = `${dateStamp}/${region}/ark/request`
  const stringToSign = [
    'HMAC-SHA256',
    amzDate,
    credentialScope,
    createHash('sha256').update(canonicalRequest, 'utf8').digest('hex'),
  ].join('\n')
  const kDate = hmac(secretKey, dateStamp)
  const kRegion = hmac(kDate, region)
  const kService = hmac(kRegion, 'ark')
  const kSigning = hmac(kService, 'request')
  const signature = createHmac('sha256', kSigning).update(stringToSign, 'utf8').digest('hex')
  return {
    ...headers,
    authorization: `HMAC-SHA256 Credential=${accessKey}/${credentialScope}, SignedHeaders=${signedEntries.map(([name]) => name).join(';')}, Signature=${signature}`,
  }
}

/** One HMAC-SHA256 round over UTF-8 text, returning the raw key bytes. */
function hmac(key: string | Buffer, message: string): Buffer {
  return createHmac('sha256', key).update(message, 'utf8').digest()
}
