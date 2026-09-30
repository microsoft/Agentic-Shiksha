# azure_services/storage

Azure Blob Storage access — course materials, generated media, and the curriculum
archives written by [../persistence/curriculum_git.py](../persistence/curriculum_git.py).

| Module | Purpose |
| --- | --- |
| [blob_storage_manager.py](blob_storage_manager.py) | Container and blob operations: upload, download, list, delete, and URL construction. |

The account name comes from `STORAGE_ACCOUNT_NAME`, and access uses Microsoft Entra ID
rather than a connection string, so the calling identity needs a data-plane role such as
**Storage Blob Data Contributor**. The legacy `*_CONNECTION_STRING` variables in
`.env.example` exist for compatibility and are not the supported path.

The legacy `POST /api/blob/create-vector-store` and
`POST /api/async/create-vector-store` routes share the cached `AsyncFileProcessor`
and its Azure AI Agents vector-store client. Blob URI sources use the SDK's
`create_and_poll` operation off the event loop; creation is not automatically
retried. The JSON route returns `success: false` with a generic error on Azure or
polling failures, without exposing service exception details. Course retrieval
continues to use Azure AI Search rather than these legacy vector stores.
