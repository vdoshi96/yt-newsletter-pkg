"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";

type Channel = {
  id: string;
  name: string;
  channelId: string;
  sport: string;
  createdAt: string;
};

type Status = {
  gemini: boolean;
  email: boolean;
  session: boolean;
  controllerPassword: boolean;
  cron: boolean;
  db: boolean;
};

type AnalysisRow = {
  id: string;
  videoId: string;
  channelName: string;
  videoUrl: string;
  processedAt: string;
  payload: Record<string, unknown>;
};

function Pill({ ok, label }: { ok: boolean; label: string }) {
  return (
    <span
      className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${
        ok ? "bg-emerald-500/20 text-emerald-300" : "bg-amber-500/15 text-amber-200"
      }`}
    >
      {label}: {ok ? "on" : "off"}
    </span>
  );
}

export function DashboardClient() {
  const router = useRouter();
  const [status, setStatus] = useState<Status | null>(null);
  const [channels, setChannels] = useState<Channel[]>([]);
  const [history, setHistory] = useState<AnalysisRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [name, setName] = useState("");
  const [channelId, setChannelId] = useState("");
  const [testUrl, setTestUrl] = useState("");
  const [dryRun, setDryRun] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [testResult, setTestResult] = useState<unknown>(null);

  const load = useCallback(async () => {
    setError(null);
    try {
      const [s, c, h] = await Promise.all([
        fetch("/api/status").then((r) => r.json()),
        fetch("/api/channels").then((r) => r.json()),
        fetch("/api/history?limit=15").then((r) => r.json()),
      ]);
      setStatus(s);
      setChannels(c.channels ?? []);
      setHistory(h.analyses ?? []);
    } catch {
      setError("Failed to load dashboard data");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function logout() {
    await fetch("/api/auth/logout", { method: "POST" });
    router.push("/login");
    router.refresh();
  }

  async function addChannel(e: React.FormEvent) {
    e.preventDefault();
    setBusy("add");
    setMessage(null);
    try {
      const res = await fetch("/api/channels", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, channelId }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Failed");
      setName("");
      setChannelId("");
      setMessage(`Added channel ${data.channel?.name ?? ""}`);
      await load();
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Add failed");
    } finally {
      setBusy(null);
    }
  }

  async function removeChannel(id: string) {
    if (!confirm("Remove this channel?")) return;
    setBusy(`del-${id}`);
    try {
      await fetch(`/api/channels/${id}`, { method: "DELETE" });
      await load();
    } catch {
      setError("Remove failed");
    } finally {
      setBusy(null);
    }
  }

  async function runTest(e: React.FormEvent) {
    e.preventDefault();
    setBusy("test");
    setTestResult(null);
    setMessage(null);
    setError(null);
    try {
      const res = await fetch("/api/test", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ videoUrl: testUrl, dryRun }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Test failed");
      setTestResult(data.analysis);
      setMessage(
        dryRun
          ? "Dry run complete (no email, not saved to history)"
          : "Full test sent email and saved to history"
      );
      await load();
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Test failed");
    } finally {
      setBusy(null);
    }
  }

  async function runRecap() {
    setBusy("recap");
    setMessage(null);
    setError(null);
    try {
      const res = await fetch("/api/recap", { method: "POST" });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Recap failed");
      if (data.count === 0) {
        setMessage(data.message ?? "No analyses in the last 7 days");
      } else {
        setMessage(`Recap email sent (${data.count} analyses in window)`);
      }
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Recap failed");
    } finally {
      setBusy(null);
    }
  }

  if (loading) {
    return (
      <div className="min-h-screen bg-slate-950 p-8 text-slate-400">Loading…</div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100">
      <header className="border-b border-slate-800 bg-slate-900/50">
        <div className="mx-auto flex max-w-5xl items-center justify-between px-4 py-4">
          <div>
            <h1 className="text-lg font-semibold text-white">YT Newsletter</h1>
            <p className="text-xs text-slate-500">Controller</p>
          </div>
          <button
            type="button"
            onClick={() => void logout()}
            className="rounded-lg border border-slate-700 px-3 py-1.5 text-sm text-slate-300 hover:bg-slate-800"
          >
            Sign out
          </button>
        </div>
      </header>

      <main className="mx-auto max-w-5xl space-y-10 px-4 py-8">
        {status ? (
          <section className="flex flex-wrap gap-2">
            <Pill ok={status.db} label="Database" />
            <Pill ok={status.gemini} label="Gemini" />
            <Pill ok={status.email} label="Email SMTP" />
            <Pill ok={status.cron} label="Cron secret" />
            <Pill ok={status.session} label="Session" />
          </section>
        ) : null}

        {message ? (
          <p className="rounded-lg bg-emerald-500/10 px-3 py-2 text-sm text-emerald-200">
            {message}
          </p>
        ) : null}
        {error ? (
          <p className="rounded-lg bg-red-500/10 px-3 py-2 text-sm text-red-300">
            {error}
          </p>
        ) : null}

        <section className="rounded-2xl border border-slate-800 bg-slate-900/40 p-6">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-500">
            Channels
          </h2>
          <ul className="mt-4 divide-y divide-slate-800">
            {channels.length === 0 ? (
              <li className="py-3 text-sm text-slate-500">No channels yet.</li>
            ) : (
              channels.map((ch) => (
                <li
                  key={ch.id}
                  className="flex flex-wrap items-center justify-between gap-2 py-3"
                >
                  <div>
                    <p className="font-medium text-white">{ch.name}</p>
                    <p className="font-mono text-xs text-slate-500">{ch.channelId}</p>
                  </div>
                  <button
                    type="button"
                    disabled={busy !== null}
                    onClick={() => void removeChannel(ch.id)}
                    className="text-sm text-red-400 hover:text-red-300"
                  >
                    Remove
                  </button>
                </li>
              ))
            )}
          </ul>

          <form onSubmit={addChannel} className="mt-6 grid gap-3 sm:grid-cols-2">
            <input
              required
              placeholder="Display name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm"
            />
            <input
              required
              placeholder="Channel ID (UC…)"
              value={channelId}
              onChange={(e) => setChannelId(e.target.value)}
              className="rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 font-mono text-sm"
            />
            <div className="sm:col-span-2">
              <button
                type="submit"
                disabled={busy !== null}
                className="rounded-lg bg-violet-600 px-4 py-2 text-sm font-medium text-white hover:bg-violet-500 disabled:opacity-50"
              >
                Add channel
              </button>
            </div>
          </form>
        </section>

        <section className="rounded-2xl border border-slate-800 bg-slate-900/40 p-6">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-500">
            Test pipeline
          </h2>
          <p className="mt-2 text-sm text-slate-400">
            Dry run runs transcript + Gemini only. Uncheck to send email and save
            history (same as CLI test).
          </p>
          <form onSubmit={runTest} className="mt-4 space-y-3">
            <input
              required
              placeholder="https://www.youtube.com/watch?v=…"
              value={testUrl}
              onChange={(e) => setTestUrl(e.target.value)}
              className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm"
            />
            <label className="flex items-center gap-2 text-sm text-slate-300">
              <input
                type="checkbox"
                checked={dryRun}
                onChange={(e) => setDryRun(e.target.checked)}
              />
              Dry run (mock — no email, no DB write)
            </label>
            <button
              type="submit"
              disabled={busy !== null}
              className="rounded-lg bg-slate-100 px-4 py-2 text-sm font-medium text-slate-900 hover:bg-white disabled:opacity-50"
            >
              {busy === "test" ? "Running…" : "Run test"}
            </button>
          </form>
          {testResult ? (
            <pre className="mt-4 max-h-96 overflow-auto rounded-lg border border-slate-800 bg-slate-950 p-3 text-xs text-emerald-100/90">
              {JSON.stringify(testResult, null, 2)}
            </pre>
          ) : null}
        </section>

        <section className="rounded-2xl border border-slate-800 bg-slate-900/40 p-6">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-500">
              Weekly recap
            </h2>
            <button
              type="button"
              disabled={busy !== null}
              onClick={() => void runRecap()}
              className="rounded-lg border border-violet-500/50 bg-violet-500/10 px-4 py-2 text-sm text-violet-200 hover:bg-violet-500/20 disabled:opacity-50"
            >
              {busy === "recap" ? "Sending…" : "Send recap email now"}
            </button>
          </div>
        </section>

        <section className="rounded-2xl border border-slate-800 bg-slate-900/40 p-6">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-500">
            Recent analyses
          </h2>
          <ul className="mt-4 space-y-3">
            {history.length === 0 ? (
              <li className="text-sm text-slate-500">No saved analyses yet.</li>
            ) : (
              history.map((row) => (
                <li
                  key={row.id}
                  className="rounded-lg border border-slate-800/80 bg-slate-950/50 p-3"
                >
                  <a
                    href={row.videoUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="text-sm font-medium text-violet-300 hover:underline"
                  >
                    {(row.payload as { video_title?: string })?.video_title ??
                      row.videoId}
                  </a>
                  <p className="text-xs text-slate-500">
                    {row.channelName} ·{" "}
                    {new Date(row.processedAt).toLocaleString()}
                  </p>
                </li>
              ))
            )}
          </ul>
        </section>
      </main>
    </div>
  );
}
