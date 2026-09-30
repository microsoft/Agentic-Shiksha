# Azure icon embedding

[diagram-icons.mjs](diagram-icons.mjs) reads the unmodified official Microsoft
SVGs from [images/azure-icons](../../images/azure-icons/README.md) and exposes
data URIs plus `azureServiceIcon(service, x, y, size)` for diagram generators.
Generated images are self-contained and preserve the source colors/proportions.

```powershell
# From repository root
node --test assets\web\azure-icons\diagram-icons.test.mjs
```

The [tests](diagram-icons.test.mjs) compare the decoded embedded bytes to the
originals, reject unknown services or invalid geometry, and check logo coverage
in all five generated Atlas views and their overview. Use explicit service
keys rather than replacing generic application or pedagogical symbols.

Original assets, previews and Microsoft usage terms remain with the
[icon collection](../../images/azure-icons/README.md). The icons do not inherit
the project code license. This helper does not contact Azure or change branding.
