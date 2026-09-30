# Official Azure service icons

Official Microsoft architecture icons for diagrams, training material and
documentation. These are product/service symbols, **not Agentic Shiksha branding**
and not general-purpose Microsoft corporate wordmarks.

Downloaded on **2026-09-30** from the
[Azure Architecture Center](https://learn.microsoft.com/en-us/azure/architecture/icons/),
using its [Azure Public Service Icons V24 archive](https://arch-center.azureedge.net/icons/Azure_Public_Service_Icons_V24.zip).
The source page identifies the current icon update as July 2026.

## Downloads

[Download the complete selected-icon bundle](../../web/azure-icons/azure-icons.zip), or use the
individual files below. SVGs are byte-for-byte originals with descriptive local
filenames. PNGs are 1024 x 1024 transparent exports, preserving the full original
view box, proportions and colors.

| Preview | Product/service | SVG | PNG |
| --- | --- | --- | --- |
| <img src="azure-blob-storage.svg" width="48" height="48" alt="Azure Blob Storage block-blob icon"> | Azure Blob Storage: block blob | [SVG](azure-blob-storage.svg) | [PNG](azure-blob-storage.png) |
| <img src="microsoft-foundry.svg" width="48" height="48" alt="Microsoft Foundry icon"> | Microsoft Foundry | [SVG](microsoft-foundry.svg) | [PNG](microsoft-foundry.png) |
| <img src="azure-ai-search.svg" width="48" height="48" alt="Azure AI Search icon"> | Azure AI Search | [SVG](azure-ai-search.svg) | [PNG](azure-ai-search.png) |
| <img src="azure-cosmos-db.svg" width="48" height="48" alt="Azure Cosmos DB icon"> | Azure Cosmos DB | [SVG](azure-cosmos-db.svg) | [PNG](azure-cosmos-db.png) |
| <img src="azure-document-intelligence.svg" width="48" height="48" alt="Azure Document Intelligence icon"> | Azure Document Intelligence | [SVG](azure-document-intelligence.svg) | [PNG](azure-document-intelligence.png) |
| <img src="azure-ai-speech.svg" width="48" height="48" alt="Azure AI Speech icon"> | Azure AI Speech | [SVG](azure-ai-speech.svg) | [PNG](azure-ai-speech.png) |
| <img src="azure-storage-account.svg" width="48" height="48" alt="Azure Storage account icon"> | Storage account: alternative for account-level diagrams | [SVG](azure-storage-account.svg) | [PNG](azure-storage-account.png) |

The pack uses some historical filenames. These have not been mistaken for
different services or redrawn:

| Local basename | Official archive path under `Azure_Public_Service_Icons/Icons/` |
| --- | --- |
| `azure-blob-storage` | `general/10780-icon-service-Blob-Block.svg` |
| `microsoft-foundry` | `ai + machine learning/035746832-icon-service-AI-Foundry.svg` |
| `azure-ai-search` | `ai + machine learning/10044-icon-service-Cognitive-Search.svg` |
| `azure-cosmos-db` | `databases/10121-icon-service-Azure-Cosmos-DB.svg` |
| `azure-document-intelligence` | `ai + machine learning/00819-icon-service-Form-Recognizers.svg` |
| `azure-ai-speech` | `ai + machine learning/00797-icon-service-Speech-Services.svg` |
| `azure-storage-account` | `storage/10086-icon-service-Storage-Accounts.svg` |

The block-blob symbol is the resource-specific choice for Blob Storage. Use the
separately named storage-account alternative when the diagram refers to an entire
account rather than a blob.

## Usage and attribution

Microsoft's icon terms permit copying, distributing and displaying these icons
in architectural diagrams, training materials and documentation. Other uses need
the appropriate Microsoft permission. The icons do not inherit the repository's
MIT license.

- Keep product names near their icons in diagrams.
- Preserve the artwork: no recoloring, cropping, rotation, mirroring or distortion.
- Do not use a Microsoft product icon to represent your own product or suggest
  Microsoft endorsement.
- Retain the [bundled Microsoft terms](Microsoft_Terms_of_Use.pdf), copied unchanged
  from the official pack, and consult the
  [source usage guidelines](https://learn.microsoft.com/en-us/azure/architecture/icons/#icon-terms)
  for the current rules.

Archive SHA-256:
`921594ccd1bf3d9c0a1bd7b6d924e050551a59342f2b353bb74bdcf761c35141`.

These files are downloaded documentation assets only. They do not change
application branding, connect to Azure resources or deploy services.

## Diagram embedding

[diagram-icons.mjs](../../web/azure-icons/diagram-icons.mjs) supplies original-icon data URIs and
`azureServiceIcon(service, x, y, size)` for the architecture/research generators.
It embeds the SVG bytes unchanged and uses a square image viewport with
`preserveAspectRatio="xMidYMid meet"`. Never apply recoloring, cropping or rotation
to the returned image. Motion exports serialize the same icon data into their
offline galleries before rendering scenes.

Run the dependency-free integrity checks from repository root:

```powershell
node --test assets\web\azure-icons\diagram-icons.test.mjs
```

Use these marks only on nodes for the corresponding Microsoft service. Generic
application components, learner concepts and evidence states retain their own
non-product symbols.

Return to the [documentation-image index](../README.md).
