import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import test from "node:test";
import { azureServiceIcon, azureServiceIcons } from "./diagram-icons.mjs";

const officialHashes = {
  blob: "649cdb593d0c7f56a227e4c28df40a3e5c489e303867d32502af2ee4b4865ea3",
  foundry: "fab039a771f72780ae34e59065d61c66a02d3c347d50923ef2956f34912ea02c",
  search: "f7af1213ce089236593835cb5564d6d3f01358cba6488fe562aa8bbc8adc3b38",
  cosmos: "b6f1f2afac15762d1de44366d34984c5a3e6e58f94d9e81407ac01565212e8e3",
  "document-intelligence": "196e5db33e32027349ee7250df79dfaf96b65e57a30a98662e6dd08d6d0c7360",
  speech: "3f758eccdf371534309a50e8688bd75e685246f80485a741588d13bef69a7eb3",
  "storage-account": "7190d3bb14ce30ce74bd0af873915830fe821e8c5f6ef6f3149e6f7cfb2aa4f7",
};

test("all seven embedded service icons preserve the original SVG bytes", () => {
  assert.equal(Object.keys(azureServiceIcons).length, 7);
  for (const [service, icon] of Object.entries(azureServiceIcons)) {
    const original = readFileSync(new URL(`../../images/azure-icons/${icon.filename}`, import.meta.url));
    assert.equal(createHash("sha256").update(original).digest("hex"), officialHashes[service]);
    assert(icon.dataUri.startsWith("data:image/svg+xml;base64,"));
    assert.deepEqual(
      Buffer.from(icon.dataUri.split(",")[1], "base64"),
      original,
    );
    const markup = azureServiceIcon(service, 12, 24, 40);
    assert(markup.includes(`data-azure-icon="${service}"`));
    assert(markup.includes('x="12" y="24" width="40" height="40"'));
    assert(markup.includes('preserveAspectRatio="xMidYMid meet"'));
    assert(markup.includes(`href="${icon.dataUri}"`));
    assert.doesNotMatch(markup, /\b(?:transform|filter|clip-path)=/);
  }
});

test("unknown icons and invalid geometry fail explicitly", () => {
  for (const key of ["unknown", "toString", "__proto__"]) {
    assert.throws(() => azureServiceIcon(key, 0, 0, 32), /Unknown Azure service icon/);
  }
  for (const bounds of [[0, 0, 0], [0, 0, -1], [NaN, 0, 32], [0, Infinity, 32], [0, 0, "32"]]) {
    assert.throws(() => azureServiceIcon("foundry", ...bounds), /Invalid Azure icon bounds/);
  }
});

const atlasServices = {
  "01-shiksha-ecosystem": ["foundry", "search", "cosmos", "blob"],
  "02-shiksha-service-architecture": ["foundry", "search", "cosmos", "blob"],
  "03-shiksha-teaching-runtime": ["foundry"],
  "04-shiksha-course-knowledge": ["blob", "document-intelligence", "search", "foundry"],
  "05-shiksha-learner-memory": [],
};

for (const [figure, expected] of Object.entries({
  ...atlasServices,
  "00-shiksha-architecture-overview": Object.values(atlasServices).flat(),
})) {
  test(`${figure} embeds the original logos beside its actual service labels`, () => {
    const svg = readFileSync(new URL(`../../images/architecture/${figure}.svg`, import.meta.url), "utf8");
    const icons = [...svg.matchAll(/<image\b[^>]*data-azure-icon="([^"]+)"[^>]*>/g)];
    assert.deepEqual(icons.map(([, service]) => service), expected, "Every service label needs its matching logo");
    for (const [markup, service] of icons) {
      assert(markup.includes(`href="${azureServiceIcons[service].dataUri}"`), "Logo artwork must remain unchanged and self-contained");
      assert(markup.includes('preserveAspectRatio="xMidYMid meet"'), "Logo proportions must be preserved");
    }
    for (const [, name, body] of svg.matchAll(/<g data-card="([^"]+)">([\s\S]*?)<\/g>/g)) {
      const labels = [...body.matchAll(/data-service-label="([^"]+)"/g)].map(([, service]) => service);
      const cardIcons = [...body.matchAll(/data-azure-icon="([^"]+)"/g)].map(([, service]) => service);
      assert.deepEqual(cardIcons, labels, `${name}: do not misbrand a generic application or learning node`);
    }
  });
}
