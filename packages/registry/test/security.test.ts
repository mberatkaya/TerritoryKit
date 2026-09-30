import { createServer } from "node:http";
import type { IncomingMessage, ServerResponse } from "node:http";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { createNodeRegistryTransport, createNodeTerritoryRegistryClient } from "../src/node.js";

const servers: Array<ReturnType<typeof createServer>> = [];
afterEach(async () => {
  for (const server of servers.splice(0))
    await new Promise<void>((resolve) => server.close(() => resolve()));
});
async function serve(
  handler: (request: IncomingMessage, response: ServerResponse) => void
): Promise<string> {
  const server = createServer(handler);
  servers.push(server);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("No server address");
  return `http://127.0.0.1:${address.port}/`;
}

describe("registry transport trust boundary", () => {
  it("requires explicit HTTP and local file opt-ins", async () => {
    await expect(
      createNodeTerritoryRegistryClient({
        registryUrl: "http://example.test/registry.json"
      }).loadRegistry()
    ).rejects.toThrow("allowHttp");
    const root = await mkdtemp(join(tmpdir(), "territory-registry-security-"));
    try {
      const file = join(root, "registry.json");
      await writeFile(file, "{}", "utf8");
      await expect(
        createNodeTerritoryRegistryClient({
          registryUrl: pathToFileURL(file).toString()
        }).loadRegistry()
      ).rejects.toThrow("allowFile");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("blocks private destinations and private redirect targets by default", async () => {
    const base = await serve((request, response) => {
      if (request.url === "/target") {
        response.end("ok");
        return;
      }
      response.writeHead(302, {
        Location: `http://127.0.0.1:${request.headers.host?.split(":").pop()}/target`
      });
      response.end();
    });
    await expect(createNodeRegistryTransport().fetch({ url: base })).rejects.toThrow(
      "Private registry address"
    );
    await expect(
      createNodeRegistryTransport({ allowPrivateNetwork: true }).fetch({ url: base, maxBytes: 10 })
    ).resolves.toMatchObject({ sizeBytes: 2 });
  });

  it("enforces size during chunked streaming and before local file reads", async () => {
    const base = await serve((_request, response) => {
      response.write("123456");
      response.end("7890");
    });
    await expect(
      createNodeRegistryTransport({ allowPrivateNetwork: true }).fetch({ url: base, maxBytes: 5 })
    ).rejects.toThrow("maxBytes");
    const root = await mkdtemp(join(tmpdir(), "territory-registry-size-"));
    try {
      const file = join(root, "large.bin");
      await writeFile(file, "1234567890");
      await expect(
        createNodeRegistryTransport().fetch({ url: pathToFileURL(file).toString(), maxBytes: 5 })
      ).rejects.toThrow("maxBytes");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
  it("rejects a remote registry that names local artifacts and a tampered offline snapshot", async () => {
    const registry = {
      registryVersion: "1" as const,
      generatedAt: "2026-09-30T00:00:00.000Z",
      baseUrl: "file:///etc/",
      datasets: []
    };
    await expect(
      createNodeTerritoryRegistryClient({
        registryUrl: "https://example.test/registry.json",
        registry
      }).loadRegistry()
    ).rejects.toThrow("local artifact base");
    const root = await mkdtemp(join(tmpdir(), "territory-registry-cache-"));
    try {
      const { createNodeTerritoryRegistryCache } = await import("../src/node.js");
      const cache = createNodeTerritoryRegistryCache({ rootDir: root });
      await cache.writeRegistrySnapshot({
        registryUrl: "https://example.test/registry.json",
        registryHash: "bad",
        registry: { ...registry, baseUrl: "https://example.test/" },
        savedAt: "2026-09-30T00:00:00.000Z"
      });
      await expect(
        createNodeTerritoryRegistryClient({
          registryUrl: "https://example.test/registry.json",
          cacheDir: root,
          offline: true
        }).loadRegistry()
      ).rejects.toThrow("integrity validation");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
  it("rejects oversized Content-Length before buffering", async () => {
    const base = await serve((_request, response) => {
      response.writeHead(200, { "content-length": "1000000" });
      response.end();
    });
    await expect(
      createNodeRegistryTransport({ allowPrivateNetwork: true }).fetch({ url: base, maxBytes: 5 })
    ).rejects.toThrow("maxBytes");
  });
});
