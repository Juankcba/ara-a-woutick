"use client";

import { Category, CITIES, CATEGORIES } from "@/lib/data";
import { cn } from "@/lib/utils";
import { SlidersHorizontal } from "lucide-react";

interface EventFiltersProps {
  selectedCategory: Category | "Todas";
  onCategoryChange: (c: Category | "Todas") => void;
  selectedCity: string;
  onCityChange: (c: string) => void;
  sortBy: "price" | "date" | "savings";
  onSortChange: (s: "price" | "date" | "savings") => void;
  totalResults: number;
}

const SORT_OPTIONS: { value: "price" | "date" | "savings"; label: string }[] = [
  { value: "price", label: "Menor precio" },
  { value: "date", label: "Próxima fecha" },
  { value: "savings", label: "Mayor ahorro" },
];

export function EventFilters({
  selectedCategory,
  onCategoryChange,
  selectedCity,
  onCityChange,
  sortBy,
  onSortChange,
  totalResults,
}: EventFiltersProps) {
  return (
    <div className="flex flex-col gap-4 py-5">
      {/* Category pills */}
      <div className="flex flex-wrap gap-2">
        {CATEGORIES.map((cat) => (
          <button
            key={cat}
            onClick={() => onCategoryChange(cat)}
            className={cn(
              "text-sm font-medium px-3.5 py-1.5 rounded-full border transition-colors leading-none",
              selectedCategory === cat
                ? "bg-primary text-primary-foreground border-primary"
                : "bg-card text-foreground border-border hover:border-primary/50 hover:bg-brand-light"
            )}
          >
            {cat}
          </button>
        ))}
      </div>

      {/* City + Sort controls */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2 flex-wrap">
          <SlidersHorizontal className="w-4 h-4 text-muted-foreground flex-shrink-0" />
          {/* City selector */}
          <select
            value={selectedCity}
            onChange={(e) => onCityChange(e.target.value)}
            className="text-sm bg-card border border-border rounded-lg px-3 py-1.5 text-foreground focus:outline-none focus:ring-2 focus:ring-ring cursor-pointer"
            aria-label="Filtrar por ciudad"
          >
            {CITIES.map((city) => (
              <option key={city} value={city}>
                {city === "Todas" ? "Todas las ciudades" : city}
              </option>
            ))}
          </select>

          {/* Sort */}
          <select
            value={sortBy}
            onChange={(e) => onSortChange(e.target.value as "price" | "date" | "savings")}
            className="text-sm bg-card border border-border rounded-lg px-3 py-1.5 text-foreground focus:outline-none focus:ring-2 focus:ring-ring cursor-pointer"
            aria-label="Ordenar por"
          >
            {SORT_OPTIONS.map((opt) => (
              <option key={opt.value} value={opt.value}>
                Ordenar: {opt.label}
              </option>
            ))}
          </select>
        </div>

        <p className="text-sm text-muted-foreground">
          {totalResults} evento{totalResults !== 1 ? "s" : ""} encontrado{totalResults !== 1 ? "s" : ""}
        </p>
      </div>
    </div>
  );
}
