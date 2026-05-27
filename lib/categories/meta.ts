import {
  Home,
  ShoppingCart,
  Utensils,
  Car,
  Music,
  HeartPulse,
  GraduationCap,
  Repeat,
  Shirt,
  Plane,
  Gift,
  Landmark,
  ArrowLeftRight,
  CreditCard,
  TrendingUp,
  Circle,
  type LucideIcon
} from "lucide-react";

export type CategoryMeta = {
  slug: string;
  name: string;
  Icon: LucideIcon;
  // Tailwind-compatible RGB string used in inline style with `rgb(var(...))` not available;
  // we use a fixed palette in HSL/hex so it works across light/dark.
  color: string; // hex
};

export const CATEGORY_META: Record<string, CategoryMeta> = {
  moradia: { slug: "moradia", name: "Moradia", Icon: Home, color: "#3b82f6" },
  mercado: { slug: "mercado", name: "Mercado", Icon: ShoppingCart, color: "#10b981" },
  restaurantes: { slug: "restaurantes", name: "Restaurantes", Icon: Utensils, color: "#f59e0b" },
  transporte: { slug: "transporte", name: "Transporte", Icon: Car, color: "#06b6d4" },
  lazer: { slug: "lazer", name: "Lazer", Icon: Music, color: "#a855f7" },
  saude: { slug: "saude", name: "Saúde", Icon: HeartPulse, color: "#ef4444" },
  educacao: { slug: "educacao", name: "Educação", Icon: GraduationCap, color: "#6366f1" },
  assinaturas: { slug: "assinaturas", name: "Assinaturas", Icon: Repeat, color: "#ec4899" },
  vestuario: { slug: "vestuario", name: "Vestuário", Icon: Shirt, color: "#f97316" },
  viagens: { slug: "viagens", name: "Viagens", Icon: Plane, color: "#0ea5e9" },
  presentes: { slug: "presentes", name: "Presentes", Icon: Gift, color: "#f43f5e" },
  impostos: { slug: "impostos", name: "Impostos", Icon: Landmark, color: "#71717a" },
  transferencias: {
    slug: "transferencias",
    name: "Transferências",
    Icon: ArrowLeftRight,
    color: "#94a3b8"
  },
  cartao_pagamento: {
    slug: "cartao_pagamento",
    name: "Cartão",
    Icon: CreditCard,
    color: "#64748b"
  },
  receita: { slug: "receita", name: "Receita", Icon: TrendingUp, color: "#10b981" },
  outros: { slug: "outros", name: "Outros", Icon: Circle, color: "#a3a3a3" }
};

export function getCategoryMeta(slug?: string | null): CategoryMeta {
  if (!slug) return CATEGORY_META.outros;
  return CATEGORY_META[slug] ?? CATEGORY_META.outros;
}

export const CATEGORY_ORDER = [
  "moradia",
  "mercado",
  "restaurantes",
  "transporte",
  "lazer",
  "saude",
  "educacao",
  "assinaturas",
  "vestuario",
  "viagens",
  "presentes",
  "impostos",
  "transferencias",
  "cartao_pagamento",
  "receita",
  "outros"
] as const;
