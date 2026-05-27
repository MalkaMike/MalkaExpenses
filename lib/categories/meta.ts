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
  Monitor,
  Dumbbell,
  ShoppingBag,
  Fuel,
  ParkingSquare,
  CarTaxiFront,
  Bike,
  Coffee,
  Bot,
  Cloud,
  Layout,
  Megaphone,
  Pill,
  Stethoscope,
  Sparkles,
  BedDouble,
  Map as MapIcon,
  Wrench,
  Users,
  Smartphone,
  Sofa,
  Gamepad2,
  type LucideIcon
} from "lucide-react";

export type CategoryMeta = {
  slug: string;
  name: string;
  Icon: LucideIcon;
  color: string; // hex
  parentSlug?: string; // set on subcategories
  isSystem?: boolean;  // transferencias, cartao_pagamento, receita, outros — cannot be deleted
};

export type CategoryTreeNode = {
  parent: CategoryMeta;
  children: CategoryMeta[];
};

// ── Full flat registry ─────────────────────────────────────────────────────────
// Parents first, then subcategories (parentSlug set). AI picks the most specific slug.
export const CATEGORY_META: Record<string, CategoryMeta> = {
  // ── Top-level parents ───────────────────────────────────────────────────────
  moradia:        { slug: "moradia",        name: "Moradia",           Icon: Home,          color: "#3b82f6" },
  mercado:        { slug: "mercado",        name: "Mercado",           Icon: ShoppingCart,  color: "#10b981" },
  restaurantes:   { slug: "restaurantes",   name: "Restaurantes",      Icon: Utensils,      color: "#f59e0b" },
  transporte:     { slug: "transporte",     name: "Transporte",        Icon: Car,           color: "#06b6d4" },
  lazer:          { slug: "lazer",          name: "Lazer",             Icon: Music,         color: "#a855f7" },
  saude:          { slug: "saude",          name: "Saúde",             Icon: HeartPulse,    color: "#ef4444" },
  educacao:       { slug: "educacao",       name: "Educação",          Icon: GraduationCap, color: "#6366f1" },
  assinaturas:    { slug: "assinaturas",    name: "Assinaturas",       Icon: Repeat,        color: "#ec4899" },
  vestuario:      { slug: "vestuario",      name: "Vestuário",         Icon: Shirt,         color: "#f97316" },
  viagens:        { slug: "viagens",        name: "Viagens",           Icon: Plane,         color: "#0ea5e9" },
  presentes:      { slug: "presentes",      name: "Presentes",         Icon: Gift,          color: "#f43f5e" },
  impostos:       { slug: "impostos",       name: "Impostos",          Icon: Landmark,      color: "#71717a" },
  tecnologia:     { slug: "tecnologia",     name: "Tecnologia & SaaS", Icon: Monitor,       color: "#6366f1" },
  esportes_hobby: { slug: "esportes_hobby", name: "Esportes & Hobby",  Icon: Dumbbell,      color: "#a855f7" },
  compras:        { slug: "compras",        name: "Compras & Casa",    Icon: ShoppingBag,   color: "#f97316" },
  financeiro:     { slug: "financeiro",     name: "Financeiro",        Icon: Landmark,      color: "#71717a" },

  // ── System (protected — cannot be deleted or repurposed) ───────────────────
  transferencias: {
    slug: "transferencias", name: "Transferências",
    Icon: ArrowLeftRight, color: "#94a3b8", isSystem: true
  },
  cartao_pagamento: {
    slug: "cartao_pagamento", name: "Cartão",
    Icon: CreditCard, color: "#64748b", isSystem: true
  },
  receita: { slug: "receita", name: "Receita",  Icon: TrendingUp, color: "#10b981", isSystem: true },
  outros:  { slug: "outros",  name: "Outros",   Icon: Circle,     color: "#a3a3a3", isSystem: true },

  // ── Subcategories of TRANSPORTE ────────────────────────────────────────────
  combustivel:            { slug: "combustivel",            name: "Combustível",              Icon: Fuel,         color: "#0891b2", parentSlug: "transporte" },
  estacionamento_pedagio: { slug: "estacionamento_pedagio", name: "Estacionamento & Pedágio", Icon: ParkingSquare,color: "#0891b2", parentSlug: "transporte" },
  uber_taxi:              { slug: "uber_taxi",              name: "Uber & Táxi",              Icon: CarTaxiFront, color: "#06b6d4", parentSlug: "transporte" },
  aereo_rodoviario:       { slug: "aereo_rodoviario",       name: "Aéreo & Ônibus",           Icon: Plane,        color: "#0ea5e9", parentSlug: "transporte" },

  // ── Subcategories of RESTAURANTES ─────────────────────────────────────────
  delivery:     { slug: "delivery",     name: "Delivery (iFood)", Icon: Bike,   color: "#d97706", parentSlug: "restaurantes" },
  padaria_cafe: { slug: "padaria_cafe", name: "Padaria & Café",   Icon: Coffee, color: "#92400e", parentSlug: "restaurantes" },

  // ── Subcategories of TECNOLOGIA ────────────────────────────────────────────
  ia_ferramentas:    { slug: "ia_ferramentas",    name: "IA & Ferramentas",    Icon: Bot,      color: "#818cf8", parentSlug: "tecnologia" },
  dev_cloud:         { slug: "dev_cloud",         name: "Dev & Cloud",         Icon: Cloud,    color: "#6366f1", parentSlug: "tecnologia" },
  produtividade_saas:{ slug: "produtividade_saas",name: "Produtividade & SaaS",Icon: Layout,   color: "#4f46e5", parentSlug: "tecnologia" },
  marketing_digital: { slug: "marketing_digital", name: "Marketing Digital",   Icon: Megaphone,color: "#7c3aed", parentSlug: "tecnologia" },

  // ── Subcategories of SAUDE ─────────────────────────────────────────────────
  farmacia:        { slug: "farmacia",        name: "Farmácia",             Icon: Pill,        color: "#ef4444", parentSlug: "saude" },
  consultas_exames:{ slug: "consultas_exames",name: "Consultas & Exames",   Icon: Stethoscope, color: "#dc2626", parentSlug: "saude" },
  bem_estar:       { slug: "bem_estar",       name: "Bem-estar & Estética", Icon: Sparkles,    color: "#f87171", parentSlug: "saude" },

  // ── Subcategories of VIAGENS ───────────────────────────────────────────────
  hoteis_pousadas:  { slug: "hoteis_pousadas",  name: "Hotéis & Pousadas",  Icon: BedDouble, color: "#0ea5e9", parentSlug: "viagens" },
  passeios_turismo: { slug: "passeios_turismo", name: "Passeios & Turismo", Icon: MapIcon,    color: "#38bdf8", parentSlug: "viagens" },

  // ── Subcategories of MORADIA ───────────────────────────────────────────────
  aluguel_condominio:  { slug: "aluguel_condominio",  name: "Aluguel & Condomínio", Icon: Home,  color: "#3b82f6", parentSlug: "moradia" },
  manutencao_casa:     { slug: "manutencao_casa",     name: "Manutenção & Reforma", Icon: Wrench,color: "#2563eb", parentSlug: "moradia" },
  servicos_domesticos: { slug: "servicos_domesticos", name: "Serviços Domésticos",  Icon: Users, color: "#1d4ed8", parentSlug: "moradia" },

  // ── Subcategories of COMPRAS ───────────────────────────────────────────────
  eletronicos:     { slug: "eletronicos",     name: "Eletrônicos",         Icon: Smartphone, color: "#ea580c", parentSlug: "compras" },
  casa_decoracao:  { slug: "casa_decoracao",  name: "Casa & Decoração",    Icon: Sofa,       color: "#c2410c", parentSlug: "compras" },
  cosmeticos:      { slug: "cosmeticos",      name: "Cosméticos & Beleza", Icon: Sparkles,   color: "#fb923c", parentSlug: "compras" },
  brinquedos_jogos:{ slug: "brinquedos_jogos",name: "Brinquedos & Jogos",  Icon: Gamepad2,   color: "#fdba74", parentSlug: "compras" },

  // ── Subcategories of EDUCACAO ──────────────────────────────────────────────
  cursos_plataformas: { slug: "cursos_plataformas", name: "Cursos & Plataformas", Icon: GraduationCap, color: "#6366f1", parentSlug: "educacao" },
  aulas_particulares: { slug: "aulas_particulares", name: "Aulas Particulares",   Icon: Users,         color: "#4f46e5", parentSlug: "educacao" },
};

// ── Helpers ────────────────────────────────────────────────────────────────────

export function getCategoryMeta(slug?: string | null): CategoryMeta {
  if (!slug) return CATEGORY_META.outros;
  return CATEGORY_META[slug] ?? CATEGORY_META.outros;
}

/**
 * Returns the canonical display name for a slug, including parent prefix for subcategories.
 * e.g. "combustivel" → "Transporte › Combustível"
 */
export function getCategoryDisplayName(slug?: string | null): string {
  const meta = getCategoryMeta(slug);
  if (meta.parentSlug) {
    const parent = CATEGORY_META[meta.parentSlug];
    return parent ? `${parent.name} › ${meta.name}` : meta.name;
  }
  return meta.name;
}

/**
 * Returns the parent meta for a subcategory, or the category itself if it's a top-level.
 */
export function getCategoryParent(slug?: string | null): CategoryMeta {
  const meta = getCategoryMeta(slug);
  if (meta.parentSlug) return getCategoryMeta(meta.parentSlug);
  return meta;
}

/**
 * Returns tree structure: each parent with its children sorted by name.
 * System categories (transferencias, cartao_pagamento, receita, outros) are excluded
 * from the tree — they appear in flat lists but not the hierarchy editor.
 */
export function getCategoryTree(): CategoryTreeNode[] {
  const parents = Object.values(CATEGORY_META).filter(
    (m) => !m.parentSlug && !m.isSystem
  );
  return parents.map((parent) => ({
    parent,
    children: Object.values(CATEGORY_META)
      .filter((m) => m.parentSlug === parent.slug)
      .sort((a, b) => a.name.localeCompare(b.name, "pt-BR"))
  }));
}

// Flat ordered list (backward compat — all parents then system, subcategories excluded)
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
  "tecnologia",
  "esportes_hobby",
  "compras",
  "financeiro",
  "transferencias",
  "cartao_pagamento",
  "receita",
  "outros"
] as const;

// System slugs that cannot be deleted or renamed via the category CRUD UI
export const SYSTEM_SLUGS = new Set([
  "transferencias",
  "cartao_pagamento",
  "receita",
  "outros"
]);

// ── Shared aggregate utility ───────────────────────────────────────────────
// Rolls subcategories up into their parent so charts/lists show one row per
// top-level category (e.g. combustivel + uber_taxi → single "Transporte" row).
export type CategoryTotalDatum = { slug: string; total: number };

export function mergeCategoryTotalsToParents(
  data: CategoryTotalDatum[]
): CategoryTotalDatum[] {
  const merged = new Map<string, number>();
  for (const d of data) {
    const meta = CATEGORY_META[d.slug];
    const parentSlug = meta?.parentSlug ?? d.slug;
    merged.set(parentSlug, (merged.get(parentSlug) ?? 0) + d.total);
  }
  return Array.from(merged.entries())
    .map(([slug, total]) => ({ slug, total }))
    .sort((a, b) => b.total - a.total);
}
