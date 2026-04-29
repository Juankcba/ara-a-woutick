export type Platform =
  | "taquilla"
  | "ticketmaster"
  | "elcorteingles";

export type Category =
  | "Conciertos"
  | "Teatro"
  | "Deportes"
  | "Festivales"
  | "Familiar"
  | "Comedia";

export interface PlatformPrice {
  platform: Platform;
  price: number;
  url: string;
  available: boolean;
  fees?: number;
}

export interface Event {
  id: string;
  title: string;
  subtitle: string;
  category: Category;
  city: string;
  venue: string;
  date: string;
  time: string;
  image: string;
  prices: PlatformPrice[];
  featured?: boolean;
  // Cantidad de fechas disponibles para este "evento grupo" (misma obra/tour
  // en la misma ciudad con múltiples funciones). 1 = fecha única.
  dateCount?: number;
}

export const PLATFORM_META: Record<
  Platform,
  { name: string; color: string; textColor: string; logo: string }
> = {
  taquilla: {
    name: "Taquilla.com",
    color: "#E8001D",
    textColor: "#ffffff",
    logo: "T",
  },
  ticketmaster: {
    name: "Ticketmaster",
    color: "#026CDF",
    textColor: "#ffffff",
    logo: "TM",
  },
  elcorteingles: {
    name: "El Corte Inglés",
    color: "#007940",
    textColor: "#ffffff",
    logo: "ECI",
  },
};


export const CITIES = ["Todas", "Madrid", "Barcelona", "Sevilla", "Valencia", "Bilbao"];
export const CATEGORIES: Array<Category | "Todas"> = [
  "Todas",
  "Conciertos",
  "Teatro",
  "Deportes",
  "Festivales",
  "Familiar",
  "Comedia",
];

export function getMinPrice(event: Event): number {
  const available = event.prices.filter((p) => p.available);
  if (available.length === 0) return 0;
  return Math.min(...available.map((p) => p.price));
}

export function getMaxPrice(event: Event): number {
  const available = event.prices.filter((p) => p.available);
  if (available.length === 0) return 0;
  return Math.max(...available.map((p) => p.price));
}

export function getCheapestPlatform(event: Event): PlatformPrice | null {
  const available = event.prices.filter((p) => p.available);
  if (available.length === 0) return null;
  return available.reduce((a, b) => (a.price < b.price ? a : b));
}

export function getSavings(event: Event): number {
  const min = getMinPrice(event);
  const max = getMaxPrice(event);
  return max - min;
}

export function formatDate(dateStr: string): string {
  const date = new Date(dateStr + "T00:00:00");
  return date.toLocaleDateString("es-ES", {
    weekday: "short",
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

export function formatPrice(price: number): string {
  return new Intl.NumberFormat("es-ES", {
    style: "currency",
    currency: "EUR",
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(price);
}
