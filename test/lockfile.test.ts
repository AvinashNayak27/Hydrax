import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { parsePackageLock } from "../src/lockfile.js";

for (const version of [2, 3]) test(`package-lock v${version} preserves nested occurrences`, async () => {
  const input = JSON.parse(await readFile(new URL(`../fixtures/package-lock-v${version}.json`, import.meta.url), "utf8"));
  const parsed = parsePackageLock(input, "svc");
  const shared = parsed.packages.filter((node) => node.name === "shared");
  assert.equal(shared.length, 2);
  assert.notEqual(shared[0]!.id, shared[1]!.id);
  assert.equal(parsed.edges.find((edge) => edge.from.endsWith("node_modules/a"))?.lockOccurrence, "node_modules/a/node_modules/shared");
});

test("public TanStack-shaped package-lock fixture is accepted", async () => {
  const input = JSON.parse(await readFile(new URL("../fixtures/public-tanstack-package-lock-v3.json", import.meta.url), "utf8"));
  const parsed = parsePackageLock(input, "public-lock");
  assert.equal(parsed.lockfileVersion, 3);
  assert.equal(parsed.edges.length, 1);
  assert.equal(parsed.edges[0]?.packageName, "@tanstack/router");
});
