"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Pencil, Loader2, AlertCircle, CheckCircle2 } from "lucide-react";

import { Switch } from "@/components/ui/switch";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

interface SourceRowActionsProps {
  id: number;
  slug: string;
  name: string;
  baseUrl: string | null;
  active: boolean;
  config: unknown;
  notes: string | null;
  token?: string;
}

export function SourceRowActions({
  id,
  slug,
  name,
  baseUrl,
  active,
  config,
  notes,
  token,
}: SourceRowActionsProps) {
  const router = useRouter();
  const [, startTransition] = useTransition();
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [optimisticActive, setOptimisticActive] = useState(active);
  const [configText, setConfigText] = useState(() => formatJson(config));
  const [notesText, setNotesText] = useState(notes ?? "");

  async function patch(body: Record<string, unknown>) {
    setError(null);
    const url = token
      ? `/api/admin/sources/${id}?token=${encodeURIComponent(token)}`
      : `/api/admin/sources/${id}`;
    const res = await fetch(url, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      const j = await res.json().catch(() => ({}));
      throw new Error(j.error ?? `HTTP ${res.status}`);
    }
    startTransition(() => router.refresh());
  }

  async function handleToggle(value: boolean) {
    setOptimisticActive(value);
    try {
      await patch({ active: value });
    } catch (err) {
      setOptimisticActive(!value);
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  async function handleSave() {
    setSaving(true);
    setError(null);
    try {
      let parsed: unknown = {};
      const trimmed = configText.trim();
      if (trimmed) {
        try {
          parsed = JSON.parse(trimmed);
        } catch (e) {
          throw new Error("JSON inválido: " + (e instanceof Error ? e.message : String(e)));
        }
      }
      await patch({ config: parsed, notes: notesText.trim() || null });
      setOpen(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="flex items-center gap-2 justify-end">
      <Switch
        checked={optimisticActive}
        onCheckedChange={handleToggle}
        aria-label={`Activar/desactivar ${slug}`}
      />
      <Button variant="outline" size="sm" className="h-7 text-xs" onClick={() => setOpen(true)}>
        <Pencil className="w-3 h-3" />
        Config
      </Button>

      <Dialog
        open={open}
        onOpenChange={(v) => {
          if (!v) {
            setError(null);
            setConfigText(formatJson(config));
            setNotesText(notes ?? "");
          }
          setOpen(v);
        }}
      >
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>{name}</DialogTitle>
            <DialogDescription>
              <span className="font-mono text-xs">{slug}</span>
              {baseUrl && (
                <>
                  {" · "}
                  <a href={baseUrl} target="_blank" rel="noopener noreferrer" className="underline">
                    {baseUrl}
                  </a>
                </>
              )}
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-3">
            <div>
              <label className="text-xs font-semibold mb-1 block">
                Configuración del scraper (JSON)
              </label>
              <Textarea
                value={configText}
                onChange={(e) => setConfigText(e.target.value)}
                className="font-mono text-xs min-h-[220px]"
                placeholder='{ "strategy": "sitemap", "events_path": "/eventos" }'
                spellCheck={false}
              />
              <p className="text-[11px] text-muted-foreground mt-1">
                Estrategias soportadas (Fase 2B): <code>sitemap</code>, <code>jsonld</code>,{" "}
                <code>selectors</code>. Dejá <code>{"{}"}</code> hasta tener config real.
              </p>
            </div>

            <div>
              <label className="text-xs font-semibold mb-1 block">Notas</label>
              <Textarea
                value={notesText}
                onChange={(e) => setNotesText(e.target.value)}
                className="text-xs min-h-[80px]"
                placeholder="Anotaciones internas — comisiones, contactos, particularidades..."
              />
            </div>

            {error && (
              <div className="flex items-start gap-2 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">
                <AlertCircle className="w-3.5 h-3.5 mt-0.5 shrink-0" />
                <span>{error}</span>
              </div>
            )}
          </div>

          <DialogFooter>
            <Button variant="ghost" onClick={() => setOpen(false)} disabled={saving}>
              Cancelar
            </Button>
            <Button onClick={handleSave} disabled={saving}>
              {saving ? (
                <>
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  Guardando…
                </>
              ) : (
                <>
                  <CheckCircle2 className="w-3.5 h-3.5" />
                  Guardar
                </>
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function formatJson(v: unknown): string {
  if (v == null) return "{}";
  if (typeof v === "string") {
    try {
      return JSON.stringify(JSON.parse(v), null, 2);
    } catch {
      return v;
    }
  }
  try {
    return JSON.stringify(v, null, 2);
  } catch {
    return "{}";
  }
}
