"use client";

import { PlatformPrice, PLATFORM_META, formatPrice } from "@/lib/data";
import { cn } from "@/lib/utils";
import { ExternalLink, TrendingDown } from "lucide-react";

interface PriceComparisonTableProps {
  prices: PlatformPrice[];
  compact?: boolean;
}

export function PriceComparisonTable({
  prices,
  compact = false,
}: PriceComparisonTableProps) {
  const available = prices.filter((p) => p.available);
  const minPrice = available.length > 0 ? Math.min(...available.map((p) => p.price)) : null;

  const sorted = [...prices].sort((a, b) => {
    if (!a.available && b.available) return 1;
    if (a.available && !b.available) return -1;
    return a.price - b.price;
  });

  return (
    <div className="flex flex-col gap-2">
      {sorted.map((item) => {
        const meta = PLATFORM_META[item.platform];
        const isCheapest = item.available && item.price === minPrice;
        const totalWithFees = item.price + (item.fees ?? 0);

        return (
          <div
            key={item.platform}
            className={cn(
              "flex items-center justify-between rounded-lg border px-3 py-2.5 transition-colors",
              item.available
                ? isCheapest
                  ? "border-success bg-success-bg"
                  : "border-border bg-card hover:bg-secondary/50"
                : "border-border bg-muted/40 opacity-60"
            )}
          >
            {/* Platform name */}
            <div className="flex items-center gap-2 min-w-0">
              <span
                className="flex-shrink-0 inline-flex items-center justify-center rounded font-bold text-[11px] leading-none"
                style={{
                  backgroundColor: meta.color,
                  color: meta.textColor,
                  width: compact ? 28 : 32,
                  height: compact ? 20 : 22,
                }}
              >
                {meta.logo}
              </span>
              <span
                className={cn(
                  "truncate font-medium",
                  compact ? "text-xs" : "text-sm",
                  !item.available && "text-muted-foreground"
                )}
              >
                {meta.name}
              </span>
              {isCheapest && (
                <span className="flex-shrink-0 inline-flex items-center gap-0.5 text-[10px] font-semibold text-success bg-success-bg border border-success/30 rounded-full px-1.5 py-0.5 leading-none">
                  <TrendingDown className="w-2.5 h-2.5" />
                  Mejor precio
                </span>
              )}
            </div>

            {/* Price + CTA */}
            <div className="flex items-center gap-3 flex-shrink-0">
              {item.available ? (
                <>
                  <div className="text-right">
                    <div
                      className={cn(
                        "font-bold text-foreground tabular-nums",
                        compact ? "text-sm" : "text-base",
                        isCheapest && "text-success"
                      )}
                    >
                      {formatPrice(item.price)}
                    </div>
                    {item.fees && !compact && (
                      <div className="text-[10px] text-muted-foreground leading-none mt-0.5">
                        +{formatPrice(item.fees)} gastos = {formatPrice(totalWithFees)}
                      </div>
                    )}
                  </div>
                  <a
                    href={item.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className={cn(
                      "flex-shrink-0 inline-flex items-center gap-1 rounded-md font-medium text-primary-foreground bg-primary hover:bg-brand-dark transition-colors",
                      compact ? "text-[11px] px-2 py-1" : "text-xs px-3 py-1.5"
                    )}
                    onClick={(e) => e.stopPropagation()}
                  >
                    {compact ? (
                      <ExternalLink className="w-3 h-3" />
                    ) : (
                      <>
                        Comprar
                        <ExternalLink className="w-3 h-3" />
                      </>
                    )}
                  </a>
                </>
              ) : (
                <span className="text-xs text-muted-foreground italic">Agotado</span>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}
