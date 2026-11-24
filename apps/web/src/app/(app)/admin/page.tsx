"use client";

import Link from "next/link";
import React from "react";
import {
  AlertTriangle,
  Award,
  Check,
  CreditCard,
  Download,
  Edit,
  Key,
  Loader2,
  Play,
  RotateCcw,
  ShieldCheck,
  Sliders,
  Trash2,
  UserCheck,
  UserX,
} from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Dialog } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Progress } from "@/components/ui/progress";
import { Select } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useToast } from "@/components/ui/toast";
import { api, ApiError, type Job } from "@/lib/api";
import { formatDateTime } from "@/lib/utils";

type Stats = { users: number; jobs: number; jobs_done: number; pages_processed: number; tokens_processed: number };

type AdminUser = {
  id: string;
  email: string;
  name: string;
  role: "user" | "admin";
  verified: boolean;
  tier: string;
  pages_used: number;
  pages_per_month: number;
  pages_remaining: number;
  sub_status: string;
  current_period_end: string | null;
  created_at: string;
};

type AdminJob = Job & {
  user_id: string;
  user_email?: string;
  user_name?: string;
};

type Audit = { id: string; user_id: string | null; action: string; meta: Record<string, unknown>; created_at: string };

type SystemSettings = {
  llm_provider: string;
  gemini_api_key_set: boolean;
  gemini_model: string;
  anthropic_api_key_set: boolean;
  anthropic_model: string;
  openai_api_key_set: boolean;
  openai_model: string;
  tier_free_pages: number;
  tier_starter_pages: number;
  tier_pro_pages: number;
  tier_studio_pages: number;
};

export default function AdminPage() {
  const { toast } = useToast();
  const [stats, setStats] = React.useState<Stats | null>(null);
  const [users, setUsers] = React.useState<AdminUser[] | null>(null);
  const [jobs, setJobs] = React.useState<AdminJob[] | null>(null);
  const [audit, setAudit] = React.useState<Audit[] | null>(null);
  const [settings, setSettings] = React.useState<SystemSettings | null>(null);
  const [busy, setBusy] = React.useState<string | null>(null);

  // Modal states
  const [planUser, setPlanUser] = React.useState<AdminUser | null>(null);
  const [editUser, setEditUser] = React.useState<AdminUser | null>(null);
  const [deleteUserTarget, setDeleteUserTarget] = React.useState<AdminUser | null>(null);
  const [deleteJobTarget, setDeleteJobTarget] = React.useState<AdminJob | null>(null);

  // Plan Form State
  const [planTier, setPlanTier] = React.useState("starter");
  const [planPages, setPlanPages] = React.useState(100);
  const [resetUsage, setResetUsage] = React.useState(false);

  // Edit User Form State
  const [editName, setEditName] = React.useState("");
  const [editEmail, setEditEmail] = React.useState("");
  const [editRole, setEditRole] = React.useState<"user" | "admin">("user");
  const [editVerified, setEditVerified] = React.useState(false);
  const [editPassword, setEditPassword] = React.useState("");

  // Settings Form State
  const [llmProvider, setLlmProvider] = React.useState("auto");
  const [geminiKey, setGeminiKey] = React.useState("");
  const [anthropicKey, setAnthropicKey] = React.useState("");
  const [openaiKey, setOpenaiKey] = React.useState("");

  const load = React.useCallback(async () => {
    try {
      setStats(await api.get<Stats>("/backend/admin/stats"));
    } catch {
      setStats(null);
    }
    try {
      setUsers((await api.get<{ users: AdminUser[] }>("/backend/admin/users")).users);
    } catch {
      setUsers([]);
    }
    try {
      setJobs((await api.get<{ jobs: AdminJob[] }>("/backend/admin/jobs")).jobs);
    } catch {
      setJobs([]);
    }
    try {
      setAudit((await api.get<{ logs: Audit[] }>("/backend/admin/audit")).logs);
    } catch {
      setAudit([]);
    }
    try {
      const cfg = await api.get<SystemSettings>("/backend/admin/settings");
      setSettings(cfg);
      setLlmProvider(cfg.llm_provider || "auto");
    } catch {
      setSettings(null);
    }
  }, []);

  React.useEffect(() => {
    void load();
  }, [load]);

  // Open Plan Modal
  const openPlanModal = (user: AdminUser) => {
    setPlanUser(user);
    setPlanTier(user.tier || "starter");
    setPlanPages(user.pages_per_month || 100);
    setResetUsage(false);
  };

  // Save Plan
  const savePlan = async () => {
    if (!planUser) return;
    setBusy("saving-plan");
    try {
      await api.post(`/backend/admin/users/${planUser.id}/plan`, {
        tier: planTier,
        pages_per_month: planPages,
        reset_usage: resetUsage,
      });
      toast({ title: `Plan assigned to ${planUser.email}`, variant: "success" });
      setPlanUser(null);
      await load();
    } catch (err) {
      toast({ title: "Failed to assign plan", description: err instanceof ApiError ? err.message : undefined, variant: "error" });
    } finally {
      setBusy(null);
    }
  };

  // Open Edit User Modal
  const openEditModal = (user: AdminUser) => {
    setEditUser(user);
    setEditName(user.name);
    setEditEmail(user.email);
    setEditRole(user.role);
    setEditVerified(user.verified);
    setEditPassword("");
  };

  // Save User Edit
  const saveUserEdit = async () => {
    if (!editUser) return;
    setBusy("saving-user");
    try {
      const payload: Record<string, unknown> = {
        name: editName,
        email: editEmail,
        role: editRole,
        verified: editVerified,
      };
      if (editPassword.trim()) {
        payload.password = editPassword.trim();
      }
      await api.patch(`/backend/admin/users/${editUser.id}`, payload);
      toast({ title: "User updated successfully", variant: "success" });
      setEditUser(null);
      await load();
    } catch (err) {
      toast({ title: "Failed to update user", description: err instanceof ApiError ? err.message : undefined, variant: "error" });
    } finally {
      setBusy(null);
    }
  };

  // Confirm Delete User
  const executeDeleteUser = async () => {
    if (!deleteUserTarget) return;
    setBusy("deleting-user");
    try {
      await api.delete(`/backend/admin/users/${deleteUserTarget.id}`);
      toast({ title: `User ${deleteUserTarget.email} deleted`, variant: "success" });
      setDeleteUserTarget(null);
      await load();
    } catch (err) {
      toast({ title: "Failed to delete user", description: err instanceof ApiError ? err.message : undefined, variant: "error" });
    } finally {
      setBusy(null);
    }
  };

  // Delete Job
  const executeDeleteJob = async () => {
    if (!deleteJobTarget) return;
    setBusy("deleting-job");
    try {
      await api.delete(`/backend/admin/jobs/${deleteJobTarget.id}`);
      toast({ title: "Job and storage files purged", variant: "success" });
      setDeleteJobTarget(null);
      await load();
    } catch (err) {
      toast({ title: "Failed to delete job", description: err instanceof ApiError ? err.message : undefined, variant: "error" });
    } finally {
      setBusy(null);
    }
  };

  // Restart Job
  const restartJob = async (jobId: string) => {
    setBusy(jobId);
    try {
      await api.post(`/backend/admin/jobs/${jobId}/restart`);
      toast({ title: "Job restarted in queue", variant: "success" });
      await load();
    } catch (err) {
      toast({ title: "Failed to restart job", description: err instanceof ApiError ? err.message : undefined, variant: "error" });
    } finally {
      setBusy(null);
    }
  };

  // Save Settings
  const saveSettings = async () => {
    setBusy("saving-settings");
    try {
      const payload: Record<string, string> = { llm_provider: llmProvider };
      if (geminiKey.trim()) payload.gemini_api_key = geminiKey.trim();
      if (anthropicKey.trim()) payload.anthropic_api_key = anthropicKey.trim();
      if (openaiKey.trim()) payload.openai_api_key = openaiKey.trim();
      await api.post("/backend/admin/settings", payload);
      toast({ title: "System AI settings saved", variant: "success" });
      setGeminiKey("");
      setAnthropicKey("");
      setOpenaiKey("");
      await load();
    } catch (err) {
      toast({ title: "Failed to save settings", description: err instanceof ApiError ? err.message : undefined, variant: "error" });
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <ShieldCheck className="h-6 w-6 text-primary" />
          <div>
            <h1 className="text-2xl font-semibold tracking-tight">Admin Portal</h1>
            <p className="text-sm text-muted-foreground">
              Full control: manage plans, user quotas, account edits, jobs, and AI settings.
            </p>
          </div>
        </div>
        <Button variant="outline" size="sm" onClick={load}>
          Refresh data
        </Button>
      </div>

      {!stats ? (
        <Skeleton className="h-24 w-full" />
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
          {[
            ["Total Users", stats.users],
            ["Total Jobs", stats.jobs],
            ["Completed Jobs", stats.jobs_done],
            ["Pages Processed", stats.pages_processed.toLocaleString()],
            ["Tokens Processed", stats.tokens_processed.toLocaleString()],
          ].map(([label, value]) => (
            <Card key={label}>
              <CardContent className="p-4">
                <p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">{label}</p>
                <p className="mt-1 text-2xl font-semibold">{value}</p>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      <Tabs defaultValue="users">
        <TabsList className="mb-4">
          <TabsTrigger value="users">Users & Plans</TabsTrigger>
          <TabsTrigger value="jobs">All Jobs</TabsTrigger>
          <TabsTrigger value="settings">AI & System Config</TabsTrigger>
          <TabsTrigger value="audit">Audit Log</TabsTrigger>
        </TabsList>

        {/* ---------------- USERS TAB ---------------- */}
        <TabsContent value="users">
          <Card>
            {!users ? (
              <CardContent className="p-5">
                <Skeleton className="h-48 w-full" />
              </CardContent>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>User / Email</TableHead>
                    <TableHead>Plan / Tier</TableHead>
                    <TableHead>Pages Used / Allowance</TableHead>
                    <TableHead>Role</TableHead>
                    <TableHead>Verified</TableHead>
                    <TableHead>Joined</TableHead>
                    <TableHead className="text-right">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {users.map((user) => {
                    const usagePct = Math.min(
                      100,
                      Math.round((user.pages_used / Math.max(1, user.pages_per_month)) * 100),
                    );
                    return (
                      <TableRow key={user.id}>
                        <TableCell>
                          <p className="text-sm font-semibold">{user.name}</p>
                          <p className="text-xs text-muted-foreground">{user.email}</p>
                        </TableCell>
                        <TableCell>
                          <Badge
                            variant={
                              user.tier === "studio" || user.tier === "enterprise"
                                ? "success"
                                : user.tier === "pro"
                                  ? "default"
                                  : user.tier === "starter"
                                    ? "secondary"
                                    : "outline"
                            }
                            className="capitalize"
                          >
                            {user.tier}
                          </Badge>
                        </TableCell>
                        <TableCell className="min-w-[160px]">
                          <div className="flex items-center justify-between text-xs">
                            <span>{user.pages_used} used</span>
                            <span className="font-medium">{user.pages_per_month} allowance</span>
                          </div>
                          <Progress value={usagePct} className="mt-1 h-1.5" />
                          <p className="mt-0.5 text-[10px] text-muted-foreground">{user.pages_remaining} pages left</p>
                        </TableCell>
                        <TableCell>
                          <Badge variant={user.role === "admin" ? "default" : "secondary"}>{user.role}</Badge>
                        </TableCell>
                        <TableCell>
                          <Badge variant={user.verified ? "success" : "warning"}>
                            {user.verified ? "Verified" : "Unverified"}
                          </Badge>
                        </TableCell>
                        <TableCell className="text-xs text-muted-foreground">
                          {formatDateTime(user.created_at)}
                        </TableCell>
                        <TableCell className="text-right space-x-1">
                          <Button
                            size="sm"
                            variant="outline"
                            className="h-8 gap-1 px-2 text-xs"
                            onClick={() => openPlanModal(user)}
                            title="Assign Plan & Quota"
                          >
                            <CreditCard className="h-3.5 w-3.5 text-primary" />
                            Plan
                          </Button>
                          <Button
                            size="sm"
                            variant="outline"
                            className="h-8 gap-1 px-2 text-xs"
                            onClick={() => openEditModal(user)}
                            title="Edit User Details & Password"
                          >
                            <Edit className="h-3.5 w-3.5" />
                            Edit
                          </Button>
                          <Button
                            size="sm"
                            variant="ghost"
                            className="h-8 px-2 text-xs text-destructive hover:bg-destructive/10"
                            onClick={() => setDeleteUserTarget(user)}
                            title="Delete User"
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </Button>
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            )}
          </Card>
        </TabsContent>

        {/* ---------------- JOBS TAB ---------------- */}
        <TabsContent value="jobs">
          <Card>
            {!jobs ? (
              <CardContent className="p-5">
                <Skeleton className="h-48 w-full" />
              </CardContent>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>File / Job ID</TableHead>
                    <TableHead>User</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead className="text-right">Pages</TableHead>
                    <TableHead className="text-right">Cost (USD)</TableHead>
                    <TableHead>Created</TableHead>
                    <TableHead className="text-right">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {jobs.map((job) => (
                    <TableRow key={job.id}>
                      <TableCell>
                        <Link
                          href={`/jobs/${job.id}`}
                          className="max-w-[28ch] truncate text-sm font-medium hover:underline block"
                        >
                          {job.filename}
                        </Link>
                        <p className="font-mono text-[11px] text-muted-foreground">{job.id.slice(0, 8)}</p>
                      </TableCell>
                      <TableCell>
                        <p className="text-xs font-medium">{job.user_name || "—"}</p>
                        <p className="text-[11px] text-muted-foreground">{job.user_email || "—"}</p>
                      </TableCell>
                      <TableCell>
                        <Badge
                          variant={
                            job.status === "done"
                              ? "success"
                              : job.status === "failed"
                                ? "destructive"
                                : job.status === "rewriting"
                                  ? "default"
                                  : "secondary"
                          }
                          className="capitalize"
                        >
                          {job.status}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-right text-xs">
                        {job.processed_pages} / {job.total_pages}
                      </TableCell>
                      <TableCell className="text-right font-mono text-xs">
                        ${job.cost_usd ? Number(job.cost_usd).toFixed(3) : "0.000"}
                      </TableCell>
                      <TableCell className="text-xs text-muted-foreground">{formatDateTime(job.created_at)}</TableCell>
                      <TableCell className="text-right space-x-1">
                        {job.status === "done" ? (
                          <Button size="sm" variant="outline" className="h-7 px-2 text-xs" asChild>
                            <Link href={`/jobs/${job.id}`}>
                              <Download className="h-3 w-3 mr-1" /> View
                            </Link>
                          </Button>
                        ) : null}
                        <Button
                          size="sm"
                          variant="ghost"
                          className="h-7 px-2 text-xs"
                          onClick={() => restartJob(job.id)}
                          disabled={busy === job.id}
                          title="Restart / Re-run Job"
                        >
                          {busy === job.id ? (
                            <Loader2 className="h-3 w-3 animate-spin" />
                          ) : (
                            <RotateCcw className="h-3 w-3" />
                          )}
                        </Button>
                        <Button
                          size="sm"
                          variant="ghost"
                          className="h-7 px-2 text-xs text-destructive hover:bg-destructive/10"
                          onClick={() => setDeleteJobTarget(job)}
                          title="Delete Job"
                        >
                          <Trash2 className="h-3 w-3" />
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </Card>
        </TabsContent>

        {/* ---------------- SETTINGS TAB ---------------- */}
        <TabsContent value="settings">
          <Card>
            <CardContent className="p-6 space-y-6">
              <div>
                <h3 className="text-lg font-semibold">AI Models & Rewrite Provider</h3>
                <p className="text-sm text-muted-foreground">
                  Configure which LLM powers the humanization engine across all documents.
                </p>
              </div>

              <div className="grid gap-4 sm:grid-cols-2">
                <div className="space-y-2">
                  <label className="text-sm font-medium">Active LLM Provider</label>
                  <Select
                    value={llmProvider}
                    onChange={(e) => setLlmProvider(e.target.value)}
                    className="w-full text-sm"
                  >
                    <option value="auto">Auto (Gemini &gt; Anthropic &gt; OpenAI &gt; Local)</option>
                    <option value="gemini">Google Gemini (gemini-2.5-flash / gemini-1.5-pro)</option>
                    <option value="anthropic">Anthropic Claude (claude-sonnet-4-5)</option>
                    <option value="openai">OpenAI (gpt-4o-mini / gpt-4o)</option>
                    <option value="local">Deep Local Humanizer (Rule-based, no external keys)</option>
                  </Select>
                </div>

                <div className="space-y-2">
                  <label className="text-sm font-medium">Google Gemini API Key</label>
                  <div className="relative">
                    <Input
                      type="password"
                      placeholder={settings?.gemini_api_key_set ? "•••••••••••• (Set)" : "Enter Gemini API Key"}
                      value={geminiKey}
                      onChange={(e) => setGeminiKey(e.target.value)}
                    />
                  </div>
                  <p className="text-[11px] text-muted-foreground">
                    Status: {settings?.gemini_api_key_set ? "Configured" : "Not set"}
                  </p>
                </div>

                <div className="space-y-2">
                  <label className="text-sm font-medium">Anthropic API Key</label>
                  <Input
                    type="password"
                    placeholder={settings?.anthropic_api_key_set ? "•••••••••••• (Set)" : "Enter Anthropic API Key"}
                    value={anthropicKey}
                    onChange={(e) => setAnthropicKey(e.target.value)}
                  />
                  <p className="text-[11px] text-muted-foreground">
                    Status: {settings?.anthropic_api_key_set ? "Configured" : "Not set"}
                  </p>
                </div>

                <div className="space-y-2">
                  <label className="text-sm font-medium">OpenAI API Key</label>
                  <Input
                    type="password"
                    placeholder={settings?.openai_api_key_set ? "•••••••••••• (Set)" : "Enter OpenAI API Key"}
                    value={openaiKey}
                    onChange={(e) => setOpenaiKey(e.target.value)}
                  />
                  <p className="text-[11px] text-muted-foreground">
                    Status: {settings?.openai_api_key_set ? "Configured" : "Not set"}
                  </p>
                </div>
              </div>

              <div className="pt-2">
                <Button onClick={saveSettings} disabled={busy === "saving-settings"}>
                  {busy === "saving-settings" ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : null}
                  Save AI Configuration
                </Button>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        {/* ---------------- AUDIT TAB ---------------- */}
        <TabsContent value="audit">
          <Card>
            {!audit ? (
              <CardContent className="p-5">
                <Skeleton className="h-40 w-full" />
              </CardContent>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Time</TableHead>
                    <TableHead>Action</TableHead>
                    <TableHead>User ID</TableHead>
                    <TableHead>Metadata</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {audit.map((entry) => (
                    <TableRow key={entry.id}>
                      <TableCell className="text-xs text-muted-foreground">{formatDateTime(entry.created_at)}</TableCell>
                      <TableCell className="font-mono text-xs font-semibold">{entry.action}</TableCell>
                      <TableCell className="font-mono text-xs">{entry.user_id?.slice(0, 8) ?? "System"}</TableCell>
                      <TableCell>
                        <code className="block max-w-md truncate text-[11px] text-muted-foreground">
                          {JSON.stringify(entry.meta)}
                        </code>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </Card>
        </TabsContent>
      </Tabs>

      {/* ================= MODAL: ASSIGN PLAN ================= */}
      <Dialog
        open={Boolean(planUser)}
        onClose={() => setPlanUser(null)}
        title="Assign Subscription Plan & Quota"
        description={`Set plan tier and page allowance for ${planUser?.email}`}
      >
        <div className="space-y-4">
          <div className="space-y-1.5">
            <label className="text-sm font-medium">Plan Tier</label>
            <Select
              value={planTier}
              onChange={(e) => {
                const t = e.target.value;
                setPlanTier(t);
                if (t === "free") setPlanPages(20);
                else if (t === "starter") setPlanPages(100);
                else if (t === "pro") setPlanPages(500);
                else if (t === "studio") setPlanPages(2000);
                else if (t === "enterprise") setPlanPages(10000);
              }}
              className="w-full text-sm"
            >
              <option value="free">Free (20 pages/mo)</option>
              <option value="starter">Starter (100 pages/mo)</option>
              <option value="pro">Pro (500 pages/mo)</option>
              <option value="studio">Studio (2,000 pages/mo)</option>
              <option value="enterprise">Enterprise (Custom)</option>
            </Select>
          </div>

          <div className="space-y-1.5">
            <label className="text-sm font-medium">Monthly Page Quota</label>
            <Input
              type="number"
              min={1}
              value={planPages}
              onChange={(e) => setPlanPages(Math.max(1, parseInt(e.target.value) || 0))}
            />
            <p className="text-[11px] text-muted-foreground">Number of document pages this user can process per month.</p>
          </div>

          <div className="flex items-center gap-2 pt-2">
            <input
              type="checkbox"
              id="resetUsageCheck"
              checked={resetUsage}
              onChange={(e) => setResetUsage(e.target.checked)}
              className="h-4 w-4 rounded border-gray-300"
            />
            <label htmlFor="resetUsageCheck" className="text-sm font-normal text-foreground">
              Reset used pages counter for current month (give fresh quota)
            </label>
          </div>

          <div className="flex justify-end gap-2 pt-4">
            <Button variant="outline" onClick={() => setPlanUser(null)}>
              Cancel
            </Button>
            <Button onClick={savePlan} disabled={busy === "saving-plan"}>
              {busy === "saving-plan" ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : null}
              Save Plan
            </Button>
          </div>
        </div>
      </Dialog>

      {/* ================= MODAL: EDIT USER ================= */}
      <Dialog
        open={Boolean(editUser)}
        onClose={() => setEditUser(null)}
        title="Edit User Profile & Rights"
        description={`Modify account details or reset password for ${editUser?.email}`}
      >
        <div className="space-y-4">
          <div className="space-y-1.5">
            <label className="text-sm font-medium">Name</label>
            <Input value={editName} onChange={(e) => setEditName(e.target.value)} />
          </div>

          <div className="space-y-1.5">
            <label className="text-sm font-medium">Email Address</label>
            <Input type="email" value={editEmail} onChange={(e) => setEditEmail(e.target.value)} />
          </div>

          <div className="space-y-1.5">
            <label className="text-sm font-medium">Role</label>
            <Select
              value={editRole}
              onChange={(e) => setEditRole(e.target.value as "user" | "admin")}
              className="w-full text-sm"
            >
              <option value="user">User (Standard Access)</option>
              <option value="admin">Admin (Full Control)</option>
            </Select>
          </div>

          <div className="flex items-center gap-2 pt-1">
            <input
              type="checkbox"
              id="verifiedCheck"
              checked={editVerified}
              onChange={(e) => setEditVerified(e.target.checked)}
              className="h-4 w-4 rounded border-gray-300"
            />
            <label htmlFor="verifiedCheck" className="text-sm">
              Email Verified
            </label>
          </div>

          <div className="space-y-1.5 border-t pt-3">
            <label className="text-sm font-medium text-destructive">Reset Password (Optional)</label>
            <Input
              type="password"
              placeholder="Leave blank to keep current password"
              value={editPassword}
              onChange={(e) => setEditPassword(e.target.value)}
            />
            <p className="text-[11px] text-muted-foreground">
              Enter a new password (min 8 characters) to reset it directly.
            </p>
          </div>

          <div className="flex justify-end gap-2 pt-4">
            <Button variant="outline" onClick={() => setEditUser(null)}>
              Cancel
            </Button>
            <Button onClick={saveUserEdit} disabled={busy === "saving-user"}>
              {busy === "saving-user" ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : null}
              Save Changes
            </Button>
          </div>
        </div>
      </Dialog>

      {/* ================= MODAL: DELETE USER CONFIRM ================= */}
      <Dialog
        open={Boolean(deleteUserTarget)}
        onClose={() => setDeleteUserTarget(null)}
        title="Delete User Account"
        description="Are you sure you want to delete this user? This action cannot be undone."
      >
        <div className="space-y-4">
          <p className="text-sm text-muted-foreground">
            User <strong className="text-foreground">{deleteUserTarget?.email}</strong> will be permanently removed.
            All their uploaded files, jobs, and history will be purged.
          </p>
          <div className="flex justify-end gap-2 pt-2">
            <Button variant="outline" onClick={() => setDeleteUserTarget(null)}>
              Cancel
            </Button>
            <Button variant="destructive" onClick={executeDeleteUser} disabled={busy === "deleting-user"}>
              {busy === "deleting-user" ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : null}
              Delete User Account
            </Button>
          </div>
        </div>
      </Dialog>

      {/* ================= MODAL: DELETE JOB CONFIRM ================= */}
      <Dialog
        open={Boolean(deleteJobTarget)}
        onClose={() => setDeleteJobTarget(null)}
        title="Delete Job & Storage Files"
        description="Permanently remove this job from the database and storage?"
      >
        <div className="space-y-4">
          <p className="text-sm text-muted-foreground">
            Document <strong className="text-foreground">{deleteJobTarget?.filename}</strong> ({deleteJobTarget?.id})
            and its associated artifacts will be deleted.
          </p>
          <div className="flex justify-end gap-2 pt-2">
            <Button variant="outline" onClick={() => setDeleteJobTarget(null)}>
              Cancel
            </Button>
            <Button variant="destructive" onClick={executeDeleteJob} disabled={busy === "deleting-job"}>
              {busy === "deleting-job" ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : null}
              Delete Job
            </Button>
          </div>
        </div>
      </Dialog>
    </div>
  );
}
