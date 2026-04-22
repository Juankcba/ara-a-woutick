import { Platform, PLATFORM_META } from "@/lib/data";
import { cn } from "@/lib/utils";

interface PlatformBadgeProps {
  platform: Platform;
  size?: "sm" | "md";
  className?: string;
}

export function PlatformBadge({
  platform,
  size = "md",
  className,
}: PlatformBadgeProps) {
  const meta = PLATFORM_META[platform];

  return (
    <span
      className={cn(
        "inline-flex items-center justify-center font-bold rounded-md leading-none",
        size === "sm" ? "text-[10px] px-1.5 py-0.5" : "text-xs px-2 py-1",
        className
      )}
      style={{ backgroundColor: meta.color, color: meta.textColor }}
      title={meta.name}
    >
      {meta.logo}
    </span>
  );
}
