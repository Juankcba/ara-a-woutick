"use client";

import Image from "next/image";
import { useState } from "react";
import {
  Event,
  formatDate,
  formatPrice,
  getCheapestPlatform,
  getMinPrice,
  getMaxPrice,
  getSavings,
  PLATFORM_META,
} from "@/lib/data";
import { PriceComparisonTable } from "@/components/price-comparison-table";
import { cn } from "@/lib/utils";
import { MapPin, Calendar, ChevronDown, ChevronUp, TrendingDown } from "lucide-react";

interface EventCardProps {
  event: Event;
}

export function EventCard({ event }: EventCardProps) {
  const [expanded, setExpanded] = useState(false);
  const cheapest = getCheapestPlatform(event);
  const minPrice = getMinPrice(event);
  const maxPrice = getMaxPrice(event);
  const savings = getSavings(event);

  const categoryColors: Record<string, string> = {
    Conciertos: "bg-purple-100 text-purple-700",
    Teatro: "bg-amber-100 text-amber-700",
    Deportes: "bg-sky-100 text-sky-700",
    Festivales: "bg-green-100 text-green-700",
    Familiar: "bg-pink-100 text-pink-700",
    Comedia: "bg-orange-100 text-orange-700",
  };

  return (
    <article className="flex flex-col bg-card rounded-xl border border-border overflow-hidden shadow-sm hover:shadow-md transition-shadow">
      {/* Image */}
      <div className="relative h-44 w-full flex-shrink-0 overflow-hidden">
        <Image
          src={event.image}
          alt={event.title}
          fill
          className="object-cover"
          sizes="(max-width: 768px) 100vw, (max-width: 1200px) 50vw, 33vw"
        />
        {/* Category badge */}
        <span
          className={cn(
            "absolute top-3 left-3 text-xs font-semibold px-2.5 py-1 rounded-full",
            categoryColors[event.category] ?? "bg-secondary text-secondary-foreground"
          )}
        >
          {event.category}
        </span>
        {/* Savings badge */}
        {savings > 0 && (
          <span className="absolute top-3 right-3 inline-flex items-center gap-1 bg-success text-white text-xs font-bold px-2.5 py-1 rounded-full">
            <TrendingDown className="w-3 h-3" />
            Ahorra {formatPrice(savings)}
          </span>
        )}
      </div>

      {/* Content */}
      <div className="flex flex-col flex-1 p-4 gap-3">
        {/* Title */}
        <div>
          <h2 className="font-bold text-foreground text-balance leading-snug text-base">
            {event.title}
          </h2>
          <p className="text-xs text-muted-foreground mt-0.5 line-clamp-1">{event.subtitle}</p>
        </div>

        {/* Meta */}
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
          <span className="flex items-center gap-1">
            <Calendar className="w-3.5 h-3.5 flex-shrink-0" />
            {formatDate(event.date)} · {event.time}
          </span>
          <span className="flex items-center gap-1">
            <MapPin className="w-3.5 h-3.5 flex-shrink-0" />
            {event.venue}, {event.city}
          </span>
        </div>

        {/* Price summary */}
        <div className="flex items-center justify-between bg-secondary rounded-lg px-3 py-2.5">
          <div>
            <div className="text-[10px] text-muted-foreground uppercase tracking-wide font-medium mb-0.5">
              Desde
            </div>
            <div className="text-xl font-bold text-foreground tabular-nums">
              {formatPrice(minPrice)}
            </div>
            {maxPrice > minPrice && (
              <div className="text-[10px] text-muted-foreground">
                hasta {formatPrice(maxPrice)}
              </div>
            )}
          </div>
          {cheapest && (
            <div className="text-right">
              <div className="text-[10px] text-muted-foreground mb-1">Mejor en</div>
              <span
                className="inline-flex items-center justify-center rounded font-bold text-xs leading-none px-2 py-1"
                style={{
                  backgroundColor: PLATFORM_META[cheapest.platform].color,
                  color: PLATFORM_META[cheapest.platform].textColor,
                }}
              >
                {PLATFORM_META[cheapest.platform].name}
              </span>
            </div>
          )}
        </div>

        {/* Expand / Collapse */}
        <button
          onClick={() => setExpanded((v) => !v)}
          className="flex items-center justify-center gap-1.5 w-full text-xs font-semibold text-primary hover:text-brand-dark transition-colors py-1"
          aria-expanded={expanded}
        >
          {expanded ? (
            <>
              Ocultar comparativa <ChevronUp className="w-3.5 h-3.5" />
            </>
          ) : (
            <>
              Ver comparativa de precios <ChevronDown className="w-3.5 h-3.5" />
            </>
          )}
        </button>

        {/* Price comparison table */}
        {expanded && (
          <div className="border-t border-border pt-3">
            <PriceComparisonTable prices={event.prices} compact />
          </div>
        )}
      </div>
    </article>
  );
}
