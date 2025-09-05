import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { App, config, Namespace, PersistentVolumeClaim, Secret } from '@homelab/shared'
import { Job } from '@pulumi/kubernetes/batch/v1'
import { ConfigMap } from '@pulumi/kubernetes/core/v1'

// URL encode function for MongoDB credentials
function urlEncode(str: string): string {
  return encodeURIComponent(str)
}

const cfg = config('unifi')
const ns = cfg.get('namespace', 'unifi')

// Create namespace
const namespace = new Namespace('unifi', {
  metadata: {
    name: ns,
  },
})

// UniFi credentials and MongoDB connection secret
const unifiSecret = new Secret(
  'unifi-secret',
  {
    metadata: {
      name: 'unifi-secret-v3',
      namespace: ns,
    },
    type: 'Opaque',
    stringData: {
      MONGO_USER: urlEncode(process.env.UNIFI_MONGO_USER || 'unifi'),
      MONGO_PASS: urlEncode(process.env.UNIFI_MONGO_PASSWORD || 'changeme'),
      MONGO_HOST: process.env.UNIFI_MONGO_HOST || 'mongodb.mongodb',
      MONGO_PORT: process.env.UNIFI_MONGO_PORT || '27017',
      MONGO_DBNAME: process.env.UNIFI_MONGO_DBNAME || 'unifi',
      MONGO_AUTHSOURCE: process.env.UNIFI_MONGO_AUTHSOURCE || 'unifi',
    },
  },
  { dependsOn: [namespace] },
)

// MongoDB database initialization script for UniFi
const dbInitScript = new ConfigMap(
  'unifi-db-init',
  {
    metadata: {
      name: 'unifi-db-init',
      namespace: ns,
    },
    data: {
      'init-unifi-db.sh': readFileSync(join(__dirname, '../scripts/init-unifi-db.sh'), 'utf8'),
    },
  },
  { dependsOn: [namespace] },
)

// Database initialization job
const dbInitJob = new Job(
  'unifi-db-init-job',
  {
    metadata: {
      name: 'unifi-db-init-job-v3',
      namespace: ns,
    },
    spec: {
      template: {
        spec: {
          restartPolicy: 'OnFailure',
          containers: [
            {
              name: 'mongo-init',
              image: process.env.MONGODB_IMAGE || 'mongo:7.0',
              command: ['/bin/bash'],
              args: ['/scripts/init-unifi-db.sh'],
              env: [
                {
                  name: 'MONGODB_ROOT_USERNAME',
                  value: process.env.MONGODB_ROOT_USERNAME || 'admin',
                },
                {
                  name: 'MONGODB_ROOT_PASSWORD',
                  value: process.env.MONGODB_ROOT_PASSWORD || 'changeme',
                },
              ],
              envFrom: [
                {
                  secretRef: {
                    name: 'unifi-secret-v3',
                  },
                },
              ],
              volumeMounts: [
                {
                  name: 'init-script',
                  mountPath: '/scripts',
                },
              ],
            },
          ],
          volumes: [
            {
              name: 'init-script',
              configMap: {
                name: 'unifi-db-init',
              },
            },
          ],
        },
      },
    },
  },
  { dependsOn: [namespace, dbInitScript] },
)

// UniFi data PVC
const unifiPVC = new PersistentVolumeClaim(
  'unifi-data',
  {
    metadata: {
      name: 'unifi-data',
      namespace: ns,
    },
    spec: {
      accessModes: ['ReadWriteOnce'],
      storageClassName: cfg.get('storageClass', 'truenas-hdd-mirror-nfs'),
      resources: {
        requests: {
          storage: cfg.get('dataSize', '10Gi'),
        },
      },
    },
  },
  { dependsOn: [namespace] },
)

// UniFi Network Application
const unifi = new App(
  'unifi',
  {
    namespace: ns,
    image: process.env.UNIFI_IMAGE || 'lscr.io/linuxserver/unifi-network-application:9.3.45-ls100',
    ports: [
      { name: 'https', containerPort: 8443, servicePort: 8443 },
      { name: 'http', containerPort: 8080, servicePort: 8080 },
      { name: 'stun', containerPort: 3478, servicePort: 3478 },
      { name: 'discovery', containerPort: 10001, servicePort: 10001 },
    ],
    env: [
      {
        name: 'PUID',
        value: '1000',
      },
      {
        name: 'PGID',
        value: '1000',
      },
      {
        name: 'TZ',
        value: cfg.get('timezone', 'Europe/Brussels'),
      },
      {
        name: 'MEM_LIMIT',
        value: cfg.get('memLimit', '1024'),
      },
      {
        name: 'MEM_STARTUP',
        value: cfg.get('memStartup', '1024'),
      },
    ],
    envFrom: [
      {
        secretRef: {
          name: 'unifi-secret-v3',
        },
      },
    ],
    volumeMounts: [
      {
        name: 'data',
        mountPath: '/config',
      },
    ],
    volumes: [
      {
        name: 'data',
        type: 'pvc',
        source: 'unifi-data',
      },
    ],
    resources: {
      requests: {
        cpu: cfg.get('cpu', '500m'),
        memory: cfg.get('memory', '1Gi'),
      },
      limits: {
        cpu: cfg.get('cpuLimit', '2'),
        memory: cfg.get('memoryLimit', '2Gi'),
      },
    },
    serviceType: 'LoadBalancer',
    serviceAnnotations: {},
  },
  { dependsOn: [namespace, unifiSecret, unifiPVC, dbInitJob] },
)

export const namespaceExport = namespace.metadata.name
export const services = {
  unifi: unifi.service?.metadata.name,
}
