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

// Cada fila del modal: un canal con su valor + un toggle de "verificado".
type FieldKey = "website" | "email" | "phone" | "linkedin" | "instagram" | "facebook" | "twitter";

interface FieldRow {
  key: FieldKey;
  label: string;
  icon: typeof Globe;
  value: string | null;
  href: string | null;
  verified: boolean;
}

export function PromoterVerifyButton({ company }: PromoterVerifyButtonProps) {
  const router = useRouter();
  const [, startTransition] = useTransition();
  const [open, setOpen] = useState(false);
  // Estado optimista por campo — se aplica antes que llegue la respuesta.
  const [verified, setVerified] = useState({
    website: company.websiteVerified,
    email: company.emailVerified,
    phone: company.phoneVerified,
    linkedin: company.linkedinVerified,
    instagram: company.instagramVerified,
    facebook: company.facebookVerified,
    twitter: company.twitterVerified,
  });
  const [pending, setPending] = useState<FieldKey | null>(null);
  const [error, setError] = useState<string | null>(null);

  const rows: FieldRow[] = [
    {
      key: "website",
      label: "Website",
      icon: Globe,
      value: company.website,
      href: company.website,
      verified: verified.website,
    },
    {
      key: "email",
      label: "Email",
      icon: Mail,
      value: company.email,
      href: company.email ? `mailto:${company.email}` : null,
      verified: verified.email,
    },
    {
      key: "phone",
      label: "Teléfono",
      icon: Phone,
      value: company.phone,
      href: company.phone ? `tel:${company.phone}` : null,
      verified: verified.phone,
    },
    {
      key: "linkedin",
      label: "LinkedIn",
      icon: Linkedin,
      value: company.linkedinUrl,
      href: company.linkedinUrl,
      verified: verified.linkedin,
    },
    {
      key: "instagram",
      label: "Instagram",
      icon: Instagram,
      value: company.instagramUrl,
      href: company.instagramUrl,
      verified: verified.instagram,
    },
    {
      key: "facebook",
      label: "Facebook",
      icon: Facebook,
      value: company.facebookUrl,
      href: company.facebookUrl,
      verified: verified.facebook,
    },
    {
      key: "twitter",
      label: "Twitter / X",
      icon: Twitter,
      value: company.twitterUrl,
      href: company.twitterUrl,
      verified: verified.twitter,
    },
  ];

  const total = rows.filter((r) => r.value).length;
  const verifiedCount = rows.filter((r) => r.value && r.verified).length;

  async function toggle(field: FieldKey, next: boolean) {
    const prev = verified[field];
    setVerified((s) => ({ ...s, [field]: next }));
    setPending(field);
    setError(null);
    try {
      const res = await fetch(`/api/companies/${company.id}/verify`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ field, verified: next }),
      });
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        throw new Error(j.error ?? `HTTP ${res.status}`);
      }
      startTransition(() => router.refresh());
    } catch (err) {
      setVerified((s) => ({ ...s, [field]: prev }));
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setPending(null);
    }
  }

  return (
    <>
      <Button
        variant={verifiedCount > 0 ? "outline" : "ghost"}
        size="sm"
        className="h-7 px-2 text-xs gap-1"
        onClick={() => setOpen(true)}
        title={total === 0 ? "Sin canales para validar" : `${verifiedCount}/${total} verificados`}
      >
        <ShieldCheck
          className={`w-3.5 h-3.5 ${
            verifiedCount === total && total > 0
              ? "text-emerald-600"
              : verifiedCount > 0
                ? "text-amber-600"
                : "text-muted-foreground"
          }`}
        />
        <span className="tabular-nums">
          {verifiedCount}/{total}
        </span>
      </Button>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>{company.name}</DialogTitle>
            <DialogDescription>
              Marcá los canales que verificaste como reales.{" "}
              {company.verifiedAt && (
                <span className="text-xs text-muted-foreground">
                  Última edición: {new Date(company.verifiedAt).toLocaleString("es-ES", { dateStyle: "short", timeStyle: "short" })}
                </span>
              )}
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-1.5">
            {rows.map((r) => (
              <FieldRowView
                key={r.key}
                row={r}
                pending={pending === r.key}
                onToggle={(v) => toggle(r.key, v)}
              />
            ))}
          </div>

          {error && (
            <div className="text-xs text-red-600 mt-2">{error}</div>
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}

function FieldRowView({
  row,
  pending,
  onToggle,
}: {
  row: FieldRow;
  pending: boolean;
  onToggle: (v: boolean) => void;
}) {
  const Icon = row.icon;
  const empty = !row.value;

  return (
    <div
      className={`flex items-center gap-3 px-3 py-2 rounded-md border ${
        empty
          ? "border-dashed border-border opacity-50"
          : row.verified
            ? "border-emerald-200 bg-emerald-50/50"
            : "border-border bg-card"
      }`}
    >
      <Icon className={`w-4 h-4 shrink-0 ${empty ? "text-muted-foreground" : "text-foreground"}`} />
      <div className="flex-1 min-w-0">
        <div className="text-xs font-semibold">{row.label}</div>
        {empty ? (
          <div className="text-[11px] text-muted-foreground">Sin valor</div>
        ) : row.href ? (
          <a
            href={row.href}
            target="_blank"
            rel="noopener noreferrer"
            className="text-[11px] text-muted-foreground hover:text-primary hover:underline truncate inline-flex items-center gap-1 max-w-full"
          >
            <span className="truncate">{row.value}</span>
            <ExternalLink className="w-2.5 h-2.5 shrink-0" />
          </a>
        ) : (
          <div className="text-[11px] text-muted-foreground truncate">{row.value}</div>
        )}
      </div>
      <button
        type="button"
        disabled={empty || pending}
        onClick={() => onToggle(!row.verified)}
        className="shrink-0 disabled:opacity-50"
        aria-label={`Marcar ${row.label} como ${row.verified ? "no verificado" : "verificado"}`}
      >
        {pending ? (
          <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" />
        ) : row.verified ? (
          <CheckCircle2 className="w-5 h-5 text-emerald-600" />
        ) : (
          <Circle className="w-5 h-5 text-muted-foreground" />
        )}
      </button>
    </div>
  );
}
