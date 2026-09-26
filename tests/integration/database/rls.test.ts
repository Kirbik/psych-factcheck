import { randomUUID } from "node:crypto";
import { Pool, type PoolClient } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const databaseUrl = process.env.SUPABASE_TEST_DB_URL;
const describeDatabase = databaseUrl ? describe : describe.skip;
const ownerId = "11111111-1111-4111-8111-111111111111";
const otherUserId = "22222222-2222-4222-8222-222222222222";
let pool: Pool | undefined;

async function createAuthUser(client: PoolClient, id: string) {
  await client.query(
    `insert into auth.users (id, aud, role, email, raw_app_meta_data, raw_user_meta_data)
     values ($1, 'authenticated', 'authenticated', $2, '{}', '{}')`,
    [id, `${randomUUID()}@database.test`],
  );
}

async function useAuthenticatedIdentity(client: PoolClient, userId: string) {
  await client.query("set local role authenticated");
  await client.query("select set_config('request.jwt.claim.sub', $1, true)", [
    userId,
  ]);
  await client.query(
    "select set_config('request.jwt.claim.role', 'authenticated', true)",
  );
}

describeDatabase("Supabase initial schema and RLS", () => {
  beforeAll(() => {
    pool = new Pool({ connectionString: databaseUrl });
  });

  afterAll(async () => {
    await pool?.end();
  });

  it("creates the required tables, constraints, RLS, and profile lifecycle trigger", async () => {
    const client = await pool!.connect();

    try {
      const schema = await client.query<{
        table_name: string;
        relrowsecurity: boolean;
      }>(
        `select c.relname as table_name, c.relrowsecurity
         from pg_class c
         join pg_namespace n on n.oid = c.relnamespace
         where n.nspname = 'public'
           and c.relname in ('profiles', 'content_items', 'analysis_jobs', 'auth_access_tokens', 'auth_pending_access_tokens', 'auth_recovery_codes')`,
      );
      expect(schema.rows).toHaveLength(6);
      expect(schema.rows.every((row) => row.relrowsecurity)).toBe(true);

      const tokenTablePrivileges = await client.query<{
        authenticated_can_read: boolean;
        anon_can_read: boolean;
        authenticated_can_read_pending: boolean;
        anon_can_read_pending: boolean;
        authenticated_can_read_recovery: boolean;
        anon_can_read_recovery: boolean;
        service_role_can_insert_pending: boolean;
        service_role_can_insert_recovery: boolean;
      }>(
        `select has_table_privilege('authenticated', 'public.auth_access_tokens', 'select') as authenticated_can_read,
                has_table_privilege('anon', 'public.auth_access_tokens', 'select') as anon_can_read,
                has_table_privilege('authenticated', 'public.auth_pending_access_tokens', 'select') as authenticated_can_read_pending,
                has_table_privilege('anon', 'public.auth_pending_access_tokens', 'select') as anon_can_read_pending,
                has_table_privilege('authenticated', 'public.auth_recovery_codes', 'select') as authenticated_can_read_recovery,
                has_table_privilege('anon', 'public.auth_recovery_codes', 'select') as anon_can_read_recovery,
                has_table_privilege('service_role', 'public.auth_pending_access_tokens', 'insert') as service_role_can_insert_pending,
                has_table_privilege('service_role', 'public.auth_recovery_codes', 'insert') as service_role_can_insert_recovery`,
      );
      expect(tokenTablePrivileges.rows).toEqual([
        {
          authenticated_can_read: false,
          anon_can_read: false,
          authenticated_can_read_pending: false,
          anon_can_read_pending: false,
          authenticated_can_read_recovery: false,
          anon_can_read_recovery: false,
          service_role_can_insert_pending: true,
          service_role_can_insert_recovery: true,
        },
      ]);

      const bucket = await client.query<{ id: string; public: boolean }>(
        "select id, public from storage.buckets where id = 'videos'",
      );
      expect(bucket.rows).toEqual([{ id: "videos", public: false }]);
      const storagePolicies = await client.query<{ policyname: string }>(
        "select policyname from pg_policies where schemaname = 'storage' and tablename = 'objects'",
      );
      expect(storagePolicies.rows.map((row) => row.policyname)).toEqual(
        expect.arrayContaining([
          "videos: insert own",
          "videos: select own",
          "videos: update own",
          "videos: delete own",
        ]),
      );

      const constraints = await client.query<{ conname: string }>(
        `select conname
         from pg_constraint
         where conrelid in ('public.profiles'::regclass, 'public.content_items'::regclass, 'public.analysis_jobs'::regclass)`,
      );
      expect(constraints.rows.map((row) => row.conname)).toEqual(
        expect.arrayContaining([
          "profiles_pkey",
          "content_items_user_id_fkey",
          "analysis_jobs_user_id_fkey",
          "analysis_jobs_content_item_id_user_id_fkey",
        ]),
      );

      const policies = await client.query<{ policyname: string }>(
        `select policyname
         from pg_policies
         where schemaname = 'public'
           and tablename in ('profiles', 'content_items', 'analysis_jobs')`,
      );
      expect(policies.rows.map((row) => row.policyname)).toEqual(
        expect.arrayContaining([
          "profiles: select own",
          "profiles: update own",
          "content items: select own",
          "content items: insert own",
          "content items: update own",
          "content items: delete own",
          "analysis jobs: select own",
        ]),
      );

      await client.query("begin");
      await createAuthUser(client, ownerId);
      const profile = await client.query<{ id: string }>(
        "select id from public.profiles where id = $1",
        [ownerId],
      );
      expect(profile.rows).toEqual([{ id: ownerId }]);

      const profileTrigger = await client.query<{ schema_name: string }>(
        `select n.nspname as schema_name
         from pg_trigger t
         join pg_proc p on p.oid = t.tgfoid
         join pg_namespace n on n.oid = p.pronamespace
         where t.tgrelid = 'auth.users'::regclass
           and t.tgname = 'on_auth_user_created'`,
      );
      expect(profileTrigger.rows).toEqual([{ schema_name: "app_private" }]);
    } finally {
      await client.query("rollback").catch(() => undefined);
      client.release();
    }
  });

  it("allows an owner to create, read, update, and delete only their content", async () => {
    const client = await pool!.connect();

    try {
      await client.query("begin");
      await createAuthUser(client, ownerId);
      await useAuthenticatedIdentity(client, ownerId);

      const created = await client.query<{ id: string }>(
        "insert into public.content_items (user_id) values ($1) returning id",
        [ownerId],
      );
      const itemId = created.rows[0]?.id;
      expect(itemId).toBeDefined();

      const read = await client.query<{ id: string }>(
        "select id from public.content_items where id = $1",
        [itemId],
      );
      expect(read.rows).toHaveLength(1);

      const updated = await client.query<{ status: string }>(
        "update public.content_items set status = 'ready' where id = $1 returning status",
        [itemId],
      );
      expect(updated.rows).toEqual([{ status: "ready" }]);

      const deleted = await client.query<{ id: string }>(
        "delete from public.content_items where id = $1 returning id",
        [itemId],
      );
      expect(deleted.rows).toHaveLength(1);
    } finally {
      await client.query("rollback").catch(() => undefined);
      client.release();
    }
  });

  it("denies cross-user reads, updates, and deletes, and denies anonymous reads", async () => {
    const client = await pool!.connect();

    try {
      await client.query("begin");
      await createAuthUser(client, ownerId);
      await createAuthUser(client, otherUserId);
      const item = await client.query<{ id: string }>(
        "insert into public.content_items (user_id) values ($1) returning id",
        [ownerId],
      );
      const itemId = item.rows[0]?.id;
      expect(itemId).toBeDefined();

      await useAuthenticatedIdentity(client, otherUserId);
      expect(
        (
          await client.query(
            "select id from public.content_items where id = $1",
            [itemId],
          )
        ).rows,
      ).toHaveLength(0);
      expect(
        (
          await client.query(
            "update public.content_items set status = 'failed' where id = $1 returning id",
            [itemId],
          )
        ).rows,
      ).toHaveLength(0);
      expect(
        (
          await client.query(
            "delete from public.content_items where id = $1 returning id",
            [itemId],
          )
        ).rows,
      ).toHaveLength(0);

      await client.query("set local role anon");
      await client.query(
        "select set_config('request.jwt.claim.sub', '', true)",
      );
      await expect(
        client.query("select id from public.content_items where id = $1", [
          itemId,
        ]),
      ).rejects.toThrow(/permission denied/i);
    } finally {
      await client.query("rollback").catch(() => undefined);
      client.release();
    }
  });
});
