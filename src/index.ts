import { config, Namespace } from '@homelab/shared'

const cfg = config('unifi')

const ns = new Namespace('unifi', {
  metadata: { name: cfg.get('namespace', 'unifi') },
})

export const namespace = ns.metadata.name
