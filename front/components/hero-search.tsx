"use client";

import { Search, MapPin } from "lucide-react";
import { PLATFORM_META, Platform } from "@/lib/data";

interface HeroSearchProps {
  query: string;
  onQueryChange: (q: string) => void;
}

const platforms = Object.entries(PLATFORM_META) as [
  Platform,
  (typeof PLATFORM_META)[Platform]
][];

export function HeroSearch({ query, onQueryChange }: HeroSearchProps) {
  return (
    <section className="bg-primary px-4 py-12 md:py-16">
      <div className="max-w-3xl mx-auto flex flex-col items-center gap-6 text-center">
        {/* Heading */}
        <div>
          <div className="inline-flex items-center gap-2 bg-white/15 text-white text-xs font-semibold px-3 py-1.5 rounded-full mb-4">
            <MapPin className="w-3.5 h-3.5" />
            Comparamos precios en tiempo real
          </div>
          <h1 className="text-3xl md:text-4xl font-bold text-white text-balance leading-tight">
            Encuentra la entrada al mejor precio
          </h1>
          <p className="text-white/75 mt-2 text-base leading-relaxed max-w-xl mx-auto">
            Comparamos Taquilla.com, Ticketmaster, Eventbrite, Fever y El Corte
            Inglés para que nunca pagues de más.
          </p>
        </div>

        {/* Search bar */}
        <div className="w-full max-w-xl">
          <div className="relative flex items-center">
            <Search className="absolute left-4 w-5 h-5 text-muted-foreground pointer-events-none" />
            <input
              type="search"
              value={query}
              onChange={(e) => onQueryChange(e.target.value)}
              placeholder="Busca conciertos, teatro, deportes..."
              className="w-full bg-white text-foreground placeholder:text-muted-foreground rounded-xl border border-border pl-11 pr-4 py-3.5 text-sm shadow-sm focus:outline-none focus:ring-2 focus:ring-white/50"
              aria-label="Buscar eventos"
            />
          </div>
        </div>

        {/* Platform logos strip */}
        <div className="flex flex-wrap items-center justify-center gap-2">
          <span className="text-white/60 text-xs">Comparamos en:</span>
          {platforms.map(([key, meta]) => (
            <span
              key={key}
              className="inline-flex items-center justify-center rounded-md font-bold text-xs px-2.5 py-1 leading-none"
              style={{ backgroundColor: meta.color, color: meta.textColor }}
              title={meta.name}
            >
              {meta.name}
            </span>
          ))}
        </div>
      </div>
    </section>
  );
}
