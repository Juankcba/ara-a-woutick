import Link from "next/link";
import { TicketIcon } from "lucide-react";
import { PLATFORM_META, Platform } from "@/lib/data";

export function SiteHeader() {
  const platformCount = Object.keys(PLATFORM_META).length;

  return (
    <header className="sticky top-0 z-50 bg-card border-b border-border shadow-sm">
      <div className="max-w-6xl mx-auto px-4 flex items-center justify-between h-14">
        {/* Logo */}
        <Link href="/" className="flex items-center gap-2 font-bold text-foreground">
          <span className="flex items-center justify-center w-8 h-8 rounded-lg bg-primary text-primary-foreground">
            <TicketIcon className="w-4 h-4" />
          </span>
          <span>
            Compara<span className="text-primary">TuEntrada</span>
          </span>
        </Link>

        {/* Center — platform strip */}
        <nav
          className="hidden md:flex items-center gap-1.5"
          aria-label="Plataformas comparadas"
        >
          <span className="text-xs text-muted-foreground mr-1">Comparamos:</span>
          {(Object.entries(PLATFORM_META) as [Platform, (typeof PLATFORM_META)[Platform]][]).map(
            ([key, meta]) => (
              <span
                key={key}
                className="text-[10px] font-bold px-2 py-0.5 rounded leading-none"
                style={{ backgroundColor: meta.color, color: meta.textColor }}
                title={meta.name}
              >
                {meta.logo}
              </span>
            )
          )}
        </nav>

        {/* Right */}
        <div className="flex items-center gap-3 text-xs text-muted-foreground">
          <Link
            href="/promoters"
            className="text-xs font-medium text-foreground hover:text-primary transition-colors"
          >
            Organizadores
          </Link>
          <Link
            href="/admin"
            className="text-xs font-medium text-foreground hover:text-primary transition-colors"
          >
            Admin
          </Link>
          <span className="hidden sm:block">{platformCount} plataformas</span>
        </div>
      </div>
    </header>
  );
}
