targetScope = 'subscription'

@minLength(1)
@maxLength(64)
@description('azd environment name; used to name the resource group and resources.')
param environmentName string

@minLength(1)
@description('Azure region for all resources.')
param location string

@description('ServiceNow instance origin, e.g. https://dev12345.service-now.com')
param serviceNowInstance string

@description('Container image for the MCP server. Set by azd after the first deploy; empty uses a placeholder image.')
param mcpImageName string = ''

var tags = { 'azd-env-name': environmentName }
var resourceToken = toLower(uniqueString(subscription().id, environmentName, location))

resource rg 'Microsoft.Resources/resourceGroups@2024-03-01' = {
  name: 'rg-${environmentName}'
  location: location
  tags: tags
}

module resources 'resources.bicep' = {
  name: 'resources'
  scope: rg
  params: {
    location: location
    tags: tags
    resourceToken: resourceToken
    serviceNowInstance: serviceNowInstance
    mcpImageName: mcpImageName
  }
}

output AZURE_CONTAINER_REGISTRY_ENDPOINT string = resources.outputs.registryLoginServer
output AZURE_RESOURCE_GROUP string = rg.name
output SERVICE_MCP_NAME string = resources.outputs.appName
output SERVICE_MCP_URI string = resources.outputs.appUri
output MCP_ENDPOINT string = '${resources.outputs.appUri}/mcp'
