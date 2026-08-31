"""
Course-specific Azure AI Search Index Management

This module manages per-course indexes for the Ekalaiva platform.
Each course gets its own dedicated index, datasource, skillset, and indexer.

Features:
- Create index for a course when files are uploaded
- Delete index when course/agent is deleted  
- Update index when files change in edit mode
- Run indexer on demand to reindex documents
"""

import os
import re
import logging
import requests
from typing import Optional, Dict, Any, Tuple
from azure.identity import DefaultAzureCredential

logger = logging.getLogger(__name__)

# Configuration — single source of truth in azure_services/config.py
from azure_services.config import (
    SEARCH_SERVICE_NAME,
    SEARCH_ENDPOINT,
    API_VERSION,
    SUBSCRIPTION_ID,
    RESOURCE_GROUP,
    STORAGE_ACCOUNT,
    BLOB_CONTAINER,
    FOUNDRY_ENDPOINT,
    EMBEDDING_MODEL,
    EMBEDDING_DIMENSIONS,
    CHAT_MODEL,
    COMMON_INDEX_NAME,
    COMMON_DATASOURCE_NAME,
    COMMON_SKILLSET_NAME,
    COMMON_INDEXER_NAME,
    COMMON_IMAGE_CONTAINER,
)

# In-memory cache to skip redundant pipeline creation calls within same process
_pipeline_ensured = False


def _get_access_token() -> str:
    """
    Get Azure access token for REST API calls with retry logic.
    Uses centralized auth with caching to avoid Windows file locking issues.
    """
    try:
        # Try the retry-enabled token getter from common_azure_auth
        from common_azure_auth import get_token_with_retry
        token = get_token_with_retry("https://search.azure.com/.default")
        logger.info(f"Got access token: {token[:50]}...")
        return token
    except ImportError:
        # Fallback to direct credential if common_azure_auth not available
        from azure.identity import DefaultAzureCredential
        credential = DefaultAzureCredential()
        token = credential.get_token("https://search.azure.com/.default")
        logger.info(f"Got access token: {token.token[:50]}...")
        return token.token


def _make_request(method: str, url: str, json_body: Optional[Dict] = None, timeout: int = 60) -> requests.Response:
    """Make authenticated request to Azure AI Search"""
    token = _get_access_token()
    headers = {
        "Authorization": f"Bearer {token}",
        "Content-Type": "application/json"
    }
    
    logger.debug(f"Making {method} request to: {url}")
    
    if method == "GET":
        response = requests.get(url, headers=headers, timeout=timeout)
    elif method == "POST":
        response = requests.post(url, headers=headers, json=json_body, timeout=timeout)
    elif method == "PUT":
        response = requests.put(url, headers=headers, json=json_body, timeout=timeout)
    elif method == "DELETE":
        response = requests.delete(url, headers=headers, timeout=timeout)
    else:
        raise ValueError(f"Unsupported method: {method}")
    
    logger.debug(f"Response status: {response.status_code}")
    return response


def _sanitize_session_uuid(session_uuid: str) -> str:
    """Strip any characters outside the allowed set (alphanumeric + hyphens)
    before the value is used to build resource names/URLs, to prevent
    request forgery via a crafted session_uuid."""
    safe_session_uuid = re.sub(r"[^a-zA-Z0-9-]", "", session_uuid or "")[:32]
    if not safe_session_uuid:
        raise ValueError("session_uuid must contain at least one alphanumeric character")
    return safe_session_uuid


def _get_resource_names(session_uuid: str, kb_scope: str = "course") -> Dict[str, str]:
    """Generate consistent resource names for a course"""
    # Use session UUID to create unique names (max 128 chars, alphanumeric + hyphens)
    prefix = f"{_sanitize_session_uuid(session_uuid)}-{kb_scope}"
    return {
        "index": f"{prefix}-index",
        "datasource": f"{prefix}-ds",
        "skillset": f"{prefix}-skillset",
        "indexer": f"{prefix}-indexer",
        "image_container": f"{prefix}-images"
    }


def _get_unified_resource_names(session_uuid: str) -> Dict[str, str]:
    """
    Generate resource names for a UNIFIED index/pipeline.
    This covers ALL files (course + exam) in a single index.
    """
    prefix = f"{_sanitize_session_uuid(session_uuid)}-unified"
    return {
        "index": f"{prefix}-index",
        "datasource": f"{prefix}-ds",
        "skillset": f"{prefix}-skillset",
        "indexer": f"{prefix}-indexer",
        "image_container": f"{prefix}-images"
    }


def create_unified_datasource(session_uuid: str) -> Tuple[bool, str]:
    """
    Create a data source that covers ALL files for a session.
    Points to: sessions/{session_uuid}/ (includes both course/ and exam/ subfolders)
    """
    subscription_id = os.getenv("AZURE_SUBSCRIPTION_ID", SUBSCRIPTION_ID)
    resource_group = os.getenv("AZURE_RESOURCE_GROUP", RESOURCE_GROUP)
    storage_account = os.getenv("STORAGE_ACCOUNT_NAME", STORAGE_ACCOUNT)
    blob_container = os.getenv("AZURE_AI_SEARCH_BLOB_CONTAINER", BLOB_CONTAINER)
    search_endpoint = os.getenv("AZURE_AI_SEARCH_ENDPOINT", SEARCH_ENDPOINT)
    
    names = _get_unified_resource_names(session_uuid)
    datasource_name = names["datasource"]
    
    storage_connection = f"ResourceId=/subscriptions/{subscription_id}/resourceGroups/{resource_group}/providers/Microsoft.Storage/storageAccounts/{storage_account}/;"
    
    # Point to the session folder (covers both course/ and exam/ subfolders)
    blob_prefix = f"sessions/{session_uuid}/"
    
    logger.info(f"Creating UNIFIED datasource '{datasource_name}' for path: {blob_prefix}")
    
    url = f"{search_endpoint}/datasources/{datasource_name}?api-version={API_VERSION}"
    
    body = {
        "name": datasource_name,
        "description": f"Unified data source for session {session_uuid} (course + exam files)",
        "type": "azureblob",
        "credentials": {
            "connectionString": storage_connection
        },
        "container": {
            "name": blob_container,
            "query": blob_prefix  # Covers all subfolders (course/, exam/)
        }
    }
    
    response = _make_request("PUT", url, body)
    if response.status_code in [200, 201, 204]:
        logger.info(f"✓ Unified Datasource '{datasource_name}' created successfully")
        return True, datasource_name
    else:
        logger.error(f"✗ Failed to create unified datasource: {response.status_code}")
        logger.error(f"Response: {response.text}")
        return False, response.text


def create_unified_index(session_uuid: str) -> Tuple[bool, str]:
    """
    Create a UNIFIED search index that covers ALL files for a session.
    This single index contains both course and exam materials.
    """
    names = _get_unified_resource_names(session_uuid)
    index_name = names["index"]
    
    logger.info(f"Creating UNIFIED index '{index_name}'")
    
    url = f"{SEARCH_ENDPOINT}/indexes/{index_name}?api-version={API_VERSION}"
    
    body = {
        "name": index_name,
        "fields": [
            {
                "name": "content_id",
                "type": "Edm.String",
                "key": True,
                "retrievable": True,
                "analyzer": "keyword"
            },
            {
                "name": "text_document_id",
                "type": "Edm.String",
                "searchable": False,
                "filterable": True,
                "retrievable": True
            },
            {
                "name": "document_title",
                "type": "Edm.String",
                "searchable": True,
                "retrievable": True
            },
            {
                "name": "image_document_id",
                "type": "Edm.String",
                "filterable": True,
                "retrievable": True
            },
            {
                "name": "content_text",
                "type": "Edm.String",
                "searchable": True,
                "retrievable": True
            },
            {
                "name": "content_embedding",
                "type": "Collection(Edm.Single)",
                "dimensions": EMBEDDING_DIMENSIONS,
                "searchable": True,
                "retrievable": True,
                "vectorSearchProfile": "hnsw"
            },
            {
                "name": "content_path",
                "type": "Edm.String",
                "searchable": False,
                "retrievable": True
            },
            {
                "name": "page_number",
                "type": "Edm.Int32",
                "searchable": False,
                "retrievable": True,
                "filterable": True
            },
            # Additional field to track file category (course/exam)
            {
                "name": "file_category",
                "type": "Edm.String",
                "searchable": False,
                "retrievable": True,
                "filterable": True,
                "facetable": True
            }
        ],
        "vectorSearch": {
            "profiles": [
                {
                    "name": "hnsw",
                    "algorithm": "defaulthnsw",
                    "vectorizer": "openai-vectorizer"
                }
            ],
            "algorithms": [
                {
                    "name": "defaulthnsw",
                    "kind": "hnsw",
                    "hnswParameters": {
                        "m": 4,
                        "efConstruction": 400,
                        "metric": "cosine"
                    }
                }
            ],
            "vectorizers": [
                {
                    "name": "openai-vectorizer",
                    "kind": "azureOpenAI",
                    "azureOpenAIParameters": {
                        "resourceUri": FOUNDRY_ENDPOINT,
                        "deploymentId": EMBEDDING_MODEL,
                        "modelName": EMBEDDING_MODEL
                    }
                }
            ]
        },
        "semantic": {
            "defaultConfiguration": "semantic-config",
            "configurations": [
                {
                    "name": "semantic-config",
                    "prioritizedFields": {
                        "titleField": {"fieldName": "document_title"},
                        "prioritizedContentFields": [
                            {"fieldName": "content_text"}
                        ]
                    }
                }
            ]
        }
    }
    
    response = _make_request("PUT", url, body)
    if response.status_code in [200, 201, 204]:
        logger.info(f"✓ Unified Index '{index_name}' created successfully")
        return True, index_name
    else:
        logger.error(f"✗ Failed to create unified index: {response.status_code} - {response.text}")
        return False, response.text


def get_unified_index_name(session_uuid: str) -> str:
    """Get the unified index name for a session"""
    names = _get_unified_resource_names(session_uuid)
    return names["index"]


def create_course_datasource(session_uuid: str, kb_scope: str = "course") -> Tuple[bool, str]:
    """
    Create data source connection to blob storage for a specific course.
    Points to: sessions/{session_uuid}/{kb_scope}/
    """
    # Re-read env vars at runtime in case they weren't loaded at import time
    subscription_id = os.getenv("AZURE_SUBSCRIPTION_ID", SUBSCRIPTION_ID)
    resource_group = os.getenv("AZURE_RESOURCE_GROUP", RESOURCE_GROUP)
    storage_account = os.getenv("STORAGE_ACCOUNT_NAME", STORAGE_ACCOUNT)
    blob_container = os.getenv("AZURE_AI_SEARCH_BLOB_CONTAINER", BLOB_CONTAINER)
    search_endpoint = os.getenv("AZURE_AI_SEARCH_ENDPOINT", SEARCH_ENDPOINT)
    
    logger.info(f"Using config - Storage: {storage_account}, Container: {blob_container}")
    
    names = _get_resource_names(session_uuid, kb_scope)
    datasource_name = names["datasource"]
    
    # Storage connection using managed identity
    storage_connection = f"ResourceId=/subscriptions/{subscription_id}/resourceGroups/{resource_group}/providers/Microsoft.Storage/storageAccounts/{storage_account}/;"
    
    # Blob path prefix for this course's files
    blob_prefix = f"sessions/{session_uuid}/{kb_scope}/"
    
    logger.info(f"Creating datasource '{datasource_name}' for path: {blob_prefix}")
    logger.info(f"Storage connection: {storage_connection}")
    
    url = f"{search_endpoint}/datasources/{datasource_name}?api-version={API_VERSION}"
    
    body = {
        "name": datasource_name,
        "description": f"Data source for course {session_uuid} ({kb_scope})",
        "type": "azureblob",
        "credentials": {
            "connectionString": storage_connection
        },
        "container": {
            "name": blob_container,
            "query": blob_prefix  # Only index files in this course's folder
        }
    }
    
    logger.info(f"Datasource body: {body}")
    
    response = _make_request("PUT", url, body)
    if response.status_code in [200, 201, 204]:
        logger.info(f"✓ Datasource '{datasource_name}' created successfully")
        return True, datasource_name
    else:
        logger.error(f"✗ Failed to create datasource: {response.status_code}")
        logger.error(f"Response headers: {dict(response.headers)}")
        logger.error(f"Response body: {response.text}")
        logger.error(f"Request URL: {url}")
        return False, response.text


def create_course_index(session_uuid: str, kb_scope: str = "course") -> Tuple[bool, str]:
    """Create search index with multimodal embedding support for a course"""
    names = _get_resource_names(session_uuid, kb_scope)
    index_name = names["index"]
    
    logger.info(f"Creating index '{index_name}'")
    
    url = f"{SEARCH_ENDPOINT}/indexes/{index_name}?api-version={API_VERSION}"
    
    body = {
        "name": index_name,
        "fields": [
            {
                "name": "content_id",
                "type": "Edm.String",
                "key": True,
                "retrievable": True,
                "analyzer": "keyword"
            },
            {
                "name": "text_document_id",
                "type": "Edm.String",
                "searchable": False,
                "filterable": True,
                "retrievable": True
            },
            {
                "name": "document_title",
                "type": "Edm.String",
                "searchable": True,
                "retrievable": True
            },
            {
                "name": "image_document_id",
                "type": "Edm.String",
                "filterable": True,
                "retrievable": True
            },
            {
                "name": "content_text",
                "type": "Edm.String",
                "searchable": True,
                "retrievable": True
            },
            {
                "name": "content_embedding",
                "type": "Collection(Edm.Single)",
                "dimensions": EMBEDDING_DIMENSIONS,
                "searchable": True,
                "retrievable": True,
                "vectorSearchProfile": "hnsw"
            },
            {
                "name": "content_path",
                "type": "Edm.String",
                "searchable": False,
                "retrievable": True
            },
            {
                "name": "page_number",
                "type": "Edm.Int32",
                "searchable": False,
                "retrievable": True,
                "filterable": True
            }
        ],
        "vectorSearch": {
            "profiles": [
                {
                    "name": "hnsw",
                    "algorithm": "defaulthnsw",
                    "vectorizer": "openai-vectorizer"
                }
            ],
            "algorithms": [
                {
                    "name": "defaulthnsw",
                    "kind": "hnsw",
                    "hnswParameters": {
                        "m": 4,
                        "efConstruction": 400,
                        "metric": "cosine"
                    }
                }
            ],
            "vectorizers": [
                {
                    "name": "openai-vectorizer",
                    "kind": "azureOpenAI",
                    "azureOpenAIParameters": {
                        "resourceUri": FOUNDRY_ENDPOINT,
                        "deploymentId": EMBEDDING_MODEL,
                        "modelName": EMBEDDING_MODEL
                    }
                }
            ]
        },
        "semantic": {
            "defaultConfiguration": "semantic-config",
            "configurations": [
                {
                    "name": "semantic-config",
                    "prioritizedFields": {
                        "titleField": {"fieldName": "document_title"},
                        "prioritizedContentFields": [
                            {"fieldName": "content_text"}
                        ]
                    }
                }
            ]
        }
    }
    
    response = _make_request("PUT", url, body)
    if response.status_code in [200, 201, 204]:
        logger.info(f"✓ Index '{index_name}' created successfully")
        return True, index_name
    else:
        logger.error(f"✗ Failed to create index: {response.status_code} - {response.text}")
        return False, response.text


def create_course_skillset(session_uuid: str, kb_scope: str = "course") -> Tuple[bool, str]:
    """Create skillset with Document Intelligence Layout and embedding skills"""
    names = _get_resource_names(session_uuid, kb_scope)
    skillset_name = names["skillset"]
    index_name = names["index"]
    image_container = names["image_container"]
    
    logger.info(f"Creating skillset '{skillset_name}'")
    
    url = f"{SEARCH_ENDPOINT}/skillsets/{skillset_name}?api-version={API_VERSION}"
    
    body = {
        "name": skillset_name,
        "description": f"Skillset for course {session_uuid} ({kb_scope})",
        "skills": [
            # Document Layout Skill - Semantic chunking with markdown output
            {
                "@odata.type": "#Microsoft.Skills.Util.DocumentIntelligenceLayoutSkill",
                "name": "document-layout-skill",
                "description": "Extract text with semantic chunking using Document Intelligence",
                "context": "/document",
                "outputMode": "oneToMany",
                "markdownHeaderDepth": "h6",
                "inputs": [
                    {
                        "name": "file_data",
                        "source": "/document/file_data"
                    }
                ],
                "outputs": [
                    {
                        "name": "text_sections",
                        "targetName": "text_sections"
                    },
                    {
                        "name": "normalized_images",
                        "targetName": "normalized_images"
                    }
                ]
            },
            # Text Embedding Skill
            {
                "@odata.type": "#Microsoft.Skills.Text.AzureOpenAIEmbeddingSkill",
                "name": "text-embedding-skill",
                "description": f"Create embeddings using {EMBEDDING_MODEL}",
                "context": "/document/text_sections/*",
                "resourceUri": FOUNDRY_ENDPOINT,
                "deploymentId": EMBEDDING_MODEL,
                "modelName": EMBEDDING_MODEL,
                "dimensions": EMBEDDING_DIMENSIONS,
                "inputs": [
                    {
                        "name": "text",
                        "source": "/document/text_sections/*/content"
                    }
                ],
                "outputs": [
                    {
                        "name": "embedding",
                        "targetName": "text_vector"
                    }
                ]
            }
        ],
        "cognitiveServices": {
            "@odata.type": "#Microsoft.Azure.Search.AIServicesByIdentity",
            "subdomainUrl": FOUNDRY_ENDPOINT
        },
        "indexProjections": {
            "selectors": [
                {
                    "targetIndexName": index_name,
                    "parentKeyFieldName": "text_document_id",
                    "sourceContext": "/document/text_sections/*",
                    "mappings": [
                        {
                            "name": "content_embedding",
                            "source": "/document/text_sections/*/text_vector"
                        },
                        {
                            "name": "content_text",
                            "source": "/document/text_sections/*/content"
                        },
                        {
                            "name": "page_number",
                            "source": "/document/text_sections/*/pageNumber"
                        },
                        {
                            "name": "document_title",
                            "source": "/document/metadata_storage_name"
                        }
                    ]
                }
            ],
            "parameters": {
                "projectionMode": "skipIndexingParentDocuments"
            }
        }
    }
    
    response = _make_request("PUT", url, body)
    if response.status_code in [200, 201, 204]:
        logger.info(f"✓ Skillset '{skillset_name}' created successfully")
        return True, skillset_name
    else:
        logger.error(f"✗ Failed to create skillset: {response.status_code} - {response.text}")
        return False, response.text


def create_course_indexer(session_uuid: str, kb_scope: str = "course") -> Tuple[bool, str]:
    """Create indexer to process documents"""
    names = _get_resource_names(session_uuid, kb_scope)
    indexer_name = names["indexer"]
    datasource_name = names["datasource"]
    index_name = names["index"]
    skillset_name = names["skillset"]
    
    logger.info(f"Creating indexer '{indexer_name}'")
    
    url = f"{SEARCH_ENDPOINT}/indexers/{indexer_name}?api-version={API_VERSION}"
    
    body = {
        "name": indexer_name,
        "description": f"Indexer for course {session_uuid} ({kb_scope})",
        "dataSourceName": datasource_name,
        "targetIndexName": index_name,
        "skillsetName": skillset_name,
        "parameters": {
            "maxFailedItems": -1,
            "maxFailedItemsPerBatch": 0,
            "batchSize": 1,
            "configuration": {
                "allowSkillsetToReadFileData": True
            }
        },
        "fieldMappings": [
            {
                "sourceFieldName": "metadata_storage_name",
                "targetFieldName": "document_title"
            }
        ],
        "outputFieldMappings": []
    }
    
    response = _make_request("PUT", url, body)
    if response.status_code in [200, 201, 204]:
        logger.info(f"✓ Indexer '{indexer_name}' created successfully")
        return True, indexer_name
    else:
        logger.error(f"✗ Failed to create indexer: {response.status_code} - {response.text}")
        return False, response.text


def run_indexer(session_uuid: str, kb_scope: str = "course") -> Tuple[bool, str]:
    """Run the indexer to process documents"""
    names = _get_resource_names(session_uuid, kb_scope)
    indexer_name = names["indexer"]
    
    logger.info(f"Running indexer '{indexer_name}'")
    
    url = f"{SEARCH_ENDPOINT}/indexers/{indexer_name}/run?api-version={API_VERSION}"
    
    response = _make_request("POST", url)
    if response.status_code in [200, 202, 204]:
        logger.info(f"✓ Indexer '{indexer_name}' started successfully")
        return True, indexer_name
    else:
        logger.error(f"✗ Failed to run indexer: {response.status_code} - {response.text}")
        return False, response.text


def reset_indexer(session_uuid: str, kb_scope: str = "course") -> Tuple[bool, str]:
    """Reset the indexer to reprocess all documents"""
    names = _get_resource_names(session_uuid, kb_scope)
    indexer_name = names["indexer"]
    
    logger.info(f"Resetting indexer '{indexer_name}'")
    
    url = f"{SEARCH_ENDPOINT}/indexers/{indexer_name}/reset?api-version={API_VERSION}"
    
    response = _make_request("POST", url)
    if response.status_code in [200, 204]:
        logger.info(f"✓ Indexer '{indexer_name}' reset successfully")
        return True, indexer_name
    else:
        logger.error(f"✗ Failed to reset indexer: {response.status_code} - {response.text}")
        return False, response.text


def get_indexer_status(session_uuid: str, kb_scope: str = "course") -> Dict[str, Any]:
    """Get the current status of the indexer"""
    names = _get_resource_names(session_uuid, kb_scope)
    indexer_name = names["indexer"]
    
    url = f"{SEARCH_ENDPOINT}/indexers/{indexer_name}/status?api-version={API_VERSION}"
    
    response = _make_request("GET", url)
    if response.status_code == 200:
        return response.json()
    else:
        return {"error": response.text, "status_code": response.status_code}


def create_course_index_pipeline(session_uuid: str, kb_scope: str = "course") -> Tuple[bool, str]:
    """
    Create complete indexing pipeline for a course.
    Creates: datasource -> index -> skillset -> indexer
    Then runs the indexer.
    
    Returns: (success, index_name or error_message)
    """
    logger.info(f"=== Creating index pipeline for session {session_uuid} ({kb_scope}) ===")
    
    # Step 1: Create datasource
    success, result = create_course_datasource(session_uuid, kb_scope)
    if not success:
        return False, f"Datasource creation failed: {result}"
    
    # Step 2: Create index
    success, index_name = create_course_index(session_uuid, kb_scope)
    if not success:
        return False, f"Index creation failed: {index_name}"
    
    # Step 3: Create skillset
    success, result = create_course_skillset(session_uuid, kb_scope)
    if not success:
        return False, f"Skillset creation failed: {result}"
    
    # Step 4: Create indexer
    success, result = create_course_indexer(session_uuid, kb_scope)
    if not success:
        return False, f"Indexer creation failed: {result}"
    
    # Step 5: Run indexer
    success, result = run_indexer(session_uuid, kb_scope)
    if not success:
        logger.warning(f"Indexer run failed (may already be running): {result}")
        # Don't fail the whole pipeline if indexer run fails
    
    logger.info(f"=== Index pipeline created successfully: {index_name} ===")
    return True, index_name


def create_unified_index_pipeline(session_uuid: str) -> Tuple[bool, str]:
    """
    Create a UNIFIED indexing pipeline that covers ALL files (course + exam).
    
    This creates a single index that points to sessions/{session_uuid}/,
    which includes both course/ and exam/ subfolders.
    
    Use this instead of separate course/exam pipelines when you want
    one Knowledge Base to search all materials.
    
    Returns: (success, index_name or error_message)
    """
    logger.info(f"=== Creating UNIFIED index pipeline for session {session_uuid} ===")
    
    # Step 1: Create unified datasource (covers all subfolders)
    success, result = create_unified_datasource(session_uuid)
    if not success:
        return False, f"Unified datasource creation failed: {result}"
    
    # Step 2: Create unified index
    success, index_name = create_unified_index(session_uuid)
    if not success:
        return False, f"Unified index creation failed: {index_name}"
    
    # Step 3: Create skillset (reuse the existing skillset logic with unified names)
    success, result = create_unified_skillset(session_uuid)
    if not success:
        return False, f"Unified skillset creation failed: {result}"
    
    # Step 4: Create indexer
    success, result = create_unified_indexer(session_uuid)
    if not success:
        return False, f"Unified indexer creation failed: {result}"
    
    # Step 5: Run indexer
    success, result = run_unified_indexer(session_uuid)
    if not success:
        logger.warning(f"Unified indexer run failed (may already be running): {result}")
    
    logger.info(f"=== UNIFIED index pipeline created successfully: {index_name} ===")
    return True, index_name


def create_unified_skillset(session_uuid: str) -> Tuple[bool, str]:
    """Create skillset for the unified index"""
    names = _get_unified_resource_names(session_uuid)
    skillset_name = names["skillset"]
    index_name = names["index"]
    image_container = names["image_container"]
    
    logger.info(f"Creating UNIFIED skillset '{skillset_name}'")
    
    url = f"{SEARCH_ENDPOINT}/skillsets/{skillset_name}?api-version={API_VERSION}"
    
    body = {
        "name": skillset_name,
        "description": f"Unified skillset for session {session_uuid} (all files)",
        "skills": [
            # Document Layout Skill - Semantic chunking with markdown output
            {
                "@odata.type": "#Microsoft.Skills.Util.DocumentIntelligenceLayoutSkill",
                "name": "document-layout-skill",
                "description": "Extract text with semantic chunking using Document Intelligence",
                "context": "/document",
                "outputMode": "oneToMany",
                "markdownHeaderDepth": "h6",
                "inputs": [
                    {"name": "file_data", "source": "/document/file_data"}
                ],
                "outputs": [
                    {"name": "text_sections", "targetName": "text_sections"},
                    {"name": "normalized_images", "targetName": "normalized_images"}
                ]
            },
            {
                "@odata.type": "#Microsoft.Skills.Text.AzureOpenAIEmbeddingSkill",
                "name": "embedding-skill",
                "description": "Generate embeddings for text chunks",
                "context": "/document/text_sections/*",
                "resourceUri": FOUNDRY_ENDPOINT,
                "deploymentId": EMBEDDING_MODEL,
                "modelName": EMBEDDING_MODEL,
                "dimensions": EMBEDDING_DIMENSIONS,
                "inputs": [
                    {"name": "text", "source": "/document/text_sections/*/content"}
                ],
                "outputs": [
                    {"name": "embedding", "targetName": "content_embedding"}
                ]
            }
        ],
        "indexProjections": {
            "selectors": [
                {
                    "targetIndexName": index_name,
                    "parentKeyFieldName": "text_document_id",
                    "sourceContext": "/document/text_sections/*",
                    "mappings": [
                        {"name": "content_text", "source": "/document/text_sections/*/content"},
                        {"name": "content_path", "source": "/document/metadata_storage_path"},
                        {"name": "document_title", "source": "/document/metadata_storage_name"},
                        {"name": "page_number", "source": "/document/text_sections/*/pageNumber"},
                        {"name": "content_embedding", "source": "/document/text_sections/*/content_embedding"}
                    ]
                }
            ],
            "parameters": {
                "projectionMode": "skipIndexingParentDocuments"
            }
        },
        "knowledgeStore": {
            "storageConnectionString": f"ResourceId=/subscriptions/{SUBSCRIPTION_ID}/resourceGroups/{RESOURCE_GROUP}/providers/Microsoft.Storage/storageAccounts/{STORAGE_ACCOUNT}/;",
            "projections": [
                {
                    "objects": [],
                    "tables": [],
                    "files": [
                        {
                            "storageContainer": image_container,
                            "generatedKeyName": "image_id",
                            "source": "/document/images/*/data"
                        }
                    ]
                }
            ]
        }
    }
    
    response = _make_request("PUT", url, body)
    if response.status_code in [200, 201, 204]:
        logger.info(f"✓ Unified Skillset '{skillset_name}' created successfully")
        return True, skillset_name
    else:
        logger.error(f"✗ Failed to create unified skillset: {response.status_code}")
        logger.error(f"Response: {response.text}")
        return False, response.text


def create_unified_indexer(session_uuid: str) -> Tuple[bool, str]:
    """Create indexer for the unified index"""
    names = _get_unified_resource_names(session_uuid)
    indexer_name = names["indexer"]
    datasource_name = names["datasource"]
    index_name = names["index"]
    skillset_name = names["skillset"]
    
    logger.info(f"Creating UNIFIED indexer '{indexer_name}'")
    
    url = f"{SEARCH_ENDPOINT}/indexers/{indexer_name}?api-version={API_VERSION}"
    
    body = {
        "name": indexer_name,
        "description": f"Unified indexer for session {session_uuid} (all files)",
        "dataSourceName": datasource_name,
        "targetIndexName": index_name,
        "skillsetName": skillset_name,
        "parameters": {
            "batchSize": 1,
            "maxFailedItems": -1,
            "maxFailedItemsPerBatch": -1,
            "configuration": {
                "dataToExtract": "contentAndMetadata",
                "parsingMode": "default",
                "allowSkillsetToReadFileData": True
            }
        }
    }
    
    response = _make_request("PUT", url, body)
    if response.status_code in [200, 201, 204]:
        logger.info(f"✓ Unified Indexer '{indexer_name}' created successfully")
        return True, indexer_name
    else:
        logger.error(f"✗ Failed to create unified indexer: {response.status_code}")
        logger.error(f"Response: {response.text}")
        return False, response.text


def run_unified_indexer(session_uuid: str) -> Tuple[bool, str]:
    """Run the unified indexer"""
    names = _get_unified_resource_names(session_uuid)
    indexer_name = names["indexer"]
    
    logger.info(f"Running UNIFIED indexer '{indexer_name}'")
    
    url = f"{SEARCH_ENDPOINT}/indexers/{indexer_name}/run?api-version={API_VERSION}"
    
    response = _make_request("POST", url)
    if response.status_code in [200, 202, 204]:
        logger.info(f"✓ Unified Indexer '{indexer_name}' started successfully")
        return True, indexer_name
    else:
        logger.error(f"✗ Failed to run unified indexer: {response.status_code}")
        logger.error(f"Response: {response.text}")
        return False, response.text


def delete_unified_index_pipeline(session_uuid: str) -> Tuple[bool, str]:
    """
    Delete the unified indexing pipeline.
    Deletes: indexer -> skillset -> index -> datasource
    """
    names = _get_unified_resource_names(session_uuid)
    errors = []
    
    logger.info(f"=== Deleting UNIFIED index pipeline for session {session_uuid} ===")
    
    for resource_type, resource_key in [
        ("indexers", "indexer"),
        ("skillsets", "skillset"),
        ("indexes", "index"),
        ("datasources", "datasource")
    ]:
        resource_name = names[resource_key]
        url = f"{SEARCH_ENDPOINT}/{resource_type}/{resource_name}?api-version={API_VERSION}"
        response = _make_request("DELETE", url)
        if response.status_code not in [200, 204, 404]:
            errors.append(f"{resource_type} deletion failed: {response.text}")
        else:
            logger.info(f"✓ Deleted {resource_type} '{resource_name}'")
    
    if errors:
        return False, "; ".join(errors)
    
    logger.info(f"=== UNIFIED index pipeline deleted successfully ===")
    return True, "All unified resources deleted"


def delete_course_index_pipeline(session_uuid: str, kb_scope: str = "course") -> Tuple[bool, str]:
    """
    Delete complete indexing pipeline for a course.
    Deletes: indexer -> skillset -> index -> datasource (in reverse order)
    
    Returns: (success, message)
    """
    names = _get_resource_names(session_uuid, kb_scope)
    errors = []
    
    logger.info(f"=== Deleting index pipeline for session {session_uuid} ({kb_scope}) ===")
    
    # Step 1: Delete indexer (must be first)
    indexer_name = names["indexer"]
    url = f"{SEARCH_ENDPOINT}/indexers/{indexer_name}?api-version={API_VERSION}"
    response = _make_request("DELETE", url)
    if response.status_code not in [200, 204, 404]:
        errors.append(f"Indexer deletion failed: {response.text}")
    else:
        logger.info(f"✓ Deleted indexer '{indexer_name}'")
    
    # Step 2: Delete skillset
    skillset_name = names["skillset"]
    url = f"{SEARCH_ENDPOINT}/skillsets/{skillset_name}?api-version={API_VERSION}"
    response = _make_request("DELETE", url)
    if response.status_code not in [200, 204, 404]:
        errors.append(f"Skillset deletion failed: {response.text}")
    else:
        logger.info(f"✓ Deleted skillset '{skillset_name}'")
    
    # Step 3: Delete index
    index_name = names["index"]
    url = f"{SEARCH_ENDPOINT}/indexes/{index_name}?api-version={API_VERSION}"
    response = _make_request("DELETE", url)
    if response.status_code not in [200, 204, 404]:
        errors.append(f"Index deletion failed: {response.text}")
    else:
        logger.info(f"✓ Deleted index '{index_name}'")
    
    # Step 4: Delete datasource
    datasource_name = names["datasource"]
    url = f"{SEARCH_ENDPOINT}/datasources/{datasource_name}?api-version={API_VERSION}"
    response = _make_request("DELETE", url)
    if response.status_code not in [200, 204, 404]:
        errors.append(f"Datasource deletion failed: {response.text}")
    else:
        logger.info(f"✓ Deleted datasource '{datasource_name}'")
    
    if errors:
        return False, "; ".join(errors)
    
    logger.info(f"=== Index pipeline deleted successfully ===")
    return True, "All resources deleted"


def update_course_index(session_uuid: str, kb_scope: str = "course") -> Tuple[bool, str]:
    """
    Update the index by resetting and re-running the indexer.
    Use this after files have been added or removed.
    
    Returns: (success, message)
    """
    logger.info(f"=== Updating index for session {session_uuid} ({kb_scope}) ===")
    
    # Reset indexer to clear tracking data
    success, result = reset_indexer(session_uuid, kb_scope)
    if not success:
        return False, f"Indexer reset failed: {result}"
    
    # Run indexer to reprocess all documents
    success, result = run_indexer(session_uuid, kb_scope)
    if not success:
        return False, f"Indexer run failed: {result}"
    
    return True, "Index update started"


def get_index_name(session_uuid: str, kb_scope: str = "course") -> str:
    """Get the index name for a course"""
    names = _get_resource_names(session_uuid, kb_scope)
    return names["index"]


def check_index_exists(session_uuid: str, kb_scope: str = "course") -> bool:
    """Check if an index exists for a course"""
    names = _get_resource_names(session_uuid, kb_scope)
    index_name = names["index"]
    
    url = f"{SEARCH_ENDPOINT}/indexes/{index_name}?api-version={API_VERSION}"
    response = _make_request("GET", url)
    
    return response.status_code == 200


# =============================================================================
# Agentic Retrieval: Knowledge Sources and Knowledge Bases
# =============================================================================
# UNIFIED APPROACH: One Knowledge Base per session that combines:
# 1. Index Knowledge Source (ALL files: course + exam from a unified index)
# 2. Web Knowledge Source (ALL teacher-curated websites)
# 
# This replaces separate course/exam knowledge sources with a single unified KB.
# =============================================================================

def _get_unified_kb_names(session_uuid: str) -> Dict[str, str]:
    """
    Generate unified Knowledge Source/Base names for a session.
    These are NOT scoped by course/exam - they cover ALL files and links.
    """
    prefix = f"{session_uuid[:32]}"
    return {
        "index_ks": f"{prefix}-unified-index-ks",      # One index KS for all files
        "web_ks": f"{prefix}-unified-web-ks",          # One web KS for all links
        "knowledge_base": f"{prefix}-unified-kb",       # One KB combining both
        "unified_index": f"{prefix}-unified-index",     # Combined index name
    }


def _get_kb_resource_names(session_uuid: str, kb_scope: str = "course") -> Dict[str, str]:
    """
    DEPRECATED: Use _get_unified_kb_names() instead.
    Kept for backward compatibility with existing per-scope code.
    """
    prefix = f"{session_uuid[:32]}-{kb_scope}"
    return {
        "index_ks": f"{prefix}-index-ks",
        "web_ks": f"{prefix}-web-ks",
        "knowledge_base": f"{prefix}-kb",
        "index": f"{prefix}-index",
    }


def create_unified_index_knowledge_source(
    session_uuid: str,
    index_names: list = None
) -> Tuple[bool, str]:
    """
    Create a single Index Knowledge Source that covers multiple indexes.
    
    Since Azure AI Search Knowledge Sources can only reference ONE index,
    we need to either:
    1. Use a unified index (preferred) - all files in one index
    2. Create multiple Index KS and add all to the Knowledge Base
    
    For now, this creates a KS for a unified index that contains all files.
    
    Args:
        session_uuid: The course session UUID
        index_names: List of index names to include (if using multiple)
                    If None, assumes a unified index exists
    """
    names = _get_unified_kb_names(session_uuid)
    ks_name = names["index_ks"]
    
    # If multiple indexes provided, we'll need to create multiple KS
    # For simplicity, default to a unified index approach
    if index_names and len(index_names) > 0:
        # Use the first index for now - TODO: support multiple KS
        index_name = index_names[0]
    else:
        # Assume unified index exists
        index_name = names["unified_index"]
    
    logger.info(f"Creating Unified Index Knowledge Source '{ks_name}' for index '{index_name}'")
    
    url = f"{SEARCH_ENDPOINT}/knowledgesources/{ks_name}?api-version={API_VERSION}"
    
    body = {
        "name": ks_name,
        "kind": "index",
        "description": f"All course materials (course + exam) for session {session_uuid}",
        "indexParameters": {
            "indexName": index_name,
            "titleField": "document_title",
            "contentFields": ["content_text"],
            "filepathField": "content_path",
        }
    }
    
    response = _make_request("PUT", url, body)
    if response.status_code in [200, 201, 204]:
        logger.info(f"✓ Unified Index Knowledge Source '{ks_name}' created successfully")
        return True, ks_name
    else:
        logger.error(f"✗ Failed to create Index Knowledge Source: {response.status_code}")
        logger.error(f"Response: {response.text}")
        return False, response.text


def create_unified_web_knowledge_source(
    session_uuid: str,
    teacher_urls: list = None,
    allowed_domains: list = None,
    blocked_domains: list = None
) -> Tuple[bool, str]:
    """
    Create a single Web Knowledge Source for ALL teacher-curated links.
    
    Args:
        session_uuid: The course session UUID
        teacher_urls: List of full URLs (will be parsed to domains)
                     e.g., ["https://wikipedia.org/wiki/Topic", "https://khanacademy.org/math"]
        allowed_domains: Pre-parsed domain dicts (alternative to teacher_urls)
        blocked_domains: Domains to block
    """
    names = _get_unified_kb_names(session_uuid)
    ks_name = names["web_ks"]
    
    logger.info(f"Creating Unified Web Knowledge Source '{ks_name}'")
    
    # Parse teacher URLs into domains if provided
    if teacher_urls and not allowed_domains:
        allowed_domains = []
        import urllib.parse
        seen_domains = set()
        for url in teacher_urls:
            try:
                parsed = urllib.parse.urlparse(url)
                domain = parsed.netloc.replace("www.", "")
                if domain and domain not in seen_domains:
                    seen_domains.add(domain)
                    allowed_domains.append({
                        "address": domain,
                        "includeSubpages": True
                    })
            except Exception as e:
                logger.warning(f"Could not parse URL '{url}': {e}")
        logger.info(f"Parsed {len(allowed_domains)} unique domains from {len(teacher_urls)} URLs")
    
    # Default educational domains if none provided
    if not allowed_domains:
        allowed_domains = [
            {"address": "wikipedia.org", "includeSubpages": True},
            {"address": "learn.microsoft.com", "includeSubpages": True},
            {"address": "khanacademy.org", "includeSubpages": True},
            {"address": "britannica.com", "includeSubpages": True},
            {"address": "ncert.nic.in", "includeSubpages": True},
        ]
    
    if blocked_domains is None:
        blocked_domains = [
            {"address": "reddit.com", "includeSubpages": True},
            {"address": "quora.com", "includeSubpages": True},
        ]
    
    url = f"{SEARCH_ENDPOINT}/knowledgesources/{ks_name}?api-version={API_VERSION}"
    
    body = {
        "name": ks_name,
        "kind": "web",
        "description": f"All teacher-curated websites for session {session_uuid}",
        "webParameters": {
            "domains": {
                "allowedDomains": allowed_domains,
                "blockedDomains": blocked_domains,
            }
        }
    }
    
    response = _make_request("PUT", url, body)
    if response.status_code in [200, 201, 204]:
        logger.info(f"✓ Unified Web Knowledge Source '{ks_name}' created successfully")
        logger.info(f"  Allowed domains: {[d.get('address') for d in allowed_domains]}")
        return True, ks_name
    else:
        logger.error(f"✗ Failed to create Web Knowledge Source: {response.status_code}")
        logger.error(f"Response: {response.text}")
        return False, response.text


def create_session_knowledge_base(
    session_uuid: str,
    include_web: bool = True,
    index_names: list = None
) -> Tuple[bool, str]:
    """
    Create the unified Knowledge Base for a session.
    Combines the unified index KS and web KS.
    
    Args:
        session_uuid: The course session UUID
        include_web: Whether to include web knowledge source
        index_names: List of existing index names to create KS for
    """
    names = _get_unified_kb_names(session_uuid)
    kb_name = names["knowledge_base"]
    
    logger.info(f"Creating Session Knowledge Base '{kb_name}'")
    
    url = f"{SEARCH_ENDPOINT}/knowledgebases/{kb_name}?api-version={API_VERSION}"
    
    # Build knowledge sources list
    knowledge_sources = [
        {"name": names["index_ks"]}  # Unified index source
    ]
    
    # If we have multiple indexes, add each as a separate KS
    if index_names and len(index_names) > 1:
        # For multiple indexes, we create additional KS entries
        for idx, idx_name in enumerate(index_names[1:], start=2):
            # These would need to be created separately
            ks_suffix = f"{session_uuid[:32]}-index-ks-{idx}"
            knowledge_sources.append({"name": ks_suffix})
    
    if include_web:
        knowledge_sources.append({"name": names["web_ks"]})
    
    body = {
        "name": kb_name,
        "description": f"Unified knowledge base for session {session_uuid} (course + exam materials + web)",
        "knowledgeSources": knowledge_sources,
        "retrievalInstructions": """
        Search for educational content relevant to the student's question.
        This knowledge base contains:
        - Course materials (textbooks, lecture notes)
        - Exam materials (past papers, practice questions)
        - Teacher-curated web resources
        
        Prioritize course/exam materials from uploaded documents.
        Supplement with web sources when documents don't have sufficient information.
        Focus on factual, educational content appropriate for students.
        """,
        "answerInstructions": """
        Provide clear, educational answers based on the retrieved content.
        Cite sources when available (document name or website).
        Explain concepts at a level appropriate for the course.
        If content comes from exam materials, note that it may be from practice questions.
        """,
        "retrievalReasoningEffort": {"kind": "medium"},
        # Note: "chunks" mode not compatible with web knowledge sources
        # Use "grounded" for mixed KB with web sources, or "chunks" for index-only
        "outputMode": "grounded" if include_web else "chunks",
    }
    
    response = _make_request("PUT", url, body)
    if response.status_code in [200, 201, 204]:
        logger.info(f"✓ Session Knowledge Base '{kb_name}' created successfully")
        logger.info(f"  Sources: {[s['name'] for s in knowledge_sources]}")
        return True, kb_name
    else:
        logger.error(f"✗ Failed to create Knowledge Base: {response.status_code}")
        logger.error(f"Response: {response.text}")
        return False, response.text


def create_unified_knowledge_pipeline(
    session_uuid: str,
    teacher_urls: list = None,
    index_names: list = None
) -> Tuple[bool, str]:
    """
    Create the UNIFIED agentic retrieval pipeline for a session:
    1. ONE Index Knowledge Source (covers all course + exam files)
    2. ONE Web Knowledge Source (all teacher-curated URLs)
    3. ONE Knowledge Base (combines both)
    
    This should be called AFTER all indexes are created and populated.
    
    Args:
        session_uuid: The course session UUID
        teacher_urls: List of ALL teacher-curated URLs
        index_names: List of existing index names (e.g., ["{uuid}-course-index", "{uuid}-exam-index"])
                    If None, assumes a unified index exists
        
    Returns:
        (success, knowledge_base_name or error_message)
    """
    logger.info(f"=== Creating UNIFIED Knowledge Pipeline for {session_uuid} ===")
    
    # Step 1: Create Unified Index Knowledge Source
    success, result = create_unified_index_knowledge_source(session_uuid, index_names)
    if not success:
        return False, f"Index KS failed: {result}"
    
    # Step 2: Create Unified Web Knowledge Source (with all teacher URLs)
    include_web = True
    if teacher_urls:
        success, result = create_unified_web_knowledge_source(
            session_uuid, 
            teacher_urls=teacher_urls
        )
        if not success:
            logger.warning(f"Web KS creation failed (optional): {result}")
            include_web = False
    else:
        # No teacher URLs - still create with defaults
        success, result = create_unified_web_knowledge_source(session_uuid)
        if not success:
            logger.warning(f"Web KS creation failed (optional): {result}")
            include_web = False
    
    # Step 3: Create unified Knowledge Base
    success, kb_name = create_session_knowledge_base(
        session_uuid, 
        include_web=include_web,
        index_names=index_names
    )
    if not success:
        return False, f"Knowledge Base failed: {kb_name}"
    
    logger.info(f"=== UNIFIED Knowledge Pipeline created: {kb_name} ===")
    return True, kb_name


def delete_unified_knowledge_pipeline(session_uuid: str) -> Tuple[bool, str]:
    """
    Delete the unified Knowledge Sources and Knowledge Base for a session.
    Call this when deleting a course/agent.
    """
    names = _get_unified_kb_names(session_uuid)
    errors = []
    
    logger.info(f"=== Deleting UNIFIED Knowledge Pipeline for {session_uuid} ===")
    
    # Step 1: Delete Knowledge Base first
    kb_name = names["knowledge_base"]
    url = f"{SEARCH_ENDPOINT}/knowledgebases/{kb_name}?api-version={API_VERSION}"
    response = _make_request("DELETE", url)
    if response.status_code not in [200, 204, 404]:
        errors.append(f"Knowledge Base deletion failed: {response.text}")
    else:
        logger.info(f"✓ Deleted Knowledge Base '{kb_name}'")
    
    # Step 2: Delete Web Knowledge Source
    web_ks = names["web_ks"]
    url = f"{SEARCH_ENDPOINT}/knowledgesources/{web_ks}?api-version={API_VERSION}"
    response = _make_request("DELETE", url)
    if response.status_code not in [200, 204, 404]:
        errors.append(f"Web KS deletion failed: {response.text}")
    else:
        logger.info(f"✓ Deleted Web Knowledge Source '{web_ks}'")
    
    # Step 3: Delete Index Knowledge Source
    index_ks = names["index_ks"]
    url = f"{SEARCH_ENDPOINT}/knowledgesources/{index_ks}?api-version={API_VERSION}"
    response = _make_request("DELETE", url)
    if response.status_code not in [200, 204, 404]:
        errors.append(f"Index KS deletion failed: {response.text}")
    else:
        logger.info(f"✓ Deleted Index Knowledge Source '{index_ks}'")
    
    if errors:
        return False, "; ".join(errors)
    
    logger.info(f"=== UNIFIED Knowledge Pipeline deleted successfully ===")
    return True, "All knowledge resources deleted"


def get_unified_knowledge_base_name(session_uuid: str) -> str:
    """Get the unified Knowledge Base name for a session"""
    names = _get_unified_kb_names(session_uuid)
    return names["knowledge_base"]


def retrieve_from_unified_knowledge_base(
    session_uuid: str,
    query: str,
    top_k: int = 10
) -> Dict[str, Any]:
    """
    Retrieve content from the session's unified Knowledge Base.
    Searches both course/exam materials AND web sources in one query.
    
    Args:
        session_uuid: The course session UUID
        query: The search query
        top_k: Number of results to return
        
    Returns:
        Dict with chunks, answer, and metadata
    """
    names = _get_unified_kb_names(session_uuid)
    kb_name = names["knowledge_base"]
    
    url = f"{SEARCH_ENDPOINT}/knowledgebases/{kb_name}/retrieve?api-version={API_VERSION}"
    
    body = {
        "messages": [{"role": "user", "content": query}],
        "targetQueryType": "semantic",
        "top": top_k,
    }
    
    logger.info(f"Retrieving from Unified Knowledge Base '{kb_name}': {query[:50]}...")
    
    response = _make_request("POST", url, body)
    
    if response.status_code == 200:
        result = response.json()
        resp_data = result.get("response", {})
        chunks = resp_data.get("chunks", [])
        
        logger.info(f"✓ Retrieved {len(chunks)} chunks from unified KB")
        
        return {
            "success": True,
            "chunks": chunks,
            "answer": resp_data.get("answer"),
            "knowledge_base": kb_name,
        }
    else:
        logger.error(f"Retrieval failed: {response.status_code} - {response.text}")
        return {
            "success": False,
            "error": response.text,
            "chunks": [],
        }


# =============================================================================
# LEGACY: Per-scope functions (kept for backward compatibility)
# =============================================================================

def create_index_knowledge_source(session_uuid: str, kb_scope: str = "course") -> Tuple[bool, str]:
    """
    Create an Index Knowledge Source from the course's search index.
    This enables agentic retrieval from the course materials.
    """
    names = _get_kb_resource_names(session_uuid, kb_scope)
    ks_name = names["index_ks"]
    index_name = names["index"]
    
    logger.info(f"Creating Index Knowledge Source '{ks_name}' for index '{index_name}'")
    
    url = f"{SEARCH_ENDPOINT}/knowledgesources/{ks_name}?api-version={API_VERSION}"
    
    body = {
        "name": ks_name,
        "kind": "index",
        "description": f"Course materials for session {session_uuid} ({kb_scope})",
        "indexParameters": {
            "indexName": index_name,
            # Map to the index fields we created
            "titleField": "document_title",
            "contentFields": ["content_text"],
            "filepathField": "content_path",
        }
    }
    
    response = _make_request("PUT", url, body)
    if response.status_code in [200, 201, 204]:
        logger.info(f"✓ Index Knowledge Source '{ks_name}' created successfully")
        return True, ks_name
    else:
        logger.error(f"✗ Failed to create Index Knowledge Source: {response.status_code}")
        logger.error(f"Response: {response.text}")
        return False, response.text


def create_web_knowledge_source(
    session_uuid: str, 
    kb_scope: str = "course",
    allowed_domains: list = None,
    blocked_domains: list = None
) -> Tuple[bool, str]:
    """
    Create a Web Knowledge Source with teacher-curated domains.
    This replaces BingCustomSearchTool with unified retrieval.
    
    Args:
        session_uuid: The course session UUID
        kb_scope: "course" or "exam"
        allowed_domains: List of allowed domain dicts, e.g.:
            [{"address": "wikipedia.org", "include_subpages": True}]
        blocked_domains: List of blocked domain dicts
    """
    names = _get_kb_resource_names(session_uuid, kb_scope)
    ks_name = names["web_ks"]
    
    logger.info(f"Creating Web Knowledge Source '{ks_name}'")
    
    url = f"{SEARCH_ENDPOINT}/knowledgesources/{ks_name}?api-version={API_VERSION}"
    
    # Default educational domains if none provided
    if allowed_domains is None:
        allowed_domains = [
            {"address": "wikipedia.org", "includeSubpages": True},
            {"address": "learn.microsoft.com", "includeSubpages": True},
            {"address": "khanacademy.org", "includeSubpages": True},
            {"address": "britannica.com", "includeSubpages": True},
        ]
    
    if blocked_domains is None:
        blocked_domains = [
            {"address": "reddit.com", "includeSubpages": True},
            {"address": "quora.com", "includeSubpages": True},
        ]
    
    body = {
        "name": ks_name,
        "kind": "web",
        "description": f"Teacher-curated websites for session {session_uuid} ({kb_scope})",
        "webParameters": {
            "domains": {
                "allowedDomains": allowed_domains,
                "blockedDomains": blocked_domains,
            }
        }
    }
    
    response = _make_request("PUT", url, body)
    if response.status_code in [200, 201, 204]:
        logger.info(f"✓ Web Knowledge Source '{ks_name}' created successfully")
        logger.info(f"  Allowed domains: {[d.get('address') for d in allowed_domains]}")
        return True, ks_name
    else:
        logger.error(f"✗ Failed to create Web Knowledge Source: {response.status_code}")
        logger.error(f"Response: {response.text}")
        return False, response.text


def create_unified_knowledge_base(
    session_uuid: str, 
    kb_scope: str = "course",
    include_web: bool = True
) -> Tuple[bool, str]:
    """
    Create a Knowledge Base combining course index and web sources.
    This provides a single retrieval endpoint for the agent.
    
    Args:
        session_uuid: The course session UUID
        kb_scope: "course" or "exam"
        include_web: Whether to include web knowledge source
    """
    names = _get_kb_resource_names(session_uuid, kb_scope)
    kb_name = names["knowledge_base"]
    
    logger.info(f"Creating unified Knowledge Base '{kb_name}'")
    
    url = f"{SEARCH_ENDPOINT}/knowledgebases/{kb_name}?api-version={API_VERSION}"
    
    # Build knowledge sources list
    knowledge_sources = [
        {"name": names["index_ks"]}  # Always include course materials
    ]
    
    if include_web:
        knowledge_sources.append({"name": names["web_ks"]})
    
    body = {
        "name": kb_name,
        "description": f"Unified knowledge for session {session_uuid} ({kb_scope})",
        "knowledgeSources": knowledge_sources,
        "retrievalInstructions": """
        Search for educational content relevant to the student's question.
        Prioritize course materials from the uploaded documents.
        Supplement with curated web sources when course materials are insufficient.
        Focus on factual, educational content appropriate for students.
        """,
        "answerInstructions": """
        Provide clear, educational answers based on the retrieved content.
        Cite sources when available (document name or website).
        Explain concepts at a level appropriate for the course.
        """,
        # Web Knowledge Source requires low or medium reasoning
        "retrievalReasoningEffort": {"kind": "medium"},
        # Note: "chunks" mode not compatible with web knowledge sources
        # Use "grounded" for mixed KB with web sources, or "chunks" for index-only
        "outputMode": "grounded" if include_web else "chunks",
    }
    
    response = _make_request("PUT", url, body)
    if response.status_code in [200, 201, 204]:
        logger.info(f"✓ Knowledge Base '{kb_name}' created successfully")
        logger.info(f"  Sources: {[s['name'] for s in knowledge_sources]}")
        return True, kb_name
    else:
        logger.error(f"✗ Failed to create Knowledge Base: {response.status_code}")
        logger.error(f"Response: {response.text}")
        return False, response.text


def create_full_knowledge_pipeline(
    session_uuid: str,
    kb_scope: str = "course",
    teacher_urls: list = None
) -> Tuple[bool, str]:
    """
    Create the complete agentic retrieval pipeline for a course:
    1. Index Knowledge Source (course files)
    2. Web Knowledge Source (teacher-curated URLs)
    3. Unified Knowledge Base
    
    This should be called AFTER the index is created and populated.
    
    Args:
        session_uuid: The course session UUID
        kb_scope: "course" or "exam"
        teacher_urls: List of teacher-curated URLs (e.g., ["https://wikipedia.org/wiki/Topic"])
        
    Returns:
        (success, knowledge_base_name or error_message)
    """
    logger.info(f"=== Creating Knowledge Pipeline for {session_uuid} ({kb_scope}) ===")
    
    # Parse teacher URLs into domain format
    allowed_domains = None
    if teacher_urls:
        allowed_domains = []
        import urllib.parse
        for url in teacher_urls:
            parsed = urllib.parse.urlparse(url)
            domain = parsed.netloc.replace("www.", "")
            if domain:
                allowed_domains.append({
                    "address": domain,
                    "includeSubpages": True
                })
        logger.info(f"Parsed {len(allowed_domains)} domains from teacher URLs")
    
    # Step 1: Create Index Knowledge Source
    success, result = create_index_knowledge_source(session_uuid, kb_scope)
    if not success:
        return False, f"Index KS failed: {result}"
    
    # Step 2: Create Web Knowledge Source (with teacher domains)
    success, result = create_web_knowledge_source(
        session_uuid, kb_scope, 
        allowed_domains=allowed_domains if allowed_domains else None
    )
    if not success:
        logger.warning(f"Web KS creation failed (optional): {result}")
        # Continue without web - just use index
        include_web = False
    else:
        include_web = True
    
    # Step 3: Create unified Knowledge Base
    success, kb_name = create_unified_knowledge_base(
        session_uuid, kb_scope, 
        include_web=include_web
    )
    if not success:
        return False, f"Knowledge Base failed: {kb_name}"
    
    logger.info(f"=== Knowledge Pipeline created: {kb_name} ===")
    return True, kb_name


def delete_knowledge_pipeline(session_uuid: str, kb_scope: str = "course") -> Tuple[bool, str]:
    """
    Delete all Knowledge Sources and Knowledge Base for a course.
    Call this when deleting a course/agent.
    """
    names = _get_kb_resource_names(session_uuid, kb_scope)
    errors = []
    
    logger.info(f"=== Deleting Knowledge Pipeline for {session_uuid} ({kb_scope}) ===")
    
    # Step 1: Delete Knowledge Base first (it references the sources)
    kb_name = names["knowledge_base"]
    url = f"{SEARCH_ENDPOINT}/knowledgebases/{kb_name}?api-version={API_VERSION}"
    response = _make_request("DELETE", url)
    if response.status_code not in [200, 204, 404]:
        errors.append(f"Knowledge Base deletion failed: {response.text}")
    else:
        logger.info(f"✓ Deleted Knowledge Base '{kb_name}'")
    
    # Step 2: Delete Web Knowledge Source
    web_ks = names["web_ks"]
    url = f"{SEARCH_ENDPOINT}/knowledgesources/{web_ks}?api-version={API_VERSION}"
    response = _make_request("DELETE", url)
    if response.status_code not in [200, 204, 404]:
        errors.append(f"Web KS deletion failed: {response.text}")
    else:
        logger.info(f"✓ Deleted Web Knowledge Source '{web_ks}'")
    
    # Step 3: Delete Index Knowledge Source
    index_ks = names["index_ks"]
    url = f"{SEARCH_ENDPOINT}/knowledgesources/{index_ks}?api-version={API_VERSION}"
    response = _make_request("DELETE", url)
    if response.status_code not in [200, 204, 404]:
        errors.append(f"Index KS deletion failed: {response.text}")
    else:
        logger.info(f"✓ Deleted Index Knowledge Source '{index_ks}'")
    
    if errors:
        return False, "; ".join(errors)
    
    logger.info(f"=== Knowledge Pipeline deleted successfully ===")
    return True, "All knowledge resources deleted"


def get_knowledge_base_name(session_uuid: str, kb_scope: str = "course") -> str:
    """Get the Knowledge Base name for a course"""
    names = _get_kb_resource_names(session_uuid, kb_scope)
    return names["knowledge_base"]


def retrieve_from_knowledge_base(
    session_uuid: str,
    kb_scope: str,
    query: str,
    top_k: int = 10
) -> Dict[str, Any]:
    """
    Retrieve content from the course's unified Knowledge Base.
    
    Args:
        session_uuid: The course session UUID
        kb_scope: "course" or "exam"
        query: The search query
        top_k: Number of results to return
        
    Returns:
        Dict with chunks, answer, and metadata
    """
    names = _get_kb_resource_names(session_uuid, kb_scope)
    kb_name = names["knowledge_base"]
    
    url = f"{SEARCH_ENDPOINT}/knowledgebases/{kb_name}/retrieve?api-version={API_VERSION}"
    
    body = {
        "messages": [{"role": "user", "content": query}],
        "targetQueryType": "semantic",
        "top": top_k,
    }
    
    logger.info(f"Retrieving from Knowledge Base '{kb_name}': {query[:50]}...")
    
    response = _make_request("POST", url, body)
    
    if response.status_code == 200:
        result = response.json()
        resp_data = result.get("response", {})
        chunks = resp_data.get("chunks", [])
        
        logger.info(f"✓ Retrieved {len(chunks)} chunks")
        
        return {
            "success": True,
            "chunks": chunks,
            "answer": resp_data.get("answer"),
            "knowledge_base": kb_name,
        }
    else:
        logger.error(f"Retrieval failed: {response.status_code} - {response.text}")
        return {
            "success": False,
            "error": response.text,
            "chunks": [],
        }


# =============================================================================
# SDK-BASED KNOWLEDGE SOURCE AND KNOWLEDGE BASE MANAGEMENT
# Uses azure-search-documents SDK for cleaner API
# =============================================================================

def _get_mcp_resource_names(session_uuid: str) -> Dict[str, str]:
    """
    Generate resource names for MCP-based Knowledge Base pipeline.
    Includes both Blob Knowledge Source and Web Knowledge Source.
    """
    prefix = f"{session_uuid[:32]}"
    return {
        "blob_knowledge_source": f"{prefix}-blob-ks", # Blob knowledge source (replaces index)
        "knowledge_source": f"{prefix}-ks",           # Legacy: Index knowledge source
        "web_knowledge_source": f"{prefix}-web-ks",   # Web knowledge source for URLs
        "knowledge_base": f"{prefix}-kb",
        "project_connection": f"{prefix}-mcp-conn",
        "index": f"{prefix}-unified-index",
    }


def create_blob_knowledge_source_sdk(session_uuid: str) -> Tuple[bool, str]:
    """
    Create a Blob Knowledge Source that directly connects to Azure Blob Storage.
    
    This is simpler than the index pipeline approach - no need for:
    - Datasource, Skillset, Index, Indexer
    
    The blob knowledge source handles:
    - Document chunking
    - Vectorization (embeddings)
    - Content extraction
    
    All files for the session are in: sessions/{session_uuid}/
    """
    from azure.search.documents.indexes import SearchIndexClient
    from azure.search.documents.indexes.models import (
        AzureBlobKnowledgeSource,
        AzureBlobKnowledgeSourceParameters,
        KnowledgeBaseAzureOpenAIModel,
        AzureOpenAIVectorizerParameters,
        KnowledgeSourceAzureOpenAIVectorizer,
        KnowledgeSourceContentExtractionMode,
        KnowledgeSourceIngestionParameters,
    )
    
    names = _get_mcp_resource_names(session_uuid)
    ks_name = names["blob_knowledge_source"]
    
    # Folder path in blob storage for this session's files
    folder_path = f"sessions/{session_uuid}/"
    
    logger.info(f"Creating Blob Knowledge Source '{ks_name}'")
    logger.info(f"  Container: {BLOB_CONTAINER}")
    logger.info(f"  Folder: {folder_path}")
    
    try:
        from common_azure_auth import get_sync_credential
        credential = get_sync_credential()
        index_client = SearchIndexClient(endpoint=SEARCH_ENDPOINT, credential=credential)
        
        # Get blob connection string from environment
        # Prefer ResourceId format for managed identity authentication
        blob_connection_string = os.getenv("AZURE_STORAGE_CONNECTION_STRING")
        if not blob_connection_string:
            # Build ResourceId format for managed identity auth
            # Format: ResourceId=/subscriptions/{sub}/resourceGroups/{rg}/providers/Microsoft.Storage/storageAccounts/{account}
            blob_connection_string = (
                f"ResourceId=/subscriptions/{SUBSCRIPTION_ID}/resourceGroups/{RESOURCE_GROUP}"
                f"/providers/Microsoft.Storage/storageAccounts/{STORAGE_ACCOUNT}"
            )
            logger.info(f"Using ResourceId connection string for managed identity auth")
        
        # Azure OpenAI parameters for chat completion (summarization/verbalization)
        # Must be a GPT model like gpt-4o, gpt-4o-mini, etc.
        chat_aoai_params = AzureOpenAIVectorizerParameters(
            resource_url=FOUNDRY_ENDPOINT,
            model_name=CHAT_MODEL,
            deployment_name=CHAT_MODEL,
        )
        
        # Azure OpenAI parameters for embeddings
        embedding_aoai_params = AzureOpenAIVectorizerParameters(
            resource_url=FOUNDRY_ENDPOINT,
            model_name=EMBEDDING_MODEL,
            deployment_name=EMBEDDING_MODEL,
        )
        
        # Create blob knowledge source
        blob_ks = AzureBlobKnowledgeSource(
            name=ks_name,
            description=f"Blob storage knowledge source for session {session_uuid} (course + exam materials)",
            azure_blob_parameters=AzureBlobKnowledgeSourceParameters(
                connection_string=blob_connection_string,
                container_name=BLOB_CONTAINER,
                folder_path=folder_path,
                is_adls_gen2=False,
                ingestion_parameters=KnowledgeSourceIngestionParameters(
                    disable_image_verbalization=False,
                    # Use Azure OpenAI GPT model for chat completion (summarization)
                    chat_completion_model=KnowledgeBaseAzureOpenAIModel(
                        azure_open_ai_parameters=chat_aoai_params
                    ),
                    # Use Azure OpenAI embedding model for embeddings
                    embedding_model=KnowledgeSourceAzureOpenAIVectorizer(
                        azure_open_ai_parameters=embedding_aoai_params
                    ),
                    # Minimal extraction - let Azure handle the heavy lifting
                    content_extraction_mode=KnowledgeSourceContentExtractionMode.MINIMAL,
                    ingestion_schedule=None,  # Manual ingestion
                )
            )
        )
        
        index_client.create_or_update_knowledge_source(knowledge_source=blob_ks)
        logger.info(f"✓ Blob Knowledge Source '{ks_name}' created successfully")
        return True, ks_name
        
    except Exception as e:
        logger.error(f"✗ Failed to create Blob Knowledge Source: {e}")
        import traceback
        logger.error(traceback.format_exc())
        return False, str(e)


def create_knowledge_source_sdk(session_uuid: str) -> Tuple[bool, str]:
    """
    Create a Knowledge Source that references the unified index using SDK.
    
    A Knowledge Source is a reusable reference to source data (the index).
    """
    from azure.search.documents.indexes import SearchIndexClient
    from azure.search.documents.indexes.models import (
        SearchIndexFieldReference,
        SearchIndexKnowledgeSource,
        SearchIndexKnowledgeSourceParameters,
    )
    
    names = _get_mcp_resource_names(session_uuid)
    ks_name = names["knowledge_source"]
    index_name = names["index"]
    
    logger.info(f"Creating Knowledge Source '{ks_name}' for index '{index_name}'")
    
    try:
        from common_azure_auth import get_sync_credential
        credential = get_sync_credential()
        index_client = SearchIndexClient(endpoint=SEARCH_ENDPOINT, credential=credential)
        
        # Create knowledge source pointing to the unified index
        ks = SearchIndexKnowledgeSource(
            name=ks_name,
            description=f"Knowledge source for session {session_uuid}",
            search_index_parameters=SearchIndexKnowledgeSourceParameters(
                search_index_name=index_name,
                # Include readable fields for citations (exclude embeddings)
                source_data_fields=[
                    SearchIndexFieldReference(name="document_title"),
                    SearchIndexFieldReference(name="content_path"),
                    SearchIndexFieldReference(name="page_number"),
                ]
            ),
        )
        
        index_client.create_or_update_knowledge_source(knowledge_source=ks)
        logger.info(f"✓ Knowledge Source '{ks_name}' created successfully")
        return True, ks_name
        
    except Exception as e:
        logger.error(f"✗ Failed to create Knowledge Source: {e}")
        return False, str(e)


def create_web_knowledge_source_sdk(
    session_uuid: str,
    teacher_urls: list = None,
) -> Tuple[bool, str]:
    """
    Create a Web Knowledge Source for teacher-curated URLs using SDK.
    
    This allows the agent to search web content from specific domains.
    
    Args:
        session_uuid: The course session UUID
        teacher_urls: List of full URLs (will be parsed to domains)
                     e.g., ["https://wikipedia.org/wiki/Topic", "https://khanacademy.org/math"]
    
    Returns: (success, web_ks_name or error)
    """
    from azure.search.documents.indexes import SearchIndexClient
    from azure.search.documents.indexes.models import (
        WebKnowledgeSource,
        WebKnowledgeSourceParameters,
        WebKnowledgeSourceDomains,
    )
    
    names = _get_mcp_resource_names(session_uuid)
    web_ks_name = names["web_knowledge_source"]
    
    logger.info(f"Creating Web Knowledge Source '{web_ks_name}'")
    
    # Parse teacher URLs into domain objects
    allowed_domains = []
    if teacher_urls:
        import urllib.parse
        seen_domains = set()
        for url in teacher_urls:
            try:
                parsed = urllib.parse.urlparse(url)
                domain = parsed.netloc.replace("www.", "")
                if domain and domain not in seen_domains:
                    seen_domains.add(domain)
                    allowed_domains.append({
                        "address": domain,
                        "include_subpages": True
                    })
            except Exception as e:
                logger.warning(f"Could not parse URL '{url}': {e}")
        logger.info(f"Parsed {len(allowed_domains)} unique domains from {len(teacher_urls)} URLs")
    
    # Default educational domains if none provided
    if not allowed_domains:
        allowed_domains = [
            {"address": "wikipedia.org", "include_subpages": True},
            {"address": "learn.microsoft.com", "include_subpages": True},
            {"address": "khanacademy.org", "include_subpages": True},
            {"address": "britannica.com", "include_subpages": True},
            {"address": "ncert.nic.in", "include_subpages": True},
        ]
    
    # Default blocked domains
    blocked_domains = [
        {"address": "reddit.com", "include_subpages": True},
        {"address": "quora.com", "include_subpages": True},
    ]
    
    try:
        from common_azure_auth import get_sync_credential
        credential = get_sync_credential()
        index_client = SearchIndexClient(endpoint=SEARCH_ENDPOINT, credential=credential)
        
        # Create Web Knowledge Source
        web_ks = WebKnowledgeSource(
            name=web_ks_name,
            description=f"Teacher-curated web sources for session {session_uuid}",
            web_parameters=WebKnowledgeSourceParameters(
                domains=WebKnowledgeSourceDomains(
                    allowed_domains=allowed_domains,
                    blocked_domains=blocked_domains,
                )
            ),
        )
        
        index_client.create_or_update_knowledge_source(knowledge_source=web_ks)
        logger.info(f"✓ Web Knowledge Source '{web_ks_name}' created successfully")
        logger.info(f"  Allowed domains: {[d.get('address') for d in allowed_domains]}")
        return True, web_ks_name
        
    except Exception as e:
        logger.error(f"✗ Failed to create Web Knowledge Source: {e}")
        return False, str(e)


def create_knowledge_base_sdk(
    session_uuid: str,
    include_web: bool = True,
    teacher_urls: list = None,
    use_blob_source: bool = True,
) -> Tuple[bool, str, str]:
    """
    Create a Knowledge Base that orchestrates retrieval from Knowledge Sources.
    
    Includes:
    1. Blob or Index Knowledge Source (for uploaded documents)
    2. Web Knowledge Source (for teacher-curated URLs) - optional
    
    Args:
        session_uuid: The course session UUID
        include_web: Whether to include web knowledge source
        teacher_urls: List of URLs to include in web knowledge source
        use_blob_source: If True, use blob KS. If False, use index KS.
    
    Returns: (success, kb_name, mcp_endpoint)
    """
    from azure.search.documents.indexes import SearchIndexClient
    from azure.search.documents.indexes.models import (
        KnowledgeBase,
        KnowledgeBaseAzureOpenAIModel,
        KnowledgeRetrievalMinimalReasoningEffort,
        KnowledgeRetrievalOutputMode,
        KnowledgeSourceReference,
        AzureOpenAIVectorizerParameters,
    )
    
    names = _get_mcp_resource_names(session_uuid)
    kb_name = names["knowledge_base"]
    web_ks_name = names["web_knowledge_source"]
    
    # Choose the appropriate knowledge source
    if use_blob_source:
        ks_name = names["blob_knowledge_source"]
    else:
        ks_name = names["knowledge_source"]
    
    # Build list of knowledge sources
    knowledge_sources = [KnowledgeSourceReference(name=ks_name)]
    
    # Determine output mode based on whether web KS will be included
    # - GROUNDED: Works with both blob and web knowledge sources
    # - EXTRACTIVE_DATA: Higher fidelity but doesn't support web KS
    use_grounded_mode = False
    
    # Optionally create and add Web Knowledge Source
    if include_web and teacher_urls:
        web_success, web_result = create_web_knowledge_source_sdk(
            session_uuid=session_uuid,
            teacher_urls=teacher_urls,
        )
        if web_success:
            knowledge_sources.append(KnowledgeSourceReference(name=web_ks_name))
            use_grounded_mode = True  # Must use GROUNDED mode for web KS compatibility
            logger.info(f"✓ Added Web Knowledge Source '{web_ks_name}' to KB")
        else:
            logger.warning(f"Web Knowledge Source creation failed (optional): {web_result}")
    
    logger.info(f"Creating Knowledge Base '{kb_name}' with {len(knowledge_sources)} source(s)")
    
    try:
        from common_azure_auth import get_sync_credential
        credential = get_sync_credential()
        index_client = SearchIndexClient(endpoint=SEARCH_ENDPOINT, credential=credential)
        
        # Choose output mode:
        # - ANSWER_SYNTHESIS: Required when web KS is included (synthesizes/summarizes content)
        # - EXTRACTIVE_DATA: Higher fidelity verbatim content (blob/index only)
        output_mode = (
            KnowledgeRetrievalOutputMode.ANSWER_SYNTHESIS 
            if use_grounded_mode 
            else KnowledgeRetrievalOutputMode.EXTRACTIVE_DATA
        )
        
        logger.info(f"  Output mode: {output_mode}")
        
        # Build models list - required for ANSWER_SYNTHESIS mode
        kb_models = None
        if use_grounded_mode:
            # ANSWER_SYNTHESIS requires a chat model for summarization
            chat_model_params = AzureOpenAIVectorizerParameters(
                resource_url=FOUNDRY_ENDPOINT,
                model_name=CHAT_MODEL,
                deployment_name=CHAT_MODEL,
            )
            kb_models = [
                KnowledgeBaseAzureOpenAIModel(
                    azure_open_ai_parameters=chat_model_params
                )
            ]
            logger.info(f"  Chat model: {CHAT_MODEL}")
        
        # Create knowledge base
        knowledge_base = KnowledgeBase(
            name=kb_name,
            knowledge_sources=knowledge_sources,
            output_mode=output_mode,
            models=kb_models,
            # minimal effort bypasses LLM query planning (lower cost/latency)
            retrieval_reasoning_effort=KnowledgeRetrievalMinimalReasoningEffort(),
        )
        
        index_client.create_or_update_knowledge_base(knowledge_base=knowledge_base)
        
        # Build MCP endpoint URL
        mcp_endpoint = f"{SEARCH_ENDPOINT}/knowledgebases/{kb_name}/mcp?api-version={API_VERSION}"
        
        logger.info(f"✓ Knowledge Base '{kb_name}' created successfully")
        logger.info(f"  Knowledge Sources: {[ks.name for ks in knowledge_sources]}")
        logger.info(f"  MCP Endpoint: {mcp_endpoint}")
        
        return True, kb_name, mcp_endpoint
        
    except Exception as e:
        logger.error(f"✗ Failed to create Knowledge Base: {e}")
        return False, str(e), ""


def create_mcp_project_connection(
    session_uuid: str,
    project_resource_id: str,
    mcp_endpoint: str,
    api_key: str = None,
) -> Tuple[bool, str]:
    """
    Create a project connection in Microsoft Foundry that points to the MCP endpoint.
    
    This enables the agent to communicate with the Knowledge Base via MCP.
    Uses Project Managed Identity authentication with Azure AI Search audience.
    
    Args:
        session_uuid: Course session UUID
        project_resource_id: Full ARM resource ID of the Foundry project
        mcp_endpoint: The MCP endpoint URL of the Knowledge Base
        api_key: Not used - MCP endpoints require Azure AD tokens, not API keys
        
    Returns: (success, connection_name)
    """
    from common_azure_auth import get_sync_credential
    
    names = _get_mcp_resource_names(session_uuid)
    connection_name = names["project_connection"]
    
    logger.info(f"Creating MCP project connection '{connection_name}' with Project Managed Identity auth")
    
    try:
        credential = get_sync_credential()
        # Get token directly instead of using bearer_token_provider (avoids file locking)
        token = credential.get_token("https://management.azure.com/.default")
        
        headers = {
            "Authorization": f"Bearer {token.token}",
            "Content-Type": "application/json",
        }
        
        # Create RemoteTool connection via ARM API with ProjectManagedIdentity auth
        # The audience is critical - it tells the agent service what token to request
        url = f"https://management.azure.com{project_resource_id}/connections/{connection_name}?api-version=2025-10-01-preview"
        
        body = {
            "name": connection_name,
            "type": "Microsoft.MachineLearningServices/workspaces/connections",
            "properties": {
                "authType": "ProjectManagedIdentity",
                "category": "RemoteTool",
                "target": mcp_endpoint,
                "isSharedToAll": True,
                "useWorkspaceManagedIdentity": True,
                # Audience tells the agent service to get a token for Azure AI Search
                "audience": "https://search.azure.com",
                "metadata": {"ApiType": "Azure"},
            },
        }
        
        response = requests.put(url, headers=headers, json=body)
        response.raise_for_status()
        
        logger.info(f"✓ MCP Project Connection '{connection_name}' created with Project Managed Identity (audience: https://search.azure.com)")
        return True, connection_name
        
    except Exception as e:
        logger.error(f"✗ Failed to create MCP project connection: {e}")
        return False, str(e)


def _get_search_api_key_from_connection(project_resource_id: str) -> Optional[str]:
    """
    Fetch the Azure AI Search API key from an existing connection in the project.
    Looks for connections like 'aisearchswapnikb42nv9' that have API key auth.
    """
    from common_azure_auth import get_sync_credential
    
    try:
        credential = get_sync_credential()
        token = credential.get_token("https://management.azure.com/.default")
        
        headers = {
            "Authorization": f"Bearer {token.token}",
        }
        
        # List all connections to find a CognitiveSearch one with ApiKey
        list_url = f"https://management.azure.com{project_resource_id}/connections?api-version=2025-06-01"
        response = requests.get(list_url, headers=headers)
        
        if response.status_code != 200:
            logger.warning(f"Failed to list connections: {response.status_code}")
            return None
        
        connections = response.json().get("value", [])
        
        # Find a CognitiveSearch connection with ApiKey auth
        for conn in connections:
            props = conn.get("properties", {})
            if props.get("category") == "CognitiveSearch" and props.get("authType") == "ApiKey":
                conn_name = conn.get("name")
                logger.info(f"Found CognitiveSearch connection with API key: {conn_name}")
                
                # Get secrets for this connection
                secrets_url = f"https://management.azure.com{project_resource_id}/connections/{conn_name}/listsecrets?api-version=2025-06-01"
                secrets_response = requests.post(secrets_url, headers=headers)
                
                if secrets_response.status_code == 200:
                    secrets = secrets_response.json()
                    api_key = secrets.get("properties", {}).get("credentials", {}).get("key")
                    if api_key:
                        logger.info(f"Retrieved API key from connection '{conn_name}'")
                        return api_key
        
        logger.warning("No CognitiveSearch connection with API key found")
        return None
        
    except Exception as e:
        logger.error(f"Error fetching API key from connection: {e}")
        return None


def delete_mcp_project_connection(
    session_uuid: str,
    project_resource_id: str,
) -> Tuple[bool, str]:
    """
    Delete the MCP project connection.
    """
    from common_azure_auth import get_sync_credential
    
    names = _get_mcp_resource_names(session_uuid)
    connection_name = names["project_connection"]
    
    logger.info(f"Deleting MCP project connection '{connection_name}'")
    
    try:
        credential = get_sync_credential()
        token = credential.get_token("https://management.azure.com/.default")
        
        headers = {
            "Authorization": f"Bearer {token.token}",
        }
        
        url = f"https://management.azure.com{project_resource_id}/connections/{connection_name}?api-version=2025-10-01-preview"
        
        response = requests.delete(url, headers=headers)
        
        if response.status_code in [200, 204, 404]:
            logger.info(f"✓ MCP Project Connection '{connection_name}' deleted")
            return True, connection_name
        else:
            response.raise_for_status()
            return True, connection_name
            
    except Exception as e:
        logger.error(f"✗ Failed to delete MCP project connection: {e}")
        return False, str(e)


def delete_knowledge_base_sdk(session_uuid: str) -> Tuple[bool, str]:
    """
    Delete the Knowledge Base.
    """
    from azure.search.documents.indexes import SearchIndexClient
    
    names = _get_mcp_resource_names(session_uuid)
    kb_name = names["knowledge_base"]
    
    logger.info(f"Deleting Knowledge Base '{kb_name}'")
    
    try:
        from common_azure_auth import get_sync_credential
        credential = get_sync_credential()
        index_client = SearchIndexClient(endpoint=SEARCH_ENDPOINT, credential=credential)
        
        index_client.delete_knowledge_base(kb_name)
        logger.info(f"✓ Knowledge Base '{kb_name}' deleted")
        return True, kb_name
        
    except Exception as e:
        logger.error(f"✗ Failed to delete Knowledge Base: {e}")
        return False, str(e)


def delete_knowledge_source_sdk(session_uuid: str) -> Tuple[bool, str]:
    """
    Delete the Knowledge Source.
    """
    from azure.search.documents.indexes import SearchIndexClient
    
    names = _get_mcp_resource_names(session_uuid)
    ks_name = names["knowledge_source"]
    
    logger.info(f"Deleting Knowledge Source '{ks_name}'")
    
    try:
        from common_azure_auth import get_sync_credential
        credential = get_sync_credential()
        index_client = SearchIndexClient(endpoint=SEARCH_ENDPOINT, credential=credential)
        
        index_client.delete_knowledge_source(knowledge_source=ks_name)
        logger.info(f"✓ Knowledge Source '{ks_name}' deleted")
        return True, ks_name
        
    except Exception as e:
        logger.error(f"✗ Failed to delete Knowledge Source: {e}")
        return False, str(e)


def create_full_mcp_pipeline(
    session_uuid: str,
    project_resource_id: str,
    teacher_urls: list = None,
    use_blob_source: bool = True,
) -> Tuple[bool, Dict[str, Any]]:
    """
    Create the full MCP pipeline for a course.
    
    Two modes:
    1. Blob Source (use_blob_source=True) - RECOMMENDED, simpler:
       - Create Blob Knowledge Source (directly from blob storage)
       - Create Knowledge Base
       - Create MCP Project Connection
       
    2. Index Source (use_blob_source=False) - legacy:
       - Create unified index pipeline (datasource, skillset, index, indexer)
       - Create Index Knowledge Source
       - Create Knowledge Base
       - Create MCP Project Connection
    
    Args:
        session_uuid: Course session UUID
        project_resource_id: Full ARM resource ID of the Foundry project
        teacher_urls: Optional list of teacher-curated URLs for web knowledge source
        use_blob_source: If True, use blob knowledge source (simpler). If False, use index.
    
    Returns: (success, result_dict)
    """
    logger.info(f"=== Creating full MCP pipeline for session {session_uuid} ===")
    logger.info(f"  Mode: {'Blob Knowledge Source' if use_blob_source else 'Index Pipeline'}")
    
    result = {
        "session_uuid": session_uuid,
        "knowledge_source": None,
        "knowledge_base": None,
        "mcp_endpoint": None,
        "project_connection": None,
    }
    
    names = _get_mcp_resource_names(session_uuid)
    
    if use_blob_source:
        # SIMPLER APPROACH: Use blob knowledge source directly
        # No need for datasource, skillset, index, indexer!
        
        # Step 1: Create Blob Knowledge Source
        success, ks_name = create_blob_knowledge_source_sdk(session_uuid)
        if not success:
            return False, {"error": f"Blob Knowledge Source creation failed: {ks_name}"}
        result["knowledge_source"] = ks_name
        
    else:
        # LEGACY APPROACH: Create index pipeline first
        result["index_name"] = names["index"]
        
        # Step 1a: Create unified index pipeline
        success, msg = create_unified_index_pipeline(session_uuid)
        if not success and "already exists" not in msg.lower():
            logger.error(f"Failed to create index: {msg}")
            return False, {"error": f"Index creation failed: {msg}"}
        
        # Step 1b: Create Index Knowledge Source
        success, ks_name = create_knowledge_source_sdk(session_uuid)
        if not success:
            return False, {"error": f"Knowledge Source creation failed: {ks_name}"}
        result["knowledge_source"] = ks_name
    
    # Step 2: Create Knowledge Base (with optional Web Knowledge Source for teacher URLs)
    success, kb_name, mcp_endpoint = create_knowledge_base_sdk(
        session_uuid,
        include_web=True,
        teacher_urls=teacher_urls,
        use_blob_source=use_blob_source,  # Tell KB which KS to use
    )
    if not success:
        return False, {"error": f"Knowledge Base creation failed: {kb_name}"}
    result["knowledge_base"] = kb_name
    result["mcp_endpoint"] = mcp_endpoint
    
    # Step 3: Create MCP Project Connection
    success, conn_name = create_mcp_project_connection(
        session_uuid, project_resource_id, mcp_endpoint
    )
    if not success:
        return False, {"error": f"Project connection creation failed: {conn_name}"}
    result["project_connection"] = conn_name
    
    logger.info(f"=== MCP pipeline created successfully ===")
    logger.info(f"  Knowledge Source: {result['knowledge_source']}")
    logger.info(f"  Knowledge Base: {kb_name}")
    logger.info(f"  MCP Endpoint: {mcp_endpoint}")
    logger.info(f"  Project Connection: {conn_name}")
    
    return True, result


def delete_full_mcp_pipeline(
    session_uuid: str,
    project_resource_id: str,
) -> Tuple[bool, Dict[str, Any]]:
    """
    Delete the full MCP pipeline for a course.
    Deletes in reverse order: connection -> KB -> KS -> index
    """
    logger.info(f"=== Deleting full MCP pipeline for session {session_uuid} ===")
    
    results = {
        "project_connection": None,
        "knowledge_base": None,
        "knowledge_source": None,
        "index": None,
    }
    
    # Delete in reverse order
    success, msg = delete_mcp_project_connection(session_uuid, project_resource_id)
    results["project_connection"] = "deleted" if success else f"failed: {msg}"
    
    success, msg = delete_knowledge_base_sdk(session_uuid)
    results["knowledge_base"] = "deleted" if success else f"failed: {msg}"
    
    success, msg = delete_knowledge_source_sdk(session_uuid)
    results["knowledge_source"] = "deleted" if success else f"failed: {msg}"
    
    success, msg = delete_unified_index_pipeline(session_uuid)
    results["index"] = "deleted" if success else f"failed: {msg}"
    
    all_success = all("deleted" in str(v) for v in results.values())
    
    logger.info(f"=== MCP pipeline deletion complete ===")
    return all_success, results


def get_mcp_endpoint(session_uuid: str) -> str:
    """
    Get the MCP endpoint URL for a session's Knowledge Base.
    """
    names = _get_mcp_resource_names(session_uuid)
    kb_name = names["knowledge_base"]
    return f"{SEARCH_ENDPOINT}/knowledgebases/{kb_name}/mcp?api-version={API_VERSION}"


def get_project_connection_name(session_uuid: str) -> str:
    """
    Get the project connection name for a session.
    """
    names = _get_mcp_resource_names(session_uuid)
    return names["project_connection"]


# =============================================================================
# COMMON INDEX: Shared index pipeline for ALL sessions
# =============================================================================
# Instead of creating per-session datasource/index/skillset/indexer (4N resources),
# we create ONE shared set (4 total) and use a `session_id` field + OData filter
# for per-session data isolation via AzureAISearchTool.
#
# Benefits:
# - 4 resources total instead of 4N (avoids S1 50-resource limits)
# - Unlimited sessions (within storage)
# - Web search handled by BingGroundingTool/BingCustomSearchTool (already on agents)
# - No per-session KS, KB, or MCP connection needed
# =============================================================================


def _create_common_datasource() -> Tuple[bool, str]:
    """
    Create the shared datasource that points to ALL session files.
    Points to: sessions/ (covers all session subfolders).
    Uses system-assigned managed identity for authentication.
    """
    subscription_id = os.getenv("AZURE_SUBSCRIPTION_ID", SUBSCRIPTION_ID)
    resource_group = os.getenv("AZURE_RESOURCE_GROUP", RESOURCE_GROUP)
    storage_account = os.getenv("STORAGE_ACCOUNT_NAME", STORAGE_ACCOUNT)
    blob_container = os.getenv("AZURE_AI_SEARCH_BLOB_CONTAINER", BLOB_CONTAINER)
    search_endpoint = os.getenv("AZURE_AI_SEARCH_ENDPOINT", SEARCH_ENDPOINT)

    # Resource ID format for managed identity auth
    storage_connection = (
        f"ResourceId=/subscriptions/{subscription_id}/resourceGroups/{resource_group}"
        f"/providers/Microsoft.Storage/storageAccounts/{storage_account}/;"
    )

    blob_prefix = "sessions/"

    logger.info(f"Creating COMMON datasource '{COMMON_DATASOURCE_NAME}' for path: {blob_prefix}")

    url = f"{search_endpoint}/datasources/{COMMON_DATASOURCE_NAME}?api-version={API_VERSION}"

    body = {
        "name": COMMON_DATASOURCE_NAME,
        "description": "Shared datasource for ALL session files (course + exam)",
        "type": "azureblob",
        "credentials": {"connectionString": storage_connection},
        "container": {
            "name": blob_container,
            "query": blob_prefix,
        },
        # Enable native blob soft delete detection
        # When blobs are deleted, indexer will automatically remove them from the index
        "dataDeletionDetectionPolicy": {
            "@odata.type": "#Microsoft.Azure.Search.NativeBlobSoftDeleteDeletionDetectionPolicy"
        },
    }

    response = _make_request("PUT", url, body)
    if response.status_code in [200, 201, 204]:
        logger.info(f"✓ Common Datasource '{COMMON_DATASOURCE_NAME}' created")
        return True, COMMON_DATASOURCE_NAME
    elif response.status_code == 409:
        # Resource exists with conflicting update - treat as success for idempotency
        logger.info(f"✓ Common Datasource '{COMMON_DATASOURCE_NAME}' already exists (409)")
        return True, COMMON_DATASOURCE_NAME
    else:
        logger.error(f"✗ Failed to create common datasource: {response.status_code} - {response.text}")
        return False, response.text


def _create_common_index() -> Tuple[bool, str]:
    """
    Create the shared search index with a session_id field for filtering.
    Same schema as the per-session unified index + session_id.
    """
    search_endpoint = os.getenv("AZURE_AI_SEARCH_ENDPOINT", SEARCH_ENDPOINT)

    logger.info(f"Creating COMMON index '{COMMON_INDEX_NAME}'")

    url = f"{search_endpoint}/indexes/{COMMON_INDEX_NAME}?api-version={API_VERSION}"

    body = {
        "name": COMMON_INDEX_NAME,
        "fields": [
            {
                "name": "content_id",
                "type": "Edm.String",
                "key": True,
                "retrievable": True,
                "analyzer": "keyword",
            },
            {
                "name": "text_document_id",
                "type": "Edm.String",
                "searchable": False,
                "filterable": True,
                "retrievable": True,
            },
            {
                "name": "document_title",
                "type": "Edm.String",
                "searchable": True,
                "retrievable": True,
            },
            {
                "name": "image_document_id",
                "type": "Edm.String",
                "filterable": True,
                "retrievable": True,
            },
            {
                "name": "content_text",
                "type": "Edm.String",
                "searchable": True,
                "retrievable": True,
            },
            {
                "name": "content_embedding",
                "type": "Collection(Edm.Single)",
                "dimensions": EMBEDDING_DIMENSIONS,
                "searchable": True,
                "retrievable": True,
                "vectorSearchProfile": "hnsw",
            },
            {
                "name": "content_path",
                "type": "Edm.String",
                "searchable": False,
                "retrievable": True,
            },
            {
                "name": "page_number",
                "type": "Edm.Int32",
                "searchable": False,
                "retrievable": True,
                "filterable": True,
            },
            # Chunk index within the document (0-based position in text_sections array)
            {
                "name": "chunk_index",
                "type": "Edm.Int32",
                "searchable": False,
                "retrievable": True,
                "filterable": True,
                "sortable": True,
            },
            # Track file category (course/exam)
            {
                "name": "file_category",
                "type": "Edm.String",
                "searchable": False,
                "retrievable": True,
                "filterable": True,
                "facetable": True,
            },
            # SESSION ID for per-session filtering via AzureAISearchTool
            {
                "name": "session_id",
                "type": "Edm.String",
                "searchable": False,
                "retrievable": True,
                "filterable": True,
                "facetable": True,
            },
            # LOGICAL SECTION for sub-document filtering (e.g., "Question Paper 12", "Chapter 3")
            # Populated from section headings detected by Document Intelligence
            {
                "name": "logical_section",
                "type": "Edm.String",
                "searchable": True,
                "retrievable": True,
                "filterable": True,
                "facetable": True,
            },
            # CONTENT TYPE: "text" for text chunks (default), "image" for extracted images
            {
                "name": "content_type",
                "type": "Edm.String",
                "searchable": False,
                "retrievable": True,
                "filterable": True,
                "facetable": True,
            },
            # IMAGE BLOB PATH: relative path to the image in the image container
            # Only populated for content_type="image" records
            {
                "name": "image_blob_path",
                "type": "Edm.String",
                "searchable": False,
                "retrievable": True,
            },
        ],
        "vectorSearch": {
            "profiles": [
                {
                    "name": "hnsw",
                    "algorithm": "defaulthnsw",
                    "vectorizer": "openai-vectorizer",
                }
            ],
            "algorithms": [
                {
                    "name": "defaulthnsw",
                    "kind": "hnsw",
                    "hnswParameters": {
                        "m": 4,
                        "efConstruction": 400,
                        "metric": "cosine",
                    },
                }
            ],
            "vectorizers": [
                {
                    "name": "openai-vectorizer",
                    "kind": "azureOpenAI",
                    "azureOpenAIParameters": {
                        "resourceUri": FOUNDRY_ENDPOINT,
                        "deploymentId": EMBEDDING_MODEL,
                        "modelName": EMBEDDING_MODEL,
                    },
                }
            ],
        },
        "semantic": {
            "defaultConfiguration": "semantic-config",
            "configurations": [
                {
                    "name": "semantic-config",
                    "prioritizedFields": {
                        "titleField": {"fieldName": "document_title"},
                        "prioritizedContentFields": [
                            {"fieldName": "content_text"}
                        ],
                    },
                }
            ],
        },
    }

    response = _make_request("PUT", url, body)
    if response.status_code in [200, 201, 204]:
        logger.info(f"✓ Common Index '{COMMON_INDEX_NAME}' created")
        return True, COMMON_INDEX_NAME
    else:
        logger.error(f"✗ Failed to create common index: {response.status_code} - {response.text}")
        return False, response.text


def _create_common_skillset() -> Tuple[bool, str]:
    """
    Create the shared skillset for document processing and embedding.
    
    Uses DocumentIntelligenceLayoutSkill for:
    - Text extraction and chunking (including OCR for scanned documents)
    - Location metadata (page numbers) from Document Intelligence
    
    Image extraction is handled separately at upload time
    (see extract_and_index_images) to give structured blob paths
    and direct index records that the agent can discover.
    
    Custom blob metadata (session, kb_scope) is accessed via /document/<key> paths
    (NOT /document/metadata_<key> - the metadata_ prefix is only for standard properties).
    """
    search_endpoint = os.getenv("AZURE_AI_SEARCH_ENDPOINT", SEARCH_ENDPOINT)

    logger.info(f"Creating COMMON skillset '{COMMON_SKILLSET_NAME}'")

    url = f"{search_endpoint}/skillsets/{COMMON_SKILLSET_NAME}?api-version={API_VERSION}"

    body = {
        "name": COMMON_SKILLSET_NAME,
        "description": "Document Intelligence Layout for text extraction and Azure OpenAI embeddings",
        "skills": [
            # Document Intelligence Layout Skill - Extract text with OCR and page numbers
            {
                "@odata.type": "#Microsoft.Skills.Util.DocumentIntelligenceLayoutSkill",
                "name": "document-layout-skill",
                "description": "Extract text from documents using Document Intelligence OCR",
                "context": "/document",
                "outputMode": "oneToMany",
                "outputFormat": "text",
                "chunkingProperties": {
                    "unit": "characters",
                    "maximumLength": 2000,
                    "overlapLength": 200,
                },
                "inputs": [
                    {"name": "file_data", "source": "/document/file_data"}
                ],
                "outputs": [
                    {"name": "text_sections", "targetName": "text_sections"},
                ],
            },
            # Text Embedding Skill - Create embeddings for each text chunk
            {
                "@odata.type": "#Microsoft.Skills.Text.AzureOpenAIEmbeddingSkill",
                "name": "text-embedding-skill",
                "description": f"Create embeddings using {EMBEDDING_MODEL}",
                "context": "/document/text_sections/*",
                "resourceUri": FOUNDRY_ENDPOINT,
                "deploymentId": EMBEDDING_MODEL,
                "modelName": EMBEDDING_MODEL,
                "dimensions": EMBEDDING_DIMENSIONS,
                "inputs": [
                    {"name": "text", "source": "/document/text_sections/*/content"}
                ],
                "outputs": [
                    {"name": "embedding", "targetName": "text_vector"}
                ],
            },
        ],
        "cognitiveServices": {
            "@odata.type": "#Microsoft.Azure.Search.AIServicesByIdentity",
            "subdomainUrl": FOUNDRY_ENDPOINT,
        },
        "indexProjections": {
            "selectors": [
                {
                    "targetIndexName": COMMON_INDEX_NAME,
                    "parentKeyFieldName": "text_document_id",
                    "sourceContext": "/document/text_sections/*",
                    "mappings": [
                        # Chunk content and embedding
                        {
                            "name": "content_text",
                            "source": "/document/text_sections/*/content",
                        },
                        {
                            "name": "content_embedding",
                            "source": "/document/text_sections/*/text_vector",
                        },
                        # Location metadata (page number from DI Layout)
                        {
                            "name": "page_number",
                            "source": "/document/text_sections/*/locationMetadata/pageNumber",
                        },
                        # Standard blob metadata (with metadata_ prefix)
                        {
                            "name": "document_title",
                            "source": "/document/metadata_storage_name",
                        },
                        {
                            "name": "content_path",
                            "source": "/document/metadata_storage_path",
                        },
                        # Custom blob metadata (WITHOUT metadata_ prefix - use original key names)
                        # Blob metadata key "session" -> accessible as /document/session
                        {
                            "name": "session_id",
                            "source": "/document/session",
                        },
                        # Blob metadata key "kb_scope" -> accessible as /document/kb_scope
                        {
                            "name": "file_category",
                            "source": "/document/kb_scope",
                        },
                    ],
                }
            ],
            "parameters": {
                "projectionMode": "skipIndexingParentDocuments"
            },
        },
    }

    response = _make_request("PUT", url, body)
    if response.status_code in [200, 201, 204]:
        logger.info(f"✓ Common Skillset '{COMMON_SKILLSET_NAME}' created")
        return True, COMMON_SKILLSET_NAME
    else:
        logger.error(f"✗ Failed to create common skillset: {response.status_code} - {response.text}")
        return False, response.text


def _create_common_indexer() -> Tuple[bool, str]:
    """
    Create the shared indexer connecting common datasource → common index via common skillset.
    """
    search_endpoint = os.getenv("AZURE_AI_SEARCH_ENDPOINT", SEARCH_ENDPOINT)

    logger.info(f"Creating COMMON indexer '{COMMON_INDEXER_NAME}'")

    url = f"{search_endpoint}/indexers/{COMMON_INDEXER_NAME}?api-version={API_VERSION}"

    body = {
        "name": COMMON_INDEXER_NAME,
        "description": "Shared indexer for ALL session files — triggered on-demand after file changes",
        "dataSourceName": COMMON_DATASOURCE_NAME,
        "targetIndexName": COMMON_INDEX_NAME,
        "skillsetName": COMMON_SKILLSET_NAME,
        "parameters": {
            "maxFailedItems": -1,
            "maxFailedItemsPerBatch": 0,
            "batchSize": 1,
            "configuration": {
                "allowSkillsetToReadFileData": True,
                # Run in private environment to enable managed identity auth
                "executionEnvironment": "private",
            },
        },
        "fieldMappings": [
            {
                "sourceFieldName": "metadata_storage_name",
                "targetFieldName": "document_title",
            },
            # Note: session_id and file_category come from blob custom metadata
            # via skillset projections using /document/metadata_session and /document/metadata_kb_scope
        ],
        # No outputFieldMappings - only child chunks are indexed (no parent documents)
    }

    response = _make_request("PUT", url, body)
    if response.status_code in [200, 201, 204]:
        logger.info(f"✓ Common Indexer '{COMMON_INDEXER_NAME}' created")
        return True, COMMON_INDEXER_NAME
    else:
        logger.error(f"✗ Failed to create common indexer: {response.status_code} - {response.text}")
        return False, response.text


def ensure_common_index_pipeline() -> Tuple[bool, str]:
    """
    Ensure the shared index pipeline exists (idempotent).
    Creates datasource → index → skillset → indexer if they don't already exist.
    Uses PUT which is create-or-update, so safe to call multiple times.
    Caches result in-memory to skip redundant calls within same process.

    Returns: (success, common_index_name or error)
    """
    global _pipeline_ensured
    
    # Skip if already ensured in this process instance
    if _pipeline_ensured:
        logger.info("=== Common index pipeline already ensured (cached) ===")
        return True, COMMON_INDEX_NAME
    
    logger.info("=== Ensuring common index pipeline exists ===")

    # Step 1: Datasource
    success, result = _create_common_datasource()
    if not success:
        return False, f"Common datasource failed: {result}"

    # Step 2: Index
    success, result = _create_common_index()
    if not success:
        return False, f"Common index failed: {result}"

    # Step 3: Skillset
    success, result = _create_common_skillset()
    if not success:
        return False, f"Common skillset failed: {result}"

    # Step 4: Indexer
    success, result = _create_common_indexer()
    if not success:
        return False, f"Common indexer failed: {result}"

    logger.info(f"=== Common index pipeline ready: {COMMON_INDEX_NAME} ===")
    _pipeline_ensured = True  # Cache successful creation
    return True, COMMON_INDEX_NAME


def run_common_indexer() -> Tuple[bool, str]:
    """Run the shared indexer to process new/changed documents."""
    search_endpoint = os.getenv("AZURE_AI_SEARCH_ENDPOINT", SEARCH_ENDPOINT)

    logger.info(f"Running COMMON indexer '{COMMON_INDEXER_NAME}'")

    url = f"{search_endpoint}/indexers/{COMMON_INDEXER_NAME}/run?api-version={API_VERSION}"
    response = _make_request("POST", url)

    if response.status_code in [200, 202, 204]:
        logger.info(f"✓ Common Indexer '{COMMON_INDEXER_NAME}' started")
        return True, COMMON_INDEXER_NAME
    else:
        logger.error(f"✗ Failed to run common indexer: {response.status_code} - {response.text}")
        return False, response.text


def reset_and_run_common_indexer() -> Tuple[bool, str]:
    """Reset then run the shared indexer (reprocesses ALL documents)."""
    search_endpoint = os.getenv("AZURE_AI_SEARCH_ENDPOINT", SEARCH_ENDPOINT)

    logger.info(f"Resetting COMMON indexer '{COMMON_INDEXER_NAME}'")

    url = f"{search_endpoint}/indexers/{COMMON_INDEXER_NAME}/reset?api-version={API_VERSION}"
    response = _make_request("POST", url)
    if response.status_code not in [200, 204]:
        logger.warning(f"Reset failed (may be running): {response.status_code}")

    return run_common_indexer()


def get_common_indexer_status() -> Dict[str, Any]:
    """Get the status of the common indexer."""
    search_endpoint = os.getenv("AZURE_AI_SEARCH_ENDPOINT", SEARCH_ENDPOINT)
    url = f"{search_endpoint}/indexers/{COMMON_INDEXER_NAME}/status?api-version={API_VERSION}"
    response = _make_request("GET", url)
    if response.status_code == 200:
        return response.json()
    return {"error": response.text, "status_code": response.status_code}


def get_common_index_name() -> str:
    """Return the common index name."""
    return COMMON_INDEX_NAME


def get_common_image_container() -> str:
    """Return the blob container name where extracted images are stored."""
    return COMMON_IMAGE_CONTAINER


def get_session_filter(session_uuid: str) -> str:
    """
    Build an OData filter expression for a specific session.
    Used with AzureAISearchTool's filter parameter.
    """
    return f"session_id eq '{session_uuid}'"


def extract_and_index_images(
    file_bytes: bytes,
    filename: str,
    session_uuid: str,
    kb_scope: str,
    content_type: str = "application/pdf",
) -> Dict[str, Any]:
    """
    Extract images from a document using Document Intelligence and:
    1. Store each image in the image blob container with structured paths
    2. Push image records into the common search index so the agent discovers them

    This runs at upload time (not via the indexer) so we have full control
    over blob naming and index record content.

    Args:
        file_bytes: Raw file bytes (PDF, PPTX, etc.)
        filename: Original filename for human-readable blob paths
        session_uuid: Session UUID for partitioning
        kb_scope: "course" or "exam"
        content_type: MIME type of the file

    Returns:
        Dict with extracted_count, indexed_count, and image_paths
    """
    import base64
    import hashlib
    import re
    from io import BytesIO

    logger.info(f"Extracting images from '{filename}' for session {session_uuid[:8]}...")

    # --- Step 1: Call Document Intelligence to extract images ---
    di_endpoint = os.environ["DOCUMENT_INTELLIGENCE_ENDPOINT"]

    try:
        from azure.ai.documentintelligence import DocumentIntelligenceClient
        from azure.identity import DefaultAzureCredential

        credential = DefaultAzureCredential()
        di_client = DocumentIntelligenceClient(
            endpoint=di_endpoint, credential=credential
        )
    except Exception as e:
        logger.error(f"Failed to create DI client: {e}")
        return {"extracted_count": 0, "indexed_count": 0, "image_paths": [], "error": str(e)}

    try:
        poller = di_client.begin_analyze_document(
            model_id="prebuilt-layout",
            body=BytesIO(file_bytes),
            content_type=content_type,
            output_content_format="text",
        )
        result = poller.result()
    except Exception as e:
        logger.error(f"DI analysis failed for '{filename}': {e}")
        return {"extracted_count": 0, "indexed_count": 0, "image_paths": [], "error": str(e)}

    # Check if result contains figures with bounding regions
    figures = getattr(result, "figures", None) or []
    if not figures:
        logger.info(f"No figures/images found in '{filename}'")
        return {"extracted_count": 0, "indexed_count": 0, "image_paths": []}

    logger.info(f"Found {len(figures)} figures in '{filename}'")

    # --- Step 2: Store images in blob with structured paths ---
    from azure.storage.blob import BlobServiceClient, ContentSettings

    storage_account = os.getenv("STORAGE_ACCOUNT_NAME", STORAGE_ACCOUNT)
    try:
        from common_azure_auth import get_sync_credential
        cred = get_sync_credential()
    except ImportError:
        cred = DefaultAzureCredential()

    blob_service = BlobServiceClient(
        account_url=f"https://{storage_account}.blob.core.windows.net",
        credential=cred,
    )

    # Ensure image container exists
    container_client = blob_service.get_container_client(COMMON_IMAGE_CONTAINER)
    try:
        if not container_client.exists():
            container_client.create_container()
            logger.info(f"Created image container: {COMMON_IMAGE_CONTAINER}")
    except Exception as e:
        logger.warning(f"Could not check/create image container: {e}")

    # Create a slug from the filename for readable blob paths
    name_stem = re.sub(r"[^a-zA-Z0-9_-]", "_", filename.rsplit(".", 1)[0])[:60]

    image_records = []
    image_paths = []

    for idx, figure in enumerate(figures):
        # Get page number from bounding regions
        page_num = None
        if hasattr(figure, "bounding_regions") and figure.bounding_regions:
            page_num = figure.bounding_regions[0].page_number

        # Try to get the image content from the figure's ID
        # DI Layout returns figure IDs; we need to render/crop from the PDF page
        # For now, capture the figure caption and bounding region metadata
        figure_caption = getattr(figure, "caption", None)
        caption_text = ""
        if figure_caption and hasattr(figure_caption, "content"):
            caption_text = figure_caption.content

        # Construct a descriptive content_text for the search index
        desc_parts = [f"[Figure from page {page_num}]" if page_num else "[Figure]"]
        if caption_text:
            desc_parts.append(f"Caption: {caption_text}")
        desc_parts.append(f"Source: {filename}")
        figure_content_text = " | ".join(desc_parts)

        # Blob path: {session}/{doc_slug}/page{N}_fig{M}.png
        blob_name = f"{session_uuid}/{name_stem}/page{page_num or 0}_fig{idx}.json"
        blob_path = blob_name

        # Store figure metadata as JSON (bounding box, caption, page reference)
        # The actual rendering will be done by the frontend using the source PDF
        figure_meta = {
            "source_document": filename,
            "session_uuid": session_uuid,
            "page_number": page_num,
            "figure_index": idx,
            "caption": caption_text,
            "content_path": f"sessions/{session_uuid}/{kb_scope}/{filename}",
        }

        if hasattr(figure, "bounding_regions") and figure.bounding_regions:
            br = figure.bounding_regions[0]
            figure_meta["bounding_polygon"] = (
                [p.__dict__ if hasattr(p, "__dict__") else p for p in br.polygon]
                if hasattr(br, "polygon") and br.polygon
                else None
            )

        try:
            import json

            meta_bytes = json.dumps(figure_meta, default=str).encode("utf-8")
            blob_client = container_client.get_blob_client(blob_path)
            blob_client.upload_blob(
                meta_bytes,
                overwrite=True,
                content_settings=ContentSettings(content_type="application/json"),
            )
            image_paths.append(blob_path)
        except Exception as e:
            logger.warning(f"Failed to upload figure metadata {blob_path}: {e}")
            continue

        # Build index record
        doc_hash = hashlib.sha256(
            f"{session_uuid}_{filename}_fig{idx}".encode()
        ).hexdigest()[:16]

        image_records.append(
            {
                "@search.action": "mergeOrUpload",
                "content_id": f"img-{doc_hash}",
                "content_type": "image",
                "content_text": figure_content_text,
                "document_title": filename,
                "page_number": page_num,
                "session_id": session_uuid,
                "file_category": kb_scope,
                "image_blob_path": blob_path,
                "content_path": f"sessions/{session_uuid}/{kb_scope}/{filename}",
            }
        )

    # --- Step 3: Push image records to the search index ---
    indexed_count = 0
    if image_records:
        search_endpoint = os.getenv("AZURE_AI_SEARCH_ENDPOINT", SEARCH_ENDPOINT)
        index_url = f"{search_endpoint}/indexes/{COMMON_INDEX_NAME}/docs/index?api-version={API_VERSION}"

        # Batch in chunks of 1000
        for i in range(0, len(image_records), 1000):
            batch = image_records[i : i + 1000]
            body = {"value": batch}
            try:
                response = _make_request("POST", index_url, body)
                if response.status_code in [200, 207]:
                    indexed_count += len(batch)
                    logger.info(f"  Indexed {len(batch)} image records")
                else:
                    logger.error(
                        f"  Failed to index image batch: {response.status_code} - {response.text}"
                    )
            except Exception as e:
                logger.error(f"  Failed to push image records to index: {e}")

    logger.info(
        f"✓ Extracted {len(figures)} figures, stored {len(image_paths)} blobs, indexed {indexed_count} records"
    )

    return {
        "extracted_count": len(figures),
        "indexed_count": indexed_count,
        "image_paths": image_paths,
    }


def delete_session_documents(session_uuid: str) -> Tuple[bool, str]:
    """
    Delete all documents belonging to a session from the common index.
    Call this when an agent/session is deleted.

    Steps:
    1. Search for all document keys with session_id == session_uuid
    2. Batch-delete them from the index
    """
    search_endpoint = os.getenv("AZURE_AI_SEARCH_ENDPOINT", SEARCH_ENDPOINT)

    logger.info(f"Deleting documents for session {session_uuid} from common index")

    # Step 1: Find all document keys with this session_id
    search_url = f"{search_endpoint}/indexes/{COMMON_INDEX_NAME}/docs/search?api-version={API_VERSION}"
    search_body = {
        "filter": f"session_id eq '{session_uuid}'",
        "select": "content_id",
        "top": 10000,  # Max batch
    }

    response = _make_request("POST", search_url, search_body)
    if response.status_code != 200:
        logger.error(f"Failed to search for session docs: {response.status_code} - {response.text}")
        return False, response.text

    results = response.json()
    docs = results.get("value", [])

    if not docs:
        logger.info(f"No documents found for session {session_uuid}")
        return True, "No documents to delete"

    logger.info(f"Found {len(docs)} documents to delete for session {session_uuid}")

    # Step 2: Batch-delete in chunks of 1000
    total_deleted = 0
    for i in range(0, len(docs), 1000):
        batch = docs[i : i + 1000]
        delete_actions = [
            {"@search.action": "delete", "content_id": doc["content_id"]}
            for doc in batch
        ]

        delete_url = f"{search_endpoint}/indexes/{COMMON_INDEX_NAME}/docs/index?api-version={API_VERSION}"
        delete_body = {"value": delete_actions}

        del_response = _make_request("POST", delete_url, delete_body)
        if del_response.status_code in [200, 207]:
            total_deleted += len(batch)
            logger.info(f"  Deleted batch {i // 1000 + 1}: {len(batch)} documents")
        else:
            logger.error(f"  Batch delete failed: {del_response.status_code} - {del_response.text}")
            return False, f"Batch delete failed: {del_response.text}"

    logger.info(f"✓ Deleted {total_deleted} documents for session {session_uuid}")

    # Step 3: Clean up extracted image blobs for this session
    try:
        from azure.storage.blob import BlobServiceClient

        storage_account = os.getenv("STORAGE_ACCOUNT_NAME", STORAGE_ACCOUNT)
        try:
            from common_azure_auth import get_sync_credential
            cred = get_sync_credential()
        except ImportError:
            from azure.identity import DefaultAzureCredential
            cred = DefaultAzureCredential()

        blob_service = BlobServiceClient(
            account_url=f"https://{storage_account}.blob.core.windows.net",
            credential=cred,
        )
        container_client = blob_service.get_container_client(COMMON_IMAGE_CONTAINER)
        if container_client.exists():
            deleted_blobs = 0
            for blob in container_client.list_blobs(name_starts_with=f"{session_uuid}/"):
                container_client.delete_blob(blob.name)
                deleted_blobs += 1
            if deleted_blobs:
                logger.info(f"  Also deleted {deleted_blobs} image blobs for session {session_uuid}")
    except Exception as img_err:
        logger.warning(f"  Image blob cleanup failed (non-fatal): {img_err}")

    return True, f"Deleted {total_deleted} documents"

