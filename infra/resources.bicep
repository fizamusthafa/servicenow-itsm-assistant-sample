param location string
param tags object
@minLength(13)
param resourceToken string
param serviceNowInstance string
param mcpImageName string

@description('Minimum replicas. 1 avoids cold starts that can time out Copilot Studio tool calls.')
param minReplicas int = 1
param maxReplicas int = 3

var appName = 'ca-snow-mcp-${resourceToken}'
var usePlaceholder = empty(mcpImageName)
var acrPullRoleId = '7f951dda-4ed3-4680-a7ca-43fe172d538d'

resource logs 'Microsoft.OperationalInsights/workspaces@2023-09-01' = {
  name: 'log-${resourceToken}'
  location: location
  tags: tags
  properties: {
    sku: { name: 'PerGB2018' }
    retentionInDays: 30
  }
}

resource registry 'Microsoft.ContainerRegistry/registries@2023-07-01' = {
  name: 'cr${resourceToken}'
  location: location
  tags: tags
  sku: { name: 'Basic' }
  properties: {
    adminUserEnabled: false
  }
}

resource identity 'Microsoft.ManagedIdentity/userAssignedIdentities@2023-01-31' = {
  name: 'id-snow-mcp-${resourceToken}'
  location: location
  tags: tags
}

resource acrPull 'Microsoft.Authorization/roleAssignments@2022-04-01' = {
  name: guid(registry.id, identity.id, acrPullRoleId)
  scope: registry
  properties: {
    principalId: identity.properties.principalId
    principalType: 'ServicePrincipal'
    roleDefinitionId: subscriptionResourceId('Microsoft.Authorization/roleDefinitions', acrPullRoleId)
  }
}

resource containerEnv 'Microsoft.App/managedEnvironments@2024-03-01' = {
  name: 'cae-${resourceToken}'
  location: location
  tags: tags
  properties: {
    appLogsConfiguration: {
      destination: 'log-analytics'
      logAnalyticsConfiguration: {
        customerId: logs.properties.customerId
        sharedKey: logs.listKeys().primarySharedKey
      }
    }
  }
}

resource app 'Microsoft.App/containerApps@2024-03-01' = {
  name: appName
  location: location
  tags: union(tags, { 'azd-service-name': 'mcp' })
  identity: {
    type: 'UserAssigned'
    userAssignedIdentities: { '${identity.id}': {} }
  }
  dependsOn: [acrPull]
  properties: {
    managedEnvironmentId: containerEnv.id
    configuration: {
      activeRevisionsMode: 'Single'
      ingress: {
        external: true
        targetPort: 3001
        transport: 'auto'
        allowInsecure: false
      }
      registries: [
        {
          server: registry.properties.loginServer
          identity: identity.id
        }
      ]
    }
    template: {
      containers: [
        {
          name: 'mcp'
          image: usePlaceholder ? 'mcr.microsoft.com/azuredocs/containerapps-helloworld:latest' : mcpImageName
          resources: {
            cpu: json('0.5')
            memory: '1Gi'
          }
          env: [
            { name: 'AUTH_MODE', value: 'oauth' }
            { name: 'SERVICENOW_INSTANCE', value: serviceNowInstance }
            { name: 'PORT', value: '3001' }
          ]
          probes: usePlaceholder
            ? []
            : [
                {
                  type: 'Liveness'
                  httpGet: { path: '/health', port: 3001 }
                  periodSeconds: 30
                }
                {
                  type: 'Readiness'
                  httpGet: { path: '/health', port: 3001 }
                  periodSeconds: 10
                }
              ]
        }
      ]
      scale: {
        minReplicas: minReplicas
        maxReplicas: maxReplicas
        rules: [
          {
            name: 'http'
            http: { metadata: { concurrentRequests: '50' } }
          }
        ]
      }
    }
  }
}

output registryLoginServer string = registry.properties.loginServer
output appName string = app.name
output appUri string = 'https://${app.properties.configuration.ingress.fqdn}'
