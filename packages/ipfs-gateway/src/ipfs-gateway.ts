import {
  DEFAULT_GATEWAY_PREFIX,
  DEFAULT_SW_FILENAME,
  swGatewayUrlToIpfsUrl,
} from '@crossbell/ipfs-gateway-sw'
import {
  DEFAULT_IPFS_GATEWAYS,
  parseIpfsInfo,
  fillIpfsGatewayTemplate,
  Web2Url,
  IpfsUrl,
  IpfsGatewayTemplate,
  ipfsFetch,
  isIpfsUrl,
} from '@crossbell/ipfs-fetch'

import { registerServiceWorker, RegisterServiceWorkerConfig } from './sw-register'
import {
  isBrowser,
  markServiceWorkerAsRegistered,
  checkIfServiceWorkerRegisteredBefore,
  markServiceWorkerAsUnregistered,
} from './utils'

export type IpfsGatewayServiceWorkerConfig = Omit<RegisterServiceWorkerConfig, 'gateways'>

export type IpfsGatewayConfig = {
  gateways: IpfsGatewayTemplate[]
  serviceWorker: IpfsGatewayServiceWorkerConfig | null
}

export type OptionalIpfsGatewayConfig = Partial<{
  gateways: IpfsGatewayTemplate[]
  serviceWorker: Partial<IpfsGatewayServiceWorkerConfig> | null
}>

export type IpfsGatewaySwStatus = 'disabled' | 'first-time-install' | 'pending-response' | 'ready'

export class IpfsGateway {
  readonly fallbackGateway: IpfsGatewayTemplate
  readonly config: IpfsGatewayConfig
  readonly registration: Promise<boolean>

  private _swStatus: IpfsGatewaySwStatus

  get swStatus() {
    return this._swStatus
  }

  constructor(config: OptionalIpfsGatewayConfig = {}) {
    this.config = prepareConfig(config)
    this.fallbackGateway = this.config.gateways[0] ?? DEFAULT_IPFS_GATEWAYS[0]

    const swInfo = ((): { status: IpfsGatewaySwStatus; registration: Promise<boolean> } => {
      const { gateways, serviceWorker: swConfig } = this.config

      if (isBrowser && swConfig && 'serviceWorker' in navigator) {
        const registerConfig = { gateways, ...swConfig }
        return {
          status: checkIfServiceWorkerRegisteredBefore(swConfig.serviceWorkerFilename)
            ? 'pending-response'
            : 'first-time-install',

          registration: registerServiceWorker(registerConfig).then((isReady) => {
            if (isReady) {
              this._swStatus = 'ready'
              markServiceWorkerAsRegistered(swConfig.serviceWorkerFilename)
              return true
            } else {
              this._swStatus = 'disabled'
              markServiceWorkerAsUnregistered(swConfig.serviceWorkerFilename)
              return false
            }
          }),
        }
      } else {
        return {
          status: 'disabled',
          registration: Promise.resolve(false),
        }
      }
    })()

    this._swStatus = swInfo.status
    this.registration = swInfo.registration
  }

  async getWeb2Url(ipfsUrl: IpfsUrl): Promise<Web2Url>
  async getWeb2Url(ipfsUrl: string): Promise<Web2Url | null>
  async getWeb2Url(ipfsUrl: string): Promise<Web2Url | null> {
    const isSwReady = this.config.serviceWorker ? await this.registration : false
    const swWeb2Url = isSwReady ? this.getSwWeb2Url(ipfsUrl) : null

    return swWeb2Url ?? (await this.getFastestWeb2Url(ipfsUrl)) ?? this.getFallbackWeb2Url(ipfsUrl)
  }

  async getFastestWeb2Url(ipfsUrl: string): Promise<Web2Url | null> {
    if (!isIpfsUrl(ipfsUrl)) return null

    try {
      const res = await ipfsFetch(ipfsUrl, {
        method: 'head',
        gateways: this.config.gateways,
      })

      return res.url as Web2Url
    } catch (e) {
      console.error(e)
      return null
    }
  }

  getSwWeb2Url(ipfsUrl: IpfsUrl): Web2Url
  getSwWeb2Url(ipfsUrl: string): Web2Url | null
  getSwWeb2Url(ipfsUrl: string): Web2Url | null {
    const gatewayPrefix = this.config.serviceWorker?.gatewayPrefix ?? DEFAULT_GATEWAY_PREFIX
    const ipfsInfo = parseIpfsInfo(ipfsUrl)

    return ipfsInfo && fillIpfsGatewayTemplate(`${gatewayPrefix}{cid}{pathToResource}`, ipfsInfo)
  }

  getFallbackWeb2Url(ipfsUrl: IpfsUrl): Web2Url
  getFallbackWeb2Url(ipfsUrl: string): Web2Url | null
  getFallbackWeb2Url(ipfsUrl: string): Web2Url | null {
    const ipfsInfo = parseIpfsInfo(ipfsUrl)

    return ipfsInfo && fillIpfsGatewayTemplate(this.fallbackGateway, ipfsInfo)
  }

  convertToIpfsUrl(url: string): IpfsUrl | null {
    const gatewayPrefix = this.config.serviceWorker?.gatewayPrefix

    if (isIpfsUrl(url)) {
      return url
    } else if (gatewayPrefix) {
      return swGatewayUrlToIpfsUrl(gatewayPrefix, url)
    } else {
      return null
    }
  }

  async openIpfsUrl(
    ipfsUrl: IpfsUrl,
    target?: string,
    features?: string,
  ): Promise<WindowProxy | null> {
    const newWindow = window.open('', target, features)

    if (newWindow) {
      await this.getFastestWeb2Url(ipfsUrl)
        .catch(() => null)
        .then((url) => url ?? this.getFallbackWeb2Url(ipfsUrl))
        .then((url) => (newWindow.location.href = url))
    }

    return newWindow
  }
}

function prepareConfig({ gateways, serviceWorker }: OptionalIpfsGatewayConfig): IpfsGatewayConfig {
  return {
    gateways: gateways ?? DEFAULT_IPFS_GATEWAYS,
    serviceWorker:
      serviceWorker === null
        ? null
        : {
            serviceWorkerFilename: serviceWorker?.serviceWorkerFilename ?? DEFAULT_SW_FILENAME,
            gatewayPrefix: serviceWorker?.gatewayPrefix ?? DEFAULT_GATEWAY_PREFIX,
          },
  }
}
