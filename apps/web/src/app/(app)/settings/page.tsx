"use client";

import React from "react";
import { Loader2, ShieldAlert, ShieldCheck, Trash2 } from "lucide-react";

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useToast } from "@/components/ui/toast";
import { api, ApiError } from "@/lib/api";
import { validateName, validatePassword } from "@/lib/validate";

export default function SettingsPage() {
  const { toast } = useToast();
  const [profile, setProfile] = React.useState({ name: "", email: "" });
  const [passwords, setPasswords] = React.useState({ currentPassword: "", newPassword: "", confirm: "" });
  const [savingProfile, setSavingProfile] = React.useState(false);
  const [savingPassword, setSavingPassword] = React.useState(false);
  const [deleteOpen, setDeleteOpen] = React.useState(false);
  const [deleting, setDeleting] = React.useState(false);

  React.useEffect(() => {
    api
      .get<{ user: { name: string; email: string } }>("/api/auth/me")
      .then((result) => setProfile({ name: result.user.name, email: result.user.email }))
      .catch(() => undefined);
  }, []);

  const saveProfile = async (event: React.FormEvent) => {
    event.preventDefault();
    const error = validateName(profile.name);
    if (error) {
      toast({ title: "Check your name", description: error, variant: "error" });
      return;
    }
    setSavingProfile(true);
    try {
      await api.patch("/api/auth/profile", { name: profile.name });
      toast({ title: "Profile updated", variant: "success" });
    } catch (err) {
      toast({ title: "Update failed", description: err instanceof ApiError ? err.message : undefined, variant: "error" });
    } finally {
      setSavingProfile(false);
    }
  };

  const savePassword = async (event: React.FormEvent) => {
    event.preventDefault();
    const error = validatePassword(passwords.newPassword);
    if (error) {
      toast({ title: "Password too weak", description: error, variant: "error" });
      return;
    }
    if (passwords.newPassword !== passwords.confirm) {
      toast({ title: "Passwords do not match", variant: "error" });
      return;
    }
    setSavingPassword(true);
    try {
      await api.patch("/api/auth/password", {
        currentPassword: passwords.currentPassword,
        newPassword: passwords.newPassword,
      });
      setPasswords({ currentPassword: "", newPassword: "", confirm: "" });
      toast({
        title: "Password changed",
        description: "All other sessions have been signed out.",
        variant: "success",
      });
    } catch (err) {
      toast({ title: "Could not change password", description: err instanceof ApiError ? err.message : undefined, variant: "error" });
    } finally {
      setSavingPassword(false);
    }
  };

  const deleteAccount = async () => {
    setDeleting(true);
    try {
      await api.delete("/api/auth/account");
      window.location.href = "/";
    } catch (err) {
      toast({
        title: "Could not delete account",
        description: err instanceof ApiError ? err.message : undefined,
        variant: "error",
      });
      setDeleting(false);
    }
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Settings</h1>
        <p className="mt-1 text-sm text-muted-foreground">Profile, security and privacy.</p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Profile</CardTitle>
          <CardDescription>Your name is used on invoices and in the app.</CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={saveProfile} className="space-y-4">
            <div className="space-y-1.5">
              <Label htmlFor="email">Email</Label>
              <Input id="email" value={profile.email} disabled />
              <p className="text-xs text-muted-foreground">Email changes are not supported yet.</p>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="name">Full name</Label>
              <Input id="name" value={profile.name} onChange={(event) => setProfile({ ...profile, name: event.target.value })} />
            </div>
            <Button type="submit" disabled={savingProfile}>
              {savingProfile ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
              Save changes
            </Button>
          </form>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Password</CardTitle>
          <CardDescription>Changing it signs out every other session.</CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={savePassword} className="space-y-4">
            <div className="space-y-1.5">
              <Label htmlFor="current">Current password</Label>
              <Input
                id="current"
                type="password"
                autoComplete="current-password"
                value={passwords.currentPassword}
                onChange={(event) => setPasswords({ ...passwords, currentPassword: event.target.value })}
              />
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label htmlFor="new">New password</Label>
                <Input
                  id="new"
                  type="password"
                  autoComplete="new-password"
                  value={passwords.newPassword}
                  onChange={(event) => setPasswords({ ...passwords, newPassword: event.target.value })}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="confirm">Confirm new password</Label>
                <Input
                  id="confirm"
                  type="password"
                  autoComplete="new-password"
                  value={passwords.confirm}
                  onChange={(event) => setPasswords({ ...passwords, confirm: event.target.value })}
                />
              </div>
            </div>
            <Button type="submit" disabled={savingPassword}>
              {savingPassword ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
              Update password
            </Button>
          </form>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Privacy &amp; data</CardTitle>
          <CardDescription>What happens to your documents.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-start gap-3 rounded-lg border p-3">
            <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-emerald-600" />
            <div className="text-sm">
              <p className="font-medium">Automatic deletion</p>
              <p className="mt-1 text-xs text-muted-foreground">
                Uploads and outputs are deleted 7 days after the job finishes (configurable per deployment). You can
                delete any job immediately from History.
              </p>
            </div>
          </div>
          <div className="flex items-start gap-3 rounded-lg border p-3">
            <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-emerald-600" />
            <div className="text-sm">
              <p className="font-medium">Never used for training</p>
              <p className="mt-1 text-xs text-muted-foreground">
                Your documents are sent to the model provider only to produce your rewrite, and are not used to train
                models.
              </p>
            </div>
          </div>
        </CardContent>
      </Card>

      <Alert variant="destructive">
        <ShieldAlert className="h-4 w-4" />
        <AlertTitle>Danger zone</AlertTitle>
        <AlertDescription className="space-y-3">
          <p>Deleting your account removes every job, file and invoice permanently.</p>
          <Button variant="destructive" size="sm" onClick={() => setDeleteOpen(true)}>
            <Trash2 className="h-4 w-4" /> Delete account
          </Button>
        </AlertDescription>
      </Alert>

      <Dialog
        open={deleteOpen}
        onClose={() => setDeleteOpen(false)}
        title="Delete your account?"
        description="This permanently deletes every document, job, invoice and your account. It cannot be undone."
      >
        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={() => setDeleteOpen(false)}>
            Cancel
          </Button>
          <Button variant="destructive" onClick={deleteAccount} disabled={deleting}>
            {deleting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />}
            Delete everything
          </Button>
        </div>
      </Dialog>
    </div>
  );
}
