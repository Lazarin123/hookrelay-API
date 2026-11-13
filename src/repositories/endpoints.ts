import { randomBytes, randomUUID } from "node:crypto";
import type { Db } from "../db/index.js";

export interface Endpoint {
  id: string;
  slug: string;
  name: string;
  targetUrl: string | null;
  signingSecret: string | null;
  signatureHeader: string;
  rejectInvalidSignature: boolean;
  forwardSecret: string | null;
  active: boolean;
  createdAt: string;
  updatedAt: string;
}

interface Row {
  id: string;
  slug: string;
  name: string;
  target_url: string | null;
  signing_secret: string | null;
  signature_header: string;
  reject_invalid_signature: number;
  forward_secret: string | null;
  active: number;
  created_at: string;
  updated_at: string;
}

const toEndpoint = (r: Row): Endpoint => ({
  id: r.id,
  slug: r.slug,
  name: r.name,
  targetUrl: r.target_url,
  signingSecret: r.signing_secret,
  signatureHeader: r.signature_header,
  rejectInvalidSignature: r.reject_invalid_signature === 1,
  forwardSecret: r.forward_secret,
  active: r.active === 1,
  createdAt: r.created_at,
  updatedAt: r.updated_at,
});

export interface NewEndpoint {
  name: string;
  targetUrl?: string | null;
  signingSecret?: string | null;
  signatureHeader?: string;
  rejectInvalidSignature?: boolean;
  forwardSecret?: string | null;
}

export type EndpointPatch = Partial<NewEndpoint> & { active?: boolean };

export class EndpointsRepo {
  constructor(private db: Db) {}

  async create(input: NewEndpoint): Promise<Endpoint> {
    const now = new Date().toISOString();
    const id = randomUUID();
    // O slug é o "segredo" da URL pública de entrada: 18 bytes aleatórios = 144 bits.
    const slug = randomBytes(18).toString("base64url");
    await this.db.run(
      `INSERT INTO endpoints
        (id, slug, name, target_url, signing_secret, signature_header, reject_invalid_signature, forward_secret, active, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?)`,
      [
        id,
        slug,
        input.name,
        input.targetUrl ?? null,
        input.signingSecret ?? null,
        (input.signatureHeader ?? "x-signature").toLowerCase(),
        input.rejectInvalidSignature ? 1 : 0,
        input.forwardSecret ?? null,
        now,
        now,
      ],
    );
    return (await this.getById(id))!;
  }

  async getById(id: string): Promise<Endpoint | undefined> {
    const row = await this.db.get<Row>(`SELECT * FROM endpoints WHERE id = ?`, [id]);
    return row && toEndpoint(row);
  }

  async getBySlug(slug: string): Promise<Endpoint | undefined> {
    const row = await this.db.get<Row>(`SELECT * FROM endpoints WHERE slug = ?`, [slug]);
    return row && toEndpoint(row);
  }

  async list(limit: number, offset: number): Promise<{ data: Endpoint[]; total: number }> {
    const rows = await this.db.all<Row>(`SELECT * FROM endpoints ORDER BY created_at DESC, id LIMIT ? OFFSET ?`, [
      limit,
      offset,
    ]);
    const count = await this.db.get<{ n: number | string }>(`SELECT CAST(COUNT(*) AS INTEGER) AS n FROM endpoints`);
    return { data: rows.map(toEndpoint), total: Number(count?.n ?? 0) };
  }

  async update(id: string, patch: EndpointPatch): Promise<Endpoint | undefined> {
    const current = await this.getById(id);
    if (!current) return undefined;
    const next = {
      name: patch.name ?? current.name,
      targetUrl: patch.targetUrl === undefined ? current.targetUrl : patch.targetUrl,
      signingSecret: patch.signingSecret === undefined ? current.signingSecret : patch.signingSecret,
      signatureHeader: (patch.signatureHeader ?? current.signatureHeader).toLowerCase(),
      rejectInvalidSignature: patch.rejectInvalidSignature ?? current.rejectInvalidSignature,
      forwardSecret: patch.forwardSecret === undefined ? current.forwardSecret : patch.forwardSecret,
      active: patch.active ?? current.active,
    };
    await this.db.run(
      `UPDATE endpoints SET name = ?, target_url = ?, signing_secret = ?, signature_header = ?,
         reject_invalid_signature = ?, forward_secret = ?, active = ?, updated_at = ? WHERE id = ?`,
      [
        next.name,
        next.targetUrl,
        next.signingSecret,
        next.signatureHeader,
        next.rejectInvalidSignature ? 1 : 0,
        next.forwardSecret,
        next.active ? 1 : 0,
        new Date().toISOString(),
        id,
      ],
    );
    return this.getById(id);
  }

  async delete(id: string): Promise<boolean> {
    const { changes } = await this.db.run(`DELETE FROM endpoints WHERE id = ?`, [id]);
    return changes > 0;
  }
}
