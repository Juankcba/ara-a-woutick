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
} from "@/lib/data";
import { PriceComparisonTable } from "@/components/price-comparison-table";
import { MapPin, Calendar, ChevronDown, ChevronUp, TrendingDown, Star } from "lucide-react";
import { cn } from "@/lib/utils";

interface FeaturedEventProps {
  event: Event;
}

export function FeaturedEvent({ event }: FeaturedEventProps) {
  const [expanded, setExpanded] = useState(false);
  const minPrice = getMinPrice(event);
  const maxPrice = getMaxPrice(event);
  const savings = getSavings(event);
  const cheapest = getCheapestPlatform(event);

  const categoryColors: Record<string, string> = {
    Conciertos: "bg-purple-100 text-purple-700",
    Teatro: "bg-amber-100 text-amber-700",
    Deportes: "bg-sky-100 text-sky-700",
    Festivales: "bg-green-100 text-green-700",
    Familiar: "bg-pink-100 text-pink-700",
    Comedia: "bg-orange-100 text-orange-700",
  };

  return (
    <article className="relative flex flex-col md:flex-row bg-card rounded-2xl border border-border overflow-hidden shadow-sm hover:shadow-lg transition-shadow">
      {/* Image */}
      <div className="relative h-56 md:h-auto md:w-80 lg:w-96 flex-shrink-0">
        <Image
          src={event.image}
          alt={event.title}
          fill
          className="object-cover"
          sizes="(max-width: 768px) 100vw, 384px"
          priority
        />
        <div className="absolute inset-0 bg-gradient-to-t from-black/40 to-transparent md:bg-gradient-to-r" />
        {/* Featured badge */}
        <span className="absolute top-3 left-3 inline-flex items-center gap-1 bg-warning text-white text-xs font-bold px-2.5 py-1 rounded-full">
          <Star className="w-3 h-3 fill-white" />
          Destacado
        </span>
      </div>

      {/* Content */}
      <div className="flex flex-col flex-1 p-5 gap-4">
        <div className="flex flex-wrap items-start gap-2">
          <span
            className={cn(
              "text-xs font-semibold px-2.5 py-1 rounded-full",
              categoryColors[event.category] ?? "bg-secondary text-secondary-foreground"
            )}
          >
            {event.category}
          </span>
          {savings > 0 && (
            <span className="inline-flex items-center gap-1 bg-success text-white text-xs font-bold px-2.5 py-1 rounded-full">
              <TrendingDown className="w-3 h-3" />
              Ahorra hasta {formatPrice(savings)}
            </span>
          )}
        </div>

        <div>
          <h2 className="text-xl font-bold text-foreground text-balance leading-tight">
            {event.title}
          </h2>
          <p className="text-sm text-muted-foreground mt-1 leading-relaxed">{event.subtitle}</p>
        </div>

        <div className="flex flex-wrap gap-x-4 gap-y-1.5 text-sm text-muted-foreground">
          <span className="flex items-center gap-1.5">
            <Calendar className="w-4 h-4 flex-shrink-0" />
            {formatDate(event.date)} · {event.time}
          </span>
          <span className="flex items-center gap-1.5">
            <MapPin className="w-4 h-4 flex-shrink-0" />
            {event.venue}, {event.city}
          </span>
        </div>

        {/* Price summary bar */}
        <div className="flex items-center gap-4 bg-secondary rounded-xl px-4 py-3">
          <div>
            <div className="text-[10px] uppercase tracking-wider text-muted-foreground font-medium mb-0.5">
              Precio desde
            </div>
            <div className="text-2xl font-bold text-foreground tabular-nums">
              {formatPrice(minPrice)}
            </div>
            {maxPrice > minPrice && (
              <div className="text-xs text-muted-foreground">hasta {formatPrice(maxPrice)}</div>
            )}
          </div>

          <div className="h-10 w-px bg-border mx-1" />

          <div className="flex-1">
            <div className="text-[10px] uppercase tracking-wider text-muted-foreground font-medium mb-1">
              Disponible en {event.prices.filter((p) => p.available).length} plataformas
            </div>
            <div className="flex flex-wrap gap-1">
              {event.prices
                .filter((p) => p.available)
                .map((p) => (
                  <span
                    key={p.platform}
                    className="text-[10px] font-bold px-1.5 py-0.5 rounded leading-none"
                    style={{
                      backgroundColor: `${p.platform === cheapest?.platform ? "#16a34a" : "#e5e7eb"}`,
                      color: `${p.platform === cheapest?.platform ? "#fff" : "#374151"}`,
                    }}
                  >
                    {p.platform === cheapest?.platform ? `Mejor: ${formatPrice(p.price)}` : formatPrice(p.price)}
                  </span>
                ))}
            </div>
          </div>
        </div>

        {/* Expand toggle */}
        <button
          onClick={() => setExpanded((v) => !v)}
          className="flex items-center justify-center gap-1.5 w-full text-sm font-semibold text-primary hover:text-brand-dark transition-colors py-1"
          aria-expanded={expanded}
        >
          {expanded ? (
            <>
              Ocultar comparativa de precios <ChevronUp className="w-4 h-4" />
            </>
          ) : (
            <>
              Comparar todas las plataformas <ChevronDown className="w-4 h-4" />
            </>
          )}
        </button>

        {expanded && (
          <div className="border-t border-border pt-4">
            <PriceComparisonTable prices={event.prices} />
          </div>
        )}
      </div>
    </article>
  );
}
