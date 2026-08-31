# https://ai.azure.com/doc/azure/ai-foundry/agents/how-to/tools/azure-ai-search

# STEPS:
# Create a multimodal index - https://learn.microsoft.com/en-us/azure/search/search-get-started-portal-image-search?tabs=search-perms%2Copenai-perms%2Cdocument-extraction%2Cimage-verbalization
# create an agent
# To use multiple indexes - https://ai.azure.com/doc/azure/ai-foundry/agents/how-to/connected-agents
# create an azure ai search service in the project - https://ai.azure.com/doc/azure/ai-foundry/how-to/connections-add
# connect azure ai search service to resource group - https://ai.azure.com/doc/azure/ai-foundry/how-to/connections-add
# Use an existing index with ai search tool - https://ai.azure.com/doc/azure/ai-foundry/agents/how-to/tools/azure-ai-search-samples


import os

from azure.ai.ml.entities import AzureAISearchConnection

# Create an Azure AI Search project connection
my_connection_name = os.environ["AZURE_SEARCH_CONNECTION_NAME"] # connection name
my_endpoint = os.environ["AZURE_SEARCH_ENDPOINT"] # This could also be called target
my_api_keys = None # Leave blank for Authentication type = AAD

my_connection = AzureAISearchConnection(name=my_connection_name,
                                    endpoint=my_endpoint, 
                                    api_key= my_api_keys)

# Create the connection
ml_client.connections.create_or_update(my_connection)