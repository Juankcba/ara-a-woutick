"use client";

import { useMemo, useState } from "react";
import {
  Category,
  Event,
  getMinPrice,
  getSavings,
} from "@/lib/data";
import { HeroSearch } from "@/components/hero-search";
import { EventFilters } from "@/components/event-filters";
import { FeaturedEvent } from "@/components/featured-event";
import { EventCard } from "@/components/event-card";

interface HomeViewProps {
  events: Event[];
}

export function HomeView({ events }: HomeViewProps) {
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState<Category | "Todas">("Todas");
  const [city, setCity] = useState("Todas");
  const [sortBy, setSortBy] = useState<"price" | "date" | "savings">("date");

  const featured = useMemo(() => events.filter((e) => e.featured), [events]);

  const filtered = useMemo(() => {
    let results: Event[] = events;

    if (query.trim()) {
      const q = query.toLowerCase();
      results = results.filter(
        (e) =>
          e.title.toLowerCase().includes(q) ||
          e.subtitle.toLowerCase().includes(q) ||
          e.city.toLowerCase().includes(q) ||
          e.venue.toLowerCase().includes(q) ||
          e.category.toLowerCase().includes(q)
      );
    }

    if (category !== "Todas") {
      results = results.filter((e) => e.category === category);
    }

    if (city !== "Todas") {
      results = results.filter((e) => e.city === city);
    }

    return [...results].sort((a, b) => {
      if (sortBy === "price") return getMinPrice(a) - getMinPrice(b);
      if (sortBy === "savings") return getSavings(b) - getSavings(a);
      if (sortBy === "date") return new Date(a.date).getTime() - new Date(b.date).getTime();
      return 0;
    });
  }, [events, query, category, city, sortBy]);

  const showFeatured = !query.trim() && category === "Todas" && city === "Todas";

  return (
    <>
      <HeroSearch query={query} onQueryChange={setQuery} />

      <main className="flex-1 max-w-6xl mx-auto w-full px-4 pb-16">
        {showFeatured && featured.length > 0 && (
          <section aria-labelledby="featured-heading" className="mt-10 mb-10">
            <div className="flex items-center gap-3 mb-5">
              <h2
                id="featured-heading"
                className="text-lg font-bold text-foreground"
              >
                Eventos destacados
              </h2>
              <span className="text-xs text-muted-foreground bg-secondary px-2.5 py-1 rounded-full">
                {featured.length} evento{featured.length !== 1 ? "s" : ""}
              </span>
            </div>
            <div className="flex flex-col gap-5">
              {featured.map((event) => (
                <FeaturedEvent key={event.id} event={event} />
              ))}
            </div>
          </section>
        )}

        <section aria-labelledby="all-events-heading">
          <EventFilters
            selectedCategory={category}
            onCategoryChange={setCategory}
            selectedCity={city}
            onCityChange={setCity}
            sortBy={sortBy}
            onSortChange={setSortBy}
            totalResults={filtered.length}
          />

          {filtered.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-20 text-center">
              <div className="w-16 h-16 rounded-full bg-secondary flex items-center justify-center mb-4">
                <span className="text-3xl">🎟️</span>
              </div>
              <h3 className="text-base font-semibold text-foreground mb-1">
                Sin resultados
              </h3>
              <p className="text-sm text-muted-foreground max-w-xs">
                No encontramos eventos con ese criterio. Prueba con otra búsqueda o cambia los filtros.
              </p>
            </div>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-5">
              {filtered.map((event) => (
                <EventCard key={event.id} event={event} />
              ))}
            </div>
          )}
        </section>
      </main>

      <footer className="border-t border-border bg-card py-8 mt-auto">
        <div className="max-w-6xl mx-auto px-4 flex flex-col sm:flex-row items-center justify-between gap-3 text-xs text-muted-foreground">
          <p>
            ComparaTuEntrada — Comparador de precios de entradas. No somos responsables de los precios
            mostrados; confirma siempre en la web oficial.
          </p>
          <div className="flex items-center gap-3">
            <a href="https://www.taquilla.com/" target="_blank" rel="noopener noreferrer" className="hover:text-foreground transition-colors">
              Taquilla.com
            </a>
            <a href="https://www.ticketmaster.es/" target="_blank" rel="noopener noreferrer" className="hover:text-foreground transition-colors">
              Ticketmaster
            </a>
            <a href="https://www.elcorteingles.es/entradas/" target="_blank" rel="noopener noreferrer" className="hover:text-foreground transition-colors">
              El Corte Inglés
            </a>
          </div>
        </div>
      </footer>
    </>
  );
}
