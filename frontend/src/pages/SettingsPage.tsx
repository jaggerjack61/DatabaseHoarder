import { useEffect, useState } from "react";

import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { Section } from "@/components/ui/Section";
import { useAuth } from "@/context/AuthContext";
import {
  changePassword,
  getSiteSettings,
  resetThrottles,
  updateSiteSettings,
} from "@/lib/api";
import { SiteSettings } from "@/types/api";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function SettingRow({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex flex-col gap-1 py-4 sm:flex-row sm:items-start sm:gap-6">
      <div className="w-full sm:w-56 shrink-0">
        <p className="text-sm font-medium text-foreground">{label}</p>
        {hint && <p className="mt-0.5 text-xs text-muted-foreground">{hint}</p>}
      </div>
      <div className="flex-1">{children}</div>
    </div>
  );
}

function Card({ children }: { children: React.ReactNode }) {
  return (
    <div className="rounded-2xl border border-border bg-white p-6 shadow-soft">
      {children}
    </div>
  );
}

function CardTitle({ children }: { children: React.ReactNode }) {
  return <p className="mb-1 text-sm font-semibold uppercase tracking-wider text-muted-foreground">{children}</p>;
}

function Divider() {
  return <hr className="border-border" />;
}

function Feedback({ message, isError }: { message: string | null; isError?: boolean }) {
  if (!message) return null;
  return (
    <p className={`mt-2 text-sm ${isError ? "text-failure" : "text-success"}`}>
      {message}
    </p>
  );
}

// ---------------------------------------------------------------------------
// Profile section
// ---------------------------------------------------------------------------

function ProfileSection() {
  const { accessToken } = useAuth();
  const [oldPw, setOldPw] = useState("");
  const [newPw, setNewPw] = useState("");
  const [confirmPw, setConfirmPw] = useState("");
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [isError, setIsError] = useState(false);

  const handleSubmit = async () => {
    if (!accessToken) return;
    setMessage(null);

    if (newPw !== confirmPw) {
      setIsError(true);
      setMessage("New passwords do not match.");
      return;
    }
    if (newPw.length < 8) {
      setIsError(true);
      setMessage("New password must be at least 8 characters.");
      return;
    }

    setSaving(true);
    try {
      const res = await changePassword(accessToken, oldPw, newPw);
      setIsError(false);
      setMessage(res.detail);
      setOldPw("");
      setNewPw("");
      setConfirmPw("");
    } catch (err) {
      setIsError(true);
      setMessage(err instanceof Error ? err.message : "Failed to change password.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Card>
      <CardTitle>Profile</CardTitle>
      <Divider />

      <SettingRow label="Change Password" hint="Minimum 8 characters.">
        <div className="space-y-2 max-w-sm">
          <Input
            type="password"
            placeholder="Current password"
            value={oldPw}
            onChange={(e) => setOldPw(e.target.value)}
          />
          <Input
            type="password"
            placeholder="New password"
            value={newPw}
            onChange={(e) => setNewPw(e.target.value)}
          />
          <Input
            type="password"
            placeholder="Confirm new password"
            value={confirmPw}
            onChange={(e) => setConfirmPw(e.target.value)}
          />
          <div className="pt-1">
            <Button size="sm" onClick={() => void handleSubmit()} disabled={saving || !oldPw || !newPw || !confirmPw}>
              {saving ? "Saving…" : "Update Password"}
            </Button>
          </div>
          <Feedback message={message} isError={isError} />
        </div>
      </SettingRow>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// System section (admin only)
// ---------------------------------------------------------------------------

function SystemSection() {
  const { accessToken } = useAuth();
  const [settings, setSettings] = useState<SiteSettings | null>(null);
  const [form, setForm] = useState<SiteSettings>({ restore_throttle_rate: "", manual_backup_throttle_rate: "" });
  const [saving, setSaving] = useState(false);
  const [saveMsg, setSaveMsg] = useState<string | null>(null);
  const [saveErr, setSaveErr] = useState(false);
  const [resetting, setResetting] = useState(false);
  const [resetMsg, setResetMsg] = useState<string | null>(null);

  useEffect(() => {
    if (!accessToken) return;
    void getSiteSettings(accessToken).then((s) => {
      setSettings(s);
      setForm({ ...s });
    });
  }, [accessToken]);

  const handleSave = async () => {
    if (!accessToken) return;
    setSaving(true);
    setSaveMsg(null);
    try {
      const updated = await updateSiteSettings(accessToken, form);
      setSettings(updated);
      setForm({ ...updated });
      setSaveErr(false);
      setSaveMsg("Settings saved.");
    } catch (err) {
      setSaveErr(true);
      setSaveMsg(err instanceof Error ? err.message : "Failed to save.");
    } finally {
      setSaving(false);
    }
  };

  const handleReset = async () => {
    if (!accessToken) return;
    setResetting(true);
    setResetMsg(null);
    try {
      const res = await resetThrottles(accessToken);
      setResetMsg(`Cleared ${res.cleared} throttle counter${res.cleared !== 1 ? "s" : ""}.`);
    } catch (err) {
      setResetMsg(err instanceof Error ? err.message : "Failed to reset.");
    } finally {
      setResetting(false);
    }
  };

  const isDirty = settings !== null && (
    form.restore_throttle_rate !== settings.restore_throttle_rate ||
    form.manual_backup_throttle_rate !== settings.manual_backup_throttle_rate
  );

  return (
    <Card>
      <CardTitle>System — Rate Limits</CardTitle>
      <p className="mb-2 text-xs text-muted-foreground">
        Format: <code className="rounded bg-muted px-1 py-0.5 font-mono text-xs">N/period</code> where period is{" "}
        <code className="rounded bg-muted px-1 py-0.5 font-mono text-xs">second</code>,{" "}
        <code className="rounded bg-muted px-1 py-0.5 font-mono text-xs">minute</code>,{" "}
        <code className="rounded bg-muted px-1 py-0.5 font-mono text-xs">hour</code>, or{" "}
        <code className="rounded bg-muted px-1 py-0.5 font-mono text-xs">day</code>.
      </p>
      <Divider />

      <SettingRow
        label="Restore Throttle"
        hint="Max restore requests per user."
      >
        <Input
          className="max-w-xs"
          placeholder="e.g. 30/hour"
          value={form.restore_throttle_rate}
          onChange={(e) => setForm((f) => ({ ...f, restore_throttle_rate: e.target.value }))}
        />
      </SettingRow>

      <Divider />

      <SettingRow
        label="Manual Backup Throttle"
        hint="Max manual trigger requests per user."
      >
        <Input
          className="max-w-xs"
          placeholder="e.g. 60/hour"
          value={form.manual_backup_throttle_rate}
          onChange={(e) => setForm((f) => ({ ...f, manual_backup_throttle_rate: e.target.value }))}
        />
      </SettingRow>

      <Divider />

      <div className="mt-4 flex flex-wrap items-center gap-3">
        <Button size="sm" onClick={() => void handleSave()} disabled={saving || !isDirty}>
          {saving ? "Saving…" : "Save Rate Limits"}
        </Button>
        <Feedback message={saveMsg} isError={saveErr} />
      </div>

      <div className="mt-6 rounded-xl border border-border bg-muted/30 p-4">
        <p className="text-sm font-medium text-foreground">Throttle Counters</p>
        <p className="mt-1 text-xs text-muted-foreground">
          Clear all active rate-limit counters in Redis. Use this after reducing a rate to immediately
          unblock users, or after changing throttle values.
        </p>
        <div className="mt-3 flex items-center gap-3">
          <Button size="sm" variant="secondary" onClick={() => void handleReset()} disabled={resetting}>
            {resetting ? "Clearing…" : "Reset All Throttle Counters"}
          </Button>
          {resetMsg && <span className="text-xs text-muted-foreground">{resetMsg}</span>}
        </div>
      </div>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

export function SettingsPage() {
  const { user } = useAuth();

  return (
    <Section label="settings" title="Settings">
      <div className="space-y-6 max-w-3xl">
        <ProfileSection />
        {user?.role === "ADMIN" && <SystemSection />}
      </div>
    </Section>
  );
}
