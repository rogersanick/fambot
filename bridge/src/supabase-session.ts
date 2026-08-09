import { createClient, type SupabaseClient } from "@supabase/supabase-js";

/**
 * The bridge's Supabase identity: signed in as the agent user. Used for two
 * things — minting JWTs for MCP calls (the agent's tool access), and the
 * reminder poller's own reads/writes (RLS applies to both).
 */
export class AgentSession {
  readonly db: SupabaseClient;

  constructor(
    private readonly url: string,
    anonKey: string,
    private readonly email: string,
    private readonly password: string,
  ) {
    this.db = createClient(url, anonKey, {
      auth: { persistSession: false, autoRefreshToken: true },
    });
  }

  async start(): Promise<void> {
    const { error } = await this.db.auth.signInWithPassword({
      email: this.email,
      password: this.password,
    });
    if (error) {
      throw new Error(
        `agent sign-in failed for ${this.email} at ${this.url}: ${error.message} — run scripts/bootstrap-local.mjs?`,
      );
    }
  }

  /** A currently-valid access token (re-authenticates if the session lapsed). */
  async token(): Promise<string> {
    const { data } = await this.db.auth.getSession();
    let session = data.session;
    if (session && session.expires_at && session.expires_at * 1000 - Date.now() < 60_000) {
      const refreshed = await this.db.auth.refreshSession();
      session = refreshed.data.session ?? session;
    }
    if (!session) {
      await this.start();
      const retry = await this.db.auth.getSession();
      session = retry.data.session;
    }
    if (!session) throw new Error("no Supabase session for the agent user");
    return session.access_token;
  }

  stop(): void {
    void this.db.auth.stopAutoRefresh();
  }
}
