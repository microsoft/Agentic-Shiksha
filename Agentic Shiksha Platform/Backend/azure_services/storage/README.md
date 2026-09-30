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
