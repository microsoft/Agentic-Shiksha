import { readFileSync } from "node:fs";

const services = {
  blob: ["Azure Blob Storage", "azure-blob-storage.svg"],
  foundry: ["Microsoft Foundry", "microsoft-foundry.svg"],
  search: ["Azure AI Search", "azure-ai-search.svg"],
  cosmos: ["Azure Cosmos DB", "azure-cosmos-db.svg"],
  "document-intelligence": ["Azure Document Intelligence", "azure-document-intelligence.svg"],
  speech: ["Azure AI Speech", "azure-ai-speech.svg"],
  "storage-account": ["Azure Storage account", "azure-storage-account.svg"],
};

export const azureServiceIcons = Object.freeze(Object.fromEntries(
  Object.entries(services).map(([key, [label, filename]]) => [key, Object.freeze({
    label,
    filename,
    dataUri: `data:image/svg+xml;base64,${readFileSync(new URL(`../../images/azure-icons/${filename}`, import.meta.url)).toString("base64")}`,
  })]),
));

export function azureServiceIcon(service, x, y, size) {
  if (!Object.hasOwn(azureServiceIcons, service)) throw new Error(`Unknown Azure service icon: ${service}`);
  const icon = azureServiceIcons[service];
  if (![x, y, size].every(Number.isFinite) || size <= 0) throw new Error("Invalid Azure icon bounds");
  return `<image data-azure-icon="${service}" aria-label="${icon.label}" x="${x}" y="${y}" width="${size}" height="${size}" preserveAspectRatio="xMidYMid meet" href="${icon.dataUri}"/>`;
}
