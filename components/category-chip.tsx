import { getCategoryMeta } from "@/lib/categories/meta";

type Props = {
  slug?: string | null;
  size?: "sm" | "md" | "lg";
  showLabel?: boolean;
};

export function CategoryChip({ slug, size = "md", showLabel = true }: Props) {
  const meta = getCategoryMeta(slug);
  const Icon = meta.Icon;
  const dims = { sm: 14, md: 16, lg: 22 }[size];
  const padding = { sm: "px-2 py-0.5", md: "px-2.5 py-1", lg: "px-3 py-1.5" }[size];
  const textSize = { sm: "text-[10px]", md: "text-xs", lg: "text-sm" }[size];

  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full ${padding} ${textSize} font-medium`}
      style={{
        backgroundColor: `${meta.color}1F`, // 12% alpha
        color: meta.color
      }}
    >
      <Icon size={dims} />
      {showLabel && <span>{meta.name}</span>}
    </span>
  );
}

export function CategoryIcon({
  slug,
  size = 18
}: {
  slug?: string | null;
  size?: number;
}) {
  const meta = getCategoryMeta(slug);
  const Icon = meta.Icon;
  const box = size + 16; // 18→34px, 20→36px, 22→38px
  return (
    <div
      className="inline-flex items-center justify-center rounded-xl shrink-0"
      style={{ width: box, height: box, backgroundColor: meta.color }}
    >
      <Icon size={size} color="#ffffff" strokeWidth={1.75} />
    </div>
  );
}
