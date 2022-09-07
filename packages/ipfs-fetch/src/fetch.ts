import type { IpfsUrl, IpfsGatewayTemplate } from './types'
import { DEFAULT_IPFS_GATEWAYS } from './constant'
import { ipfsToWeb2InfoList } from './utils'

export type IpfsToFastestWeb2UrlConfig = RequestInit & {
  gateways?: IpfsGatewayTemplate[]
  timeout?: number
}

export enum IpfsFetchError {
  timeout = 'ipfsFetch timeout',
  abort = 'ipfsFetch abort',
}

const NEVER = new Promise<never>(() => {})

export function ipfsFetch(
  ipfsUrl: IpfsUrl,
  {
    gateways = DEFAULT_IPFS_GATEWAYS,
    timeout,
    signal,
    ...fetchConfig
  }: IpfsToFastestWeb2UrlConfig = {},
): Promise<Response> {
  return new Promise((resolve, reject) => {
    const web2InfoList = ipfsToWeb2InfoList(ipfsUrl, gateways)
    const abortControllerSet = new Set<AbortController>()

    const cancelRequests = () => {
      abortControllerSet.forEach((abortController) => abortController.abort())
      abortControllerSet.clear()
    }

    const timeoutId =
      typeof timeout === 'number'
        ? setTimeout(() => {
            reject(new Error(IpfsFetchError.timeout))
            cleanup()
          }, timeout)
        : null

    signal?.addEventListener('abort', () => {
      reject(new Error(IpfsFetchError.abort))
      cleanup()
    })

    Promise.race(
      web2InfoList.map((info) => {
        const abortController = new AbortController()

        abortControllerSet.add(abortController)

        return (
          fetch(info.url, { ...fetchConfig, signal: abortController.signal })
            .then((response) => {
              // Only resolve successful requests
              if (response.status === 200) {
                // Remove current abortController to avoid unexpected abort behavior
                abortControllerSet.delete(abortController)
                return response
              } else {
                return NEVER
              }
            })
            // Ignore fetch errors
            .catch(() => NEVER)
        )
      }),
    )
      .then(resolve)
      .finally(cleanup)

    function cleanup() {
      cancelRequests()

      if (timeoutId !== null) {
        clearTimeout(timeoutId)
      }
    }
  })
}
