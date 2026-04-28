"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  CheckCircle2,
  Circle,
  ExternalLink,
  Facebook,
  Globe,
  Instagram,
  Linkedin,
  Loader2,
  Mail,
  Phone,
  ShieldCheck,
  Twitter,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import type { CompanyRow } from "@/lib/leads";

interface PromoterVerifyButtonProps {
  company: Pick<
    CompanyRow,
    | "id"
    | "name"
    | "website"
    | "email"
    | "phone"
    | "linkedinUrl"
    | "instagramUrl"
    | "facebookUrl"
    | "twitterUrl"
    | "websiteVerified"
    | "emailVerified"
    | "phoneVerified"
    | "linkedinVerified"
    | "instagramVerified"
    | "facebookVerified"
    | "twitterVerified"
    | "verifiedAt"
  >;
}

type FieldKey = "website" | "email" | "phone" | "linkedin" | "instagram" | "facebook" | "twitter";

interface FieldDef {
  key: FieldKey;
  label: string;
  icon: typeof Globe;
  placeholder: string;
  inputType: "url" | "email" | "tel" | "text";
  hrefTemplate?: (v: string) => string;
}

const FIELDS: FieldDef[] = [
  { key: "website", label: "Website", icon: Globe, placeholder: "https://empresa.com", inputType: "url", hrefTemplate: (v) => v },
  { key: "email", label: "Email", icon: Mail, placeholder: "info@empresa.com", inputType: "email", hrefTemplate: (v) => `mailto:${v}` },
  { key: "phone", label: "Teléfono", icon: Phone, placeholder: "+34 91 234 56 78", inputType: "tel", hrefTemplate: (v) => `tel:${v}` },
  { key: "linkedin", label: "LinkedIn", icon: Linkedin, placeholder: "https://linkedin.com/company/...", inputType: "url", hrefTemplate: (v) => v },
  { key: "instagram", label: "Instagram", icon: Instagram, placeholder: "https://instagram.com/...", inputType: "url", hrefTemplate: (v) => v },
  { key: "facebook", label: "Facebook", icon: Facebook, placeholder: "https://facebook.com/...", inputType: "url", hrefTemplate: (v) => v },
  { key: "twitter", label: "Twitter / X", icon: Twitter, placeholder: "https://x.com/...", inputType: "url", hrefTemplate: (v) => v },
];

export function PromoterVerifyButton({ company }: PromoterVerifyButtonProps) {
  const router = useRouter();
  const [, startTransition] = useTransition();
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Estado optimista por campo: valor + verified.
  const [values, setValues] = useState<Record<FieldKey, string>>({
    website: company.website ?? "",
    email: company.email ?? "",
    phone: company.phone ?? "",
    linkedin: company.linkedinUrl ?? "",
    instagram: company.instagramUrl ?? "",
    facebook: company.facebookUrl ?? "",
    twitter: company.twitterUrl ?? "",
  });
  const [verified, setVerified] = useState<Record<FieldKey, boolean>>({
    website: company.websiteVerified,
    email: company.emailVerified,
    phone: company.phoneVerified,
    linkedin: company.linkedinVerified,
    instagram: company.instagramVerified,
    facebook: company.facebookVerified,
    twitter: company.twitterVerified,
  });

  // Lo que está realmente guardado en DB — referencia para detectar cambios.
  const [saved, setSaved] = useState({
    values: { ...values },
    verified: { ...verified },
  });
  const [pending, setPending] = useState<FieldKey | null>(null);

  const verifiedCount = FIELDS.filter((f) => values[f.key].trim() && verified[f.key]).length;
  const totalWithValue = FIELDS.filter((f) => values[f.key].trim()).length;

  async function patch(field: FieldKey, body: { value?: string | null; verified?: boolean }) {
    setError(null);
    setPending(field);
    try {
      const res = await fetch(`/api/companies/${company.id}/verify`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ field, ...body }),
      });
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        throw new Error(j.error ?? `HTTP ${res.status}`);
      }
      // Confirmamos lo guardado.
      setSaved((s) => ({
        values: body.value !== undefined ? { ...s.values, [field]: body.value ?? "" } : s.values,
        verified: body.verified !== undefined ? { ...s.verified, [field]: body.verified } : s.verified,
      }));
      startTransition(() => router.refresh());
    } catch (err) {
      // Rollback: revertimos al último valor guardado.
      if (body.value !== undefined) setValues((s) => ({ ...s, [field]: saved.values[field] }));
      if (body.verified !== undefined) setVerified((s) => ({ ...s, [field]: saved.verified[field] }));
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setPending(null);
    }
  }

  function onValueBlur(field: FieldKey) {
    const newVal = values[field].trim();
    const oldVal = saved.values[field];
    if (newVal === oldVal) return;
    void patch(field, { value: newVal || null });
  }

  function onToggle(field: FieldKey) {
    const next = !verified[field];
    setVerified((s) => ({ ...s, [field]: next }));
    void patch(field, { verified: next });
  }

  return (
    <>
      <Button
        variant={verifiedCount > 0 ? "outline" : "ghost"}
        size="sm"
        className="h-7 px-2 text-xs gap-1"
        onClick={() => setOpen(true)}
        title={`${verifiedCount}/${totalWithValue} verificados (${FIELDS.length} canales)`}
      >
        <ShieldCheck
          className={`w-3.5 h-3.5 ${
            verifiedCount === totalWithValue && totalWithValue > 0
              ? "text-emerald-600"
              : verifiedCount > 0
                ? "text-amber-600"
                : "text-muted-foreground"
          }`}
        />
        <span className="tabular-nums">
          {verifiedCount}/{totalWithValue}
        </span>
      </Button>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>{company.name}</DialogTitle>
            <DialogDescription>
              Editá los valores y marcá los que verificaste como reales.{" "}
              {company.verifiedAt && (
                <span className="text-xs text-muted-foreground">
                  Última edición:{" "}
                  {new Date(company.verifiedAt).toLocaleString("es-ES", { dateStyle: "short", timeStyle: "short" })}
                </span>
              )}
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-1.5 max-h-[60vh] overflow-y-auto pr-1">
            {FIELDS.map((f) => (
              <FieldRowView
                key={f.key}
                def={f}
                value={values[f.key]}
                verified={verified[f.key]}
                pending={pending === f.key}
                onChange={(v) => setValues((s) => ({ ...s, [f.key]: v }))}
                onBlur={() => onValueBlur(f.key)}
                onToggle={() => onToggle(f.key)}
              />
            ))}
          </div>

          {error && <div className="text-xs text-red-600 mt-2">{error}</div>}
        </DialogContent>
      </Dialog>
    </>
  );
}

interface FieldRowViewProps {
  def: FieldDef;
  value: string;
  verified: boolean;
  pending: boolean;
  onChange: (v: string) => void;
  onBlur: () => void;
  onToggle: () => void;
}

function FieldRowView({ def, value, verified, pending, onChange, onBlur, onToggle }: FieldRowViewProps) {
  const Icon = def.icon;
  const hasValue = value.trim().length > 0;
  const href = hasValue && def.hrefTemplate ? def.hrefTemplate(value.trim()) : null;
  const [editing, setEditing] = useState(false);

  // Si hay valor y NO estamos editando, mostramos como link compacto.
  // Click para editar.
  return (
    <div
      className={`flex items-center gap-3 px-3 py-2 rounded-md border ${
        verified && hasValue
          ? "border-emerald-200 bg-emerald-50/50"
          : !hasValue
            ? "border-dashed border-border"
            : "border-border bg-card"
      }`}
    >
      <Icon className={`w-4 h-4 shrink-0 ${hasValue ? "text-foreground" : "text-muted-foreground"}`} />
      <div className="flex-1 min-w-0">
        <div className="text-xs font-semibold flex items-center justify-between">
          <span>{def.label}</span>
          {href && !editing && (
            <a
              href={href}
              target="_blank"
              rel="noopener noreferrer"
              className="text-[10px] text-muted-foreground hover:text-primary inline-flex items-center gap-0.5"
              onClick={(e) => e.stopPropagation()}
            >
              abrir <ExternalLink className="w-2.5 h-2.5" />
            </a>
          )}
        </div>
        <Input
          type={def.inputType}
          value={value}
          placeholder={def.placeholder}
          onChange={(e) => onChange(e.target.value)}
          onBlur={onBlur}
          onKeyDown={(e) => {
            if (e.key === "Enter") (e.target as HTMLInputElement).blur();
          }}
          onFocus={() => setEditing(true)}
          className="h-7 text-xs mt-1 px-2"
        />
      </div>
      <button
        type="button"
        disabled={pending || !hasValue}
        onClick={onToggle}
        className="shrink-0 disabled:opacity-50"
        aria-label={`Marcar ${def.label} como ${verified ? "no verificado" : "verificado"}`}
      >
        {pending ? (
          <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" />
        ) : verified ? (
          <CheckCircle2 className="w-5 h-5 text-emerald-600" />
        ) : (
          <Circle className="w-5 h-5 text-muted-foreground" />
        )}
      </button>
    </div>
  );
}
