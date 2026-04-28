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
import { Button } from "@/components/ui/button";

const ALL = "__all__";

export function AdminSourceFilters({ basePath }: { basePath: string }) {
  const router = useRouter();
  const params = useSearchParams();
  const [, startTransition] = useTransition();
  const [searchInput, setSearchInput] = useState(params.get("q") ?? "");

  useEffect(() => {
    const handle = setTimeout(() => {
      const current = params.get("q") ?? "";
      if (searchInput === current) return;
      update("q", searchInput || null);
    }, 250);
    return () => clearTimeout(handle);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchInput]);

  function update(key: string, value: string | null) {
    const next = new URLSearchParams(params.toString());
    if (value === null) next.delete(key);
    else next.set(key, value);
    startTransition(() => router.replace(`${basePath}?${next.toString()}`, { scroll: false }));
  }

  function pickValue(key: string): string {
    return params.get(key) ?? ALL;
  }

  function setSelect(key: string, v: string) {
    update(key, v === ALL ? null : v);
  }

  const activeCount = ["q", "competitor", "state", "configStatus"].filter((k) => params.get(k)).length;

  return (
    <div className="rounded-xl border border-border bg-card p-3 mb-4">
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative flex-1 min-w-[220px]">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <Input
            value={searchInput}
            onChange={(e) => setSearchInput(e.target.value)}
            placeholder="Buscar slug, nombre o URL…"
            className="pl-8 h-9"
          />
        </div>

        <Select value={pickValue("competitor")} onValueChange={(v) => setSelect("competitor", v)}>
          <SelectTrigger className="w-[160px]">
            <SelectValue placeholder="Tipo" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL}>Todas las fuentes</SelectItem>
            <SelectItem value="yes">Solo competencia</SelectItem>
            <SelectItem value="no">Solo seed (propias)</SelectItem>
          </SelectContent>
        </Select>

        <Select value={pickValue("state")} onValueChange={(v) => setSelect("state", v)}>
          <SelectTrigger className="w-[170px]">
            <SelectValue placeholder="Estado" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL}>Cualquier estado</SelectItem>
            <SelectItem value="active">Activas</SelectItem>
            <SelectItem value="inactive">Inactivas</SelectItem>
            <SelectItem value="never_ran">Nunca scrapeadas</SelectItem>
          </SelectContent>
        </Select>

        <Select value={pickValue("configStatus")} onValueChange={(v) => setSelect("configStatus", v)}>
          <SelectTrigger className="w-[170px]">
            <SelectValue placeholder="Config" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL}>Cualquier config</SelectItem>
            <SelectItem value="empty">Sin investigar</SelectItem>
            <SelectItem value="draft">Draft</SelectItem>
            <SelectItem value="tested">Probado</SelectItem>
            <SelectItem value="production">En producción</SelectItem>
            <SelectItem value="descartado">Descartado</SelectItem>
          </SelectContent>
        </Select>

        {activeCount > 0 && (
          <Button
            variant="ghost"
            size="sm"
            onClick={() => {
              setSearchInput("");
              startTransition(() => router.replace(basePath, { scroll: false }));
            }}
            className="ml-auto text-xs h-8"
          >
            <X className="w-3.5 h-3.5" />
            Limpiar ({activeCount})
          </Button>
        )}
      </div>
    </div>
  );
}
