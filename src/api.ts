import * as vscode from "vscode";

// Shape of a container as returned by GET /api/containers and friends.
// Only the fields the extension consumes are typed; the backend sends more.
export interface Container {
  id: string;
  subdomain: string;
  status: string;
  hostPort?: number;
  sshPort?: number;
  memoryBytes?: number;
  storageBytes?: number;
  dbName?: string;
  databaseUrl?: string;
  s3Endpoint?: string;
  s3AccessKey?: string;
  s3SecretKey?: string;
  s3Bucket?: string;
  sshKey?: string;
  guestSshKey?: string;
  dbUsername?: string;
  volumePath?: string;
  owner?: boolean;
  customDomains?: DomainView[];
  alwaysOn?: boolean;
  createdAt?: string;
}

export interface DomainView {
  id: string;
  domain: string;
  disabled?: boolean;
  status?: string;
  lastError?: string;
}

export interface Account {
  email?: string;
  plan?: string;
  [key: string]: unknown;
}

export interface TableInfo {
  name: string;
  rowEstimate: number;
  sizeBytes: number;
}
export interface TablePage {
  items: TableInfo[];
  total: number;
  offset: number;
  limit: number;
}
export interface TablePreview {
  table: string;
  columns: string[];
  rows: string[][];
  total: number;
  offset: number;
  limit: number;
}
export interface ObjectInfo {
  key: string;
  size: number;
  lastModified: string;
}
export interface ObjectPage {
  items: ObjectInfo[];
  nextAfter?: string | null;
}
export interface KafkaTopic {
  name: string;
  partitions: number;
  retentionMs: number;
  reservedBytes: number;
}
export interface KafkaLimits {
  maxStorageBytes: number;
  retentionMs: number;
  maxTopics: number;
  maxPartitionsPerTopic: number;
  throughputBytesPerSec: number;
}
export interface KafkaInfo {
  enabled: boolean;
  bootstrap?: string;
  externalBootstrap?: string;
  username?: string;
  password?: string;
  groupPrefix?: string;
  saslMechanism?: string;
  securityProtocol?: string;
  topics: KafkaTopic[];
  usedBytes: number;
  limits: KafkaLimits;
}
export interface ObjectBytes {
  bytes: Uint8Array;
  contentType: string;
}

export class ApiError extends Error {
  constructor(public status: number, message: string) {
    super(message);
    this.name = "ApiError";
  }
}

// Thin REST client for the BasicDeploy API. All calls carry the bearer key.
// The key is supplied per-call so the caller controls the session lifetime.
export class BasicDeployApi {
  constructor(private readonly getKey: () => Promise<string | undefined>) {}

  private baseUrl(): string {
    const url = vscode.workspace
      .getConfiguration("basicdeploy")
      .get<string>("apiUrl", "https://basicdeploy.com/api");
    return url.replace(/\/+$/, "");
  }

  private async headers(extra?: Record<string, string>): Promise<Record<string, string>> {
    const key = await this.getKey();
    if (!key) {
      throw new ApiError(401, "Not signed in to BasicDeploy.");
    }
    return { Authorization: `Bearer ${key}`, ...(extra ?? {}) };
  }

  private async request<T>(path: string, init?: RequestInit): Promise<T> {
    const res = await fetch(`${this.baseUrl()}${path}`, init);
    if (!res.ok) {
      let detail = res.statusText;
      try {
        const body = await res.text();
        if (body) {
          detail = body.slice(0, 500);
        }
      } catch {
        // ignore body read failures, keep statusText
      }
      throw new ApiError(res.status, `${res.status} ${detail}`);
    }
    if (res.status === 204) {
      return undefined as T;
    }
    const text = await res.text();
    return (text ? JSON.parse(text) : undefined) as T;
  }

  // Validate a raw key without persisting it. Returns the account on success.
  async whoami(rawKey: string): Promise<Account> {
    const res = await fetch(`${this.baseUrl()}/auth/me`, {
      headers: { Authorization: `Bearer ${rawKey}` },
    });
    if (!res.ok) {
      throw new ApiError(res.status, `Key rejected (${res.status}).`);
    }
    const text = await res.text();
    return (text ? JSON.parse(text) : {}) as Account;
  }

  async listContainers(): Promise<Container[]> {
    return this.request<Container[]>("/containers", { headers: await this.headers() });
  }

  async getContainer(id: string): Promise<Container> {
    return this.request<Container>(`/containers/${id}`, { headers: await this.headers() });
  }

  async createContainer(): Promise<Container> {
    return this.request<Container>("/containers", {
      method: "POST",
      headers: await this.headers({ "Content-Type": "application/json" }),
      body: "{}",
    });
  }

  async deleteContainer(id: string): Promise<void> {
    await this.request<void>(`/containers/${id}`, {
      method: "DELETE",
      headers: await this.headers(),
    });
  }

  async wake(id: string): Promise<void> {
    await this.request<void>(`/containers/${id}/wake`, {
      method: "POST",
      headers: await this.headers(),
    });
  }

  async sleep(id: string): Promise<void> {
    await this.request<void>(`/containers/${id}/sleep`, {
      method: "POST",
      headers: await this.headers(),
    });
  }

  async logs(id: string, tail = 200): Promise<string> {
    const res = await this.request<{ logs?: string }>(
      `/containers/${id}/logs?tail=${encodeURIComponent(String(tail))}`,
      { headers: await this.headers() },
    );
    return res?.logs ?? "";
  }

  // --- Per-user data browsing (Postgres / object storage / Kafka) ---

  async connectInfo(): Promise<{ copyForLlm?: string; [k: string]: unknown }> {
    return this.request("/data/connect", { headers: await this.headers() });
  }

  async tables(offset = 0, limit = 100): Promise<TablePage> {
    return this.request<TablePage>(
      `/data/tables?offset=${offset}&limit=${limit}`,
      { headers: await this.headers() },
    );
  }

  async rows(table: string, offset = 0, limit = 50): Promise<TablePreview> {
    const q = `table=${encodeURIComponent(table)}&offset=${offset}&limit=${limit}`;
    return this.request<TablePreview>(`/data/rows?${q}`, { headers: await this.headers() });
  }

  async objects(after?: string, limit = 100): Promise<ObjectPage> {
    const q = new URLSearchParams({ limit: String(limit) });
    if (after) {
      q.set("after", after);
    }
    return this.request<ObjectPage>(`/data/objects?${q.toString()}`, {
      headers: await this.headers(),
    });
  }

  async getObject(key: string): Promise<ObjectBytes> {
    const res = await fetch(
      `${this.baseUrl()}/data/object?key=${encodeURIComponent(key)}`,
      { headers: await this.headers() },
    );
    if (!res.ok) {
      throw new ApiError(res.status, `Object read failed (${res.status}).`);
    }
    const buf = await res.arrayBuffer();
    return {
      bytes: new Uint8Array(buf),
      contentType: res.headers.get("content-type") ?? "application/octet-stream",
    };
  }

  async kafkaInfo(): Promise<KafkaInfo> {
    return this.request<KafkaInfo>("/kafka/info", { headers: await this.headers() });
  }

  async createTopic(label?: string): Promise<string> {
    const res = await this.request<{ name?: string }>("/kafka/topics", {
      method: "POST",
      headers: await this.headers({ "Content-Type": "application/json" }),
      body: JSON.stringify(label ? { label } : {}),
    });
    return res?.name ?? "";
  }

  async purgeTopic(name: string): Promise<void> {
    await this.request<void>("/kafka/topics/purge", {
      method: "POST",
      headers: await this.headers({ "Content-Type": "application/json" }),
      body: JSON.stringify({ name }),
    });
  }

  async deleteTopic(name: string): Promise<void> {
    await this.request<void>("/kafka/topics", {
      method: "DELETE",
      headers: await this.headers({ "Content-Type": "application/json" }),
      body: JSON.stringify({ name }),
    });
  }

  async listDomains(id: string): Promise<DomainView[]> {
    return this.request<DomainView[]>(`/containers/${id}/domains`, {
      headers: await this.headers(),
    });
  }

  async addDomain(id: string, domain: string): Promise<DomainView> {
    return this.request<DomainView>(`/containers/${id}/domains`, {
      method: "POST",
      headers: await this.headers({ "Content-Type": "application/json" }),
      body: JSON.stringify({ domain }),
    });
  }

  async removeDomain(id: string, domainId: string): Promise<void> {
    await this.request<void>(`/containers/${id}/domains/${domainId}`, {
      method: "DELETE",
      headers: await this.headers(),
    });
  }

  // Deploy a gzipped tarball. Optional containerId targets an existing box;
  // omit it to have the platform create a fresh container. Returns its id.
  async deploy(tarball: Uint8Array, containerId?: string): Promise<string> {
    const form = new FormData();
    form.append("file", new Blob([Buffer.from(tarball)], { type: "application/gzip" }), "app.tar.gz");
    if (containerId) {
      form.append("containerId", containerId);
    }
    const res = await this.request<{ containerId?: string } | string>("/deploy", {
      method: "POST",
      headers: await this.headers(),
      body: form,
    });
    if (typeof res === "string") {
      return res;
    }
    return res?.containerId ?? "";
  }
}

// Resolve a container by subdomain (used by tools and chat, which speak in
// human-friendly subdomains rather than opaque UUIDs).
export async function findBySubdomain(
  api: BasicDeployApi,
  subdomain: string,
): Promise<Container | undefined> {
  const all = await api.listContainers();
  const wanted = subdomain.replace(/\.basicdeploy\.com$/i, "").toLowerCase();
  return all.find((c) => c.subdomain?.toLowerCase() === wanted);
}
