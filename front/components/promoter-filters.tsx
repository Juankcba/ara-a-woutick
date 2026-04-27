"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useState, useTransition } from "react";
import { Search, X } from "lucide-react";

import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";

const CATEGORY_OPTIONS = [
  { value: "promoter", label: "Promotor" },
  { value: "ticketing", label: "Ticketera" },
  { value: "venue", label: "Sala/Venue" },
  { value: "festival", label: "Festival" },
  { value: "agency_production", label: "Ag. Producción" },
  { value: "agency_marketing", label: "Ag. Marketing" },
  { value: "agency_booking", label: "Ag. Booking" },
  { value: "fair", label: "Feria" },
  { value: "congress", label: "Congreso" },
  { value: "hotel", label: "Hotel" },
  { value: "camping", label: "Camping" },
  { value: "venue_complex", label: "Recinto ferial" },
  { value: "other", label: "Otro" },
];

const STATUS_OPTIONS = [
  { value: "new", label: "Nuevo" },
  { value: "enriching", label: "Enriqueciendo" },
  { value: "enriched", label: "Enriquecido" },
  { value: "contacted", label: "Contactado" },
  { value: "qualified", label: "Cualificado" },
  { value: "won", label: "Ganado" },
  { value: "lost", label: "Perdido" },
  { value: "dnc", label: "No contactar" },
];

const ALL_VALUE = "__all__";

interface PromoterFiltersProps {
  sources: string[];
  cities: string[];
}

export function PromoterFilters({ sources, cities }: PromoterFiltersProps) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [, startTransition] = useTransition();

  const [searchInput, setSearchInput] = useState(searchParams.get("q") ?? "");

  useEffect(() => {
    const handle = setTimeout(() => {
      const current = searchParams.get("q") ?? "";
      if (searchInput === current) return;
      updateParam("q", searchInput || null);
    }, 300);
    return () => clearTimeout(handle);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchInput]);

  function updateParam(key: string, value: string | null) {
    const next = new URLSearchParams(searchParams.toString());
    if (value === null || value === "") {
      next.delete(key);
    } else {
      next.set(key, value);
    }
    startTransition(() => {
      router.replace(`/promoters?${next.toString()}`, { scroll: false });
    });
  }

  function selectValue(key: string) {
    return searchParams.get(key) ?? ALL_VALUE;
  }

  function setSelect(key: string, value: string) {
    updateParam(key, value === ALL_VALUE ? null : value);
  }

  function isChecked(key: string) {
    return searchParams.get(key) === "1";
  }

  function toggle(key: string, value: boolean) {
    updateParam(key, value ? "1" : null);
  }

  const activeCount = ["category", "status", "source", "city", "hasInstagram", "hasEmail", "hasPhone", "q"].filter(
    (k) => searchParams.get(k),
  ).length;

  function clearAll() {
    setSearchInput("");
    startTransition(() => {
      router.replace("/promoters", { scroll: false });
    });
  }

  return (
    <div className="rounded-xl border border-border bg-card p-4 mb-4 space-y-3">
      <div className="flex flex-wrap items-center gap-3">
        <div className="relative flex-1 min-w-[220px]">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <Input
            value={searchInput}
            onChange={(e) => setSearchInput(e.target.value)}
            placeholder="Buscar por nombre, web o email…"
            className="pl-8"
          />
        </div>

        <Select value={selectValue("category")} onValueChange={(v) => setSelect("category", v)}>
          <SelectTrigger className="w-[170px]">
            <SelectValue placeholder="Categoría" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL_VALUE}>Todas las categorías</SelectItem>
            {CATEGORY_OPTIONS.map((o) => (
              <SelectItem key={o.value} value={o.value}>
                {o.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        <Select value={selectValue("status")} onValueChange={(v) => setSelect("status", v)}>
          <SelectTrigger className="w-[160px]">
            <SelectValue placeholder="Estado" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL_VALUE}>Todos los estados</SelectItem>
            {STATUS_OPTIONS.map((o) => (
              <SelectItem key={o.value} value={o.value}>
                {o.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        <Select value={selectValue("source")} onValueChange={(v) => setSelect("source", v)}>
          <SelectTrigger className="w-[160px]">
            <SelectValue placeholder="Fuente" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL_VALUE}>Todas las fuentes</SelectItem>
            {sources.map((s) => (
              <SelectItem key={s} value={s}>
                {s}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        {cities.length > 0 && (
          <Select value={selectValue("city")} onValueChange={(v) => setSelect("city", v)}>
            <SelectTrigger className="w-[150px]">
              <SelectValue placeholder="Ciudad" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={ALL_VALUE}>Todas las ciudades</SelectItem>
              {cities.map((c) => (
                <SelectItem key={c} value={c}>
                  {c}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}
      </div>

      <div className="flex flex-wrap items-center gap-x-5 gap-y-2 pt-1">
        <CheckboxRow
          id="f-ig"
          label="Tiene Instagram"
          checked={isChecked("hasInstagram")}
          onChange={(v) => toggle("hasInstagram", v)}
        />
        <CheckboxRow
          id="f-mail"
          label="Tiene email"
          checked={isChecked("hasEmail")}
          onChange={(v) => toggle("hasEmail", v)}
        />
        <CheckboxRow
          id="f-phone"
          label="Tiene teléfono"
          checked={isChecked("hasPhone")}
          onChange={(v) => toggle("hasPhone", v)}
        />

        {activeCount > 0 && (
          <Button
            variant="ghost"
            size="sm"
            onClick={clearAll}
            className="ml-auto text-xs h-7"
          >
            <X className="w-3.5 h-3.5 mr-1" />
            Limpiar filtros ({activeCount})
          </Button>
        )}
      </div>
    </div>
  );
}

function CheckboxRow({
  id,
  label,
  checked,
  onChange,
}: {
  id: string;
  label: string;
  checked: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <div className="flex items-center gap-2">
      <Checkbox id={id} checked={checked} onCheckedChange={(v) => onChange(v === true)} />
      <Label htmlFor={id} className="text-xs cursor-pointer">
        {label}
      </Label>
    </div>
  );
}
