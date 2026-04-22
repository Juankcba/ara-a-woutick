export type Platform =
  | "taquilla"
  | "ticketmaster"
  | "eventbrite"
  | "fever"
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
  eventbrite: {
    name: "Eventbrite",
    color: "#F05537",
    textColor: "#ffffff",
    logo: "EB",
  },
  fever: {
    name: "Fever",
    color: "#FF2D55",
    textColor: "#ffffff",
    logo: "FV",
  },
  elcorteingles: {
    name: "El Corte Inglés",
    color: "#007940",
    textColor: "#ffffff",
    logo: "ECI",
  },
};

export const EVENTS: Event[] = [
  {
    id: "1",
    title: "Rosalía — Motomami World Tour",
    subtitle: "La artista más aclamada del momento en Madrid",
    category: "Conciertos",
    city: "Madrid",
    venue: "WiZink Center",
    date: "2026-06-14",
    time: "21:00",
    image: "/images/rosalia.jpg",
    featured: true,
    prices: [
      { platform: "taquilla", price: 65, fees: 5.5, url: "https://taquilla.com", available: true },
      { platform: "ticketmaster", price: 70, fees: 8.0, url: "https://ticketmaster.es", available: true },
      { platform: "eventbrite", price: 68, fees: 6.0, url: "https://eventbrite.es", available: true },
      { platform: "fever", price: 74, fees: 4.0, url: "https://feverup.com", available: false },
      { platform: "elcorteingles", price: 65, fees: 3.5, url: "https://entradas.elcorteingles.es", available: true },
    ],
  },
  {
    id: "2",
    title: "Coldplay — Music of the Spheres",
    subtitle: "El espectáculo más impresionante del año",
    category: "Conciertos",
    city: "Barcelona",
    venue: "Estadi Olímpic",
    date: "2026-07-03",
    time: "20:30",
    image: "/images/coldplay.jpg",
    featured: true,
    prices: [
      { platform: "taquilla", price: 89, fees: 7.0, url: "https://taquilla.com", available: true },
      { platform: "ticketmaster", price: 95, fees: 9.5, url: "https://ticketmaster.es", available: true },
      { platform: "eventbrite", price: 91, fees: 6.5, url: "https://eventbrite.es", available: false },
      { platform: "fever", price: 88, fees: 5.0, url: "https://feverup.com", available: true },
      { platform: "elcorteingles", price: 92, fees: 4.0, url: "https://entradas.elcorteingles.es", available: true },
    ],
  },
  {
    id: "3",
    title: "El Rey León — El Musical",
    subtitle: "La majestuosa historia de Simba en el Teatro Lope de Vega",
    category: "Teatro",
    city: "Madrid",
    venue: "Teatro Lope de Vega",
    date: "2026-05-20",
    time: "18:00",
    image: "/images/rey-leon.jpg",
    prices: [
      { platform: "taquilla", price: 45, fees: 4.0, url: "https://taquilla.com", available: true },
      { platform: "ticketmaster", price: 52, fees: 6.0, url: "https://ticketmaster.es", available: true },
      { platform: "eventbrite", price: 48, fees: 3.5, url: "https://eventbrite.es", available: true },
      { platform: "fever", price: 55, fees: 5.0, url: "https://feverup.com", available: true },
      { platform: "elcorteingles", price: 46, fees: 2.5, url: "https://entradas.elcorteingles.es", available: false },
    ],
  },
  {
    id: "4",
    title: "Real Madrid vs FC Barcelona",
    subtitle: "El Clásico — LaLiga EA Sports 2025/26",
    category: "Deportes",
    city: "Madrid",
    venue: "Estadio Santiago Bernabéu",
    date: "2026-05-10",
    time: "21:00",
    image: "/images/clasico.jpg",
    featured: true,
    prices: [
      { platform: "taquilla", price: 150, fees: 12.0, url: "https://taquilla.com", available: true },
      { platform: "ticketmaster", price: 165, fees: 15.0, url: "https://ticketmaster.es", available: false },
      { platform: "eventbrite", price: 158, fees: 10.0, url: "https://eventbrite.es", available: true },
      { platform: "fever", price: 170, fees: 8.0, url: "https://feverup.com", available: false },
      { platform: "elcorteingles", price: 155, fees: 9.0, url: "https://entradas.elcorteingles.es", available: true },
    ],
  },
  {
    id: "5",
    title: "Primavera Sound 2026",
    subtitle: "El festival de música independiente más importante de Europa",
    category: "Festivales",
    city: "Barcelona",
    venue: "Parc del Fòrum",
    date: "2026-06-05",
    time: "12:00",
    image: "/images/primavera-sound.jpg",
    prices: [
      { platform: "taquilla", price: 220, fees: 18.0, url: "https://taquilla.com", available: true },
      { platform: "ticketmaster", price: 235, fees: 22.0, url: "https://ticketmaster.es", available: true },
      { platform: "eventbrite", price: 225, fees: 15.0, url: "https://eventbrite.es", available: true },
      { platform: "fever", price: 218, fees: 10.0, url: "https://feverup.com", available: true },
      { platform: "elcorteingles", price: 220, fees: 8.0, url: "https://entradas.elcorteingles.es", available: false },
    ],
  },
  {
    id: "6",
    title: "Bad Bunny — Debí Tirar Más Fotos Tour",
    subtitle: "El reguetonero más escuchado del mundo llega a España",
    category: "Conciertos",
    city: "Sevilla",
    venue: "Estadio de La Cartuja",
    date: "2026-07-18",
    time: "20:00",
    image: "/images/bad-bunny.jpg",
    prices: [
      { platform: "taquilla", price: 75, fees: 6.0, url: "https://taquilla.com", available: true },
      { platform: "ticketmaster", price: 80, fees: 9.0, url: "https://ticketmaster.es", available: true },
      { platform: "eventbrite", price: 78, fees: 5.5, url: "https://eventbrite.es", available: true },
      { platform: "fever", price: 82, fees: 4.5, url: "https://feverup.com", available: true },
      { platform: "elcorteingles", price: 76, fees: 3.0, url: "https://entradas.elcorteingles.es", available: false },
    ],
  },
  {
    id: "7",
    title: "Monólogos de Comedy Central",
    subtitle: "Una noche de risas con los mejores cómicos del panorama nacional",
    category: "Comedia",
    city: "Valencia",
    venue: "Teatro Olympia",
    date: "2026-05-25",
    time: "21:30",
    image: "/images/comedia.jpg",
    prices: [
      { platform: "taquilla", price: 28, fees: 2.5, url: "https://taquilla.com", available: true },
      { platform: "ticketmaster", price: 32, fees: 4.0, url: "https://ticketmaster.es", available: true },
      { platform: "eventbrite", price: 29, fees: 2.0, url: "https://eventbrite.es", available: true },
      { platform: "fever", price: 30, fees: 2.0, url: "https://feverup.com", available: false },
      { platform: "elcorteingles", price: 27, fees: 1.5, url: "https://entradas.elcorteingles.es", available: true },
    ],
  },
  {
    id: "8",
    title: "Disney en Familia — Ice Show",
    subtitle: "La magia de Disney sobre el hielo para toda la familia",
    category: "Familiar",
    city: "Bilbao",
    venue: "Bizkaia Arena",
    date: "2026-06-01",
    time: "17:00",
    image: "/images/disney.jpg",
    prices: [
      { platform: "taquilla", price: 35, fees: 3.0, url: "https://taquilla.com", available: true },
      { platform: "ticketmaster", price: 40, fees: 5.0, url: "https://ticketmaster.es", available: true },
      { platform: "eventbrite", price: 37, fees: 3.5, url: "https://eventbrite.es", available: true },
      { platform: "fever", price: 38, fees: 3.0, url: "https://feverup.com", available: true },
      { platform: "elcorteingles", price: 35, fees: 2.0, url: "https://entradas.elcorteingles.es", available: true },
    ],
  },
];

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
