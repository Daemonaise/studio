"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Loader2, User } from "lucide-react";

export function NameGate({ email }: { email: string }) {
  const router = useRouter();
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const name = `${firstName.trim()} ${lastName.trim()}`.trim();
    if (!name || name.length < 2) {
      setError("Please enter your full name.");
      return;
    }
    setSaving(true);
    setError("");
    try {
      const res = await fetch("/api/auth/update-name", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || "Failed to update name");
      }
      // Reload the page to pick up the updated session
      router.refresh();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Something went wrong");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-background p-4">
      <div className="w-full max-w-md space-y-6">
        <div className="absolute -inset-8 rounded-3xl bg-gradient-to-br from-accent/10 via-accent/5 to-transparent blur-2xl pointer-events-none" />
        <div className="relative rounded-xl border border-accent/20 bg-card p-8 shadow-lg space-y-6">
          <div className="text-center space-y-2">
            <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-accent/10">
              <User className="h-6 w-6 text-accent" />
            </div>
            <h1 className="text-2xl font-bold tracking-tight">Complete Your Profile</h1>
            <p className="text-sm text-muted-foreground">
              We need your name to personalize your Karaslice experience.
            </p>
          </div>

          <form onSubmit={handleSubmit} className="space-y-4">
            {email && (
              <div className="space-y-1">
                <label className="text-xs font-medium text-muted-foreground">Email</label>
                <p className="text-sm font-mono text-foreground/70">{email}</p>
              </div>
            )}
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <label htmlFor="firstName" className="text-xs font-medium text-muted-foreground">First name</label>
                <input
                  id="firstName"
                  type="text"
                  required
                  value={firstName}
                  onChange={(e) => setFirstName(e.target.value)}
                  className="w-full h-10 rounded-md border border-border bg-background px-3 text-sm focus:outline-none focus:ring-2 focus:ring-accent"
                  placeholder="Jane"
                />
              </div>
              <div className="space-y-1">
                <label htmlFor="lastName" className="text-xs font-medium text-muted-foreground">Last name</label>
                <input
                  id="lastName"
                  type="text"
                  required
                  value={lastName}
                  onChange={(e) => setLastName(e.target.value)}
                  className="w-full h-10 rounded-md border border-border bg-background px-3 text-sm focus:outline-none focus:ring-2 focus:ring-accent"
                  placeholder="Smith"
                />
              </div>
            </div>

            {error && (
              <p className="text-sm text-red-400">{error}</p>
            )}

            <Button
              type="submit"
              className="w-full"
              style={{ backgroundColor: "hsl(var(--accent))", color: "hsl(var(--accent-foreground))" }}
              disabled={saving || !firstName.trim() || !lastName.trim()}
            >
              {saving ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
              {saving ? "Saving..." : "Continue to Karaslice"}
            </Button>
          </form>
        </div>
      </div>
    </div>
  );
}
