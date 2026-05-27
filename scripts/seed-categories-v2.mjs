#!/usr/bin/env node
/**
 * Seed categories v2 — adds subcategory hierarchy based on real spending patterns
 * from Itaú Personnalité CC statements (12 months analysed).
 *
 * Run: node scripts/seed-categories-v2.mjs
 * (reads .env.local automatically via dotenv)
 */
import { readFileSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";

// Manual dotenv loading (no dependency)
const __dir = dirname(fileURLToPath(import.meta.url));
const envPath = resolve(__dir, "../.env.local");
try {
  const raw = readFileSync(envPath, "utf8");
  for (const line of raw.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq === -1) continue;
    const key = trimmed.slice(0, eq).trim();
    const val = trimmed.slice(eq + 1).replace(/^['"]|['"]$/g, "").trim();
    if (!process.env[key]) process.env[key] = val;
  }
} catch {
  // .env.local might not exist on CI
}

const URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!URL || !KEY) {
  console.error("Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY");
  process.exit(1);
}

async function sql(table, method, body, query = "") {
  const res = await fetch(`${URL}/rest/v1/${table}${query}`, {
    method,
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${KEY}`,
      apikey: KEY,
      Prefer: "return=representation"
    },
    body: body ? JSON.stringify(body) : undefined
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`${method} ${table}: ${res.status} ${text}`);
  return text ? JSON.parse(text) : null;
}

async function upsertCategory({ slug, name, icon, color, sortOrder, parentSlug }) {
  // Resolve parent ID if needed
  let parentId = null;
  if (parentSlug) {
    const rows = await sql("categories", "GET", null, `?slug=eq.${parentSlug}&select=id`);
    if (!rows?.length) throw new Error(`Parent slug not found: ${parentSlug}`);
    parentId = rows[0].id;
  }

  // Check if slug already exists
  const existing = await sql("categories", "GET", null, `?slug=eq.${slug}&select=id,parent_id`);

  if (existing?.length) {
    // Update parent_id + sort_order if needed
    await sql(
      "categories",
      "PATCH",
      { parent_id: parentId, sort_order: sortOrder, color, icon },
      `?slug=eq.${slug}`
    );
    console.log(`  ↻  updated: ${slug}`);
  } else {
    // Insert new
    await sql("categories", "POST", {
      slug,
      name,
      icon,
      color,
      sort_order: sortOrder,
      parent_id: parentId
    });
    console.log(`  +  created: ${slug}`);
  }
}

const CATEGORIES = [
  // ── NEW TOP-LEVEL PARENTS ──────────────────────────────────────────────────
  { slug: "tecnologia",    name: "Tecnologia & SaaS",   icon: "monitor",       color: "#6366f1", sortOrder: 55 },
  { slug: "esportes_hobby",name: "Esportes & Hobby",    icon: "dumbbell",      color: "#a855f7", sortOrder: 65 },
  { slug: "compras",       name: "Compras & Casa",      icon: "shopping-bag",  color: "#f97316", sortOrder: 85 },
  { slug: "financeiro",    name: "Financeiro",          icon: "landmark",      color: "#71717a", sortOrder: 115 },

  // ── SUBCATEGORIES OF TRANSPORTE ───────────────────────────────────────────
  { slug: "combustivel",           name: "Combustível",          icon: "fuel",           color: "#0891b2", sortOrder: 41, parentSlug: "transporte" },
  { slug: "estacionamento_pedagio",name: "Estacionamento & Pedágio", icon: "parking-square", color: "#0891b2", sortOrder: 42, parentSlug: "transporte" },
  { slug: "uber_taxi",             name: "Uber & Táxi",          icon: "car-taxi-front", color: "#06b6d4", sortOrder: 43, parentSlug: "transporte" },
  { slug: "aereo_rodoviario",      name: "Aéreo & Ônibus",       icon: "plane",          color: "#0ea5e9", sortOrder: 44, parentSlug: "transporte" },

  // ── SUBCATEGORIES OF RESTAURANTES ────────────────────────────────────────
  { slug: "delivery",     name: "Delivery (iFood)",  icon: "bike",   color: "#d97706", sortOrder: 31, parentSlug: "restaurantes" },
  { slug: "padaria_cafe", name: "Padaria & Café",    icon: "coffee", color: "#92400e", sortOrder: 32, parentSlug: "restaurantes" },

  // ── SUBCATEGORIES OF TECNOLOGIA ───────────────────────────────────────────
  { slug: "ia_ferramentas",   name: "IA & Ferramentas",   icon: "bot",      color: "#818cf8", sortOrder: 56, parentSlug: "tecnologia" },
  { slug: "dev_cloud",        name: "Dev & Cloud",         icon: "cloud",    color: "#6366f1", sortOrder: 57, parentSlug: "tecnologia" },
  { slug: "produtividade_saas",name: "Produtividade & SaaS",icon: "layout",  color: "#4f46e5", sortOrder: 58, parentSlug: "tecnologia" },
  { slug: "marketing_digital",name: "Marketing Digital",   icon: "megaphone",color: "#7c3aed", sortOrder: 59, parentSlug: "tecnologia" },

  // ── SUBCATEGORIES OF SAUDE ────────────────────────────────────────────────
  { slug: "farmacia",         name: "Farmácia",             icon: "pill",         color: "#ef4444", sortOrder: 61, parentSlug: "saude" },
  { slug: "consultas_exames", name: "Consultas & Exames",   icon: "stethoscope",  color: "#dc2626", sortOrder: 62, parentSlug: "saude" },
  { slug: "bem_estar",        name: "Bem-estar & Estética", icon: "sparkles",     color: "#f87171", sortOrder: 63, parentSlug: "saude" },

  // ── SUBCATEGORIES OF VIAGENS ──────────────────────────────────────────────
  { slug: "hoteis_pousadas",  name: "Hotéis & Pousadas",   icon: "bed-double",  color: "#0ea5e9", sortOrder: 101, parentSlug: "viagens" },
  { slug: "passeios_turismo", name: "Passeios & Turismo",  icon: "map",         color: "#38bdf8", sortOrder: 102, parentSlug: "viagens" },

  // ── SUBCATEGORIES OF MORADIA ──────────────────────────────────────────────
  { slug: "aluguel_condominio", name: "Aluguel & Condomínio", icon: "home",       color: "#3b82f6", sortOrder: 11, parentSlug: "moradia" },
  { slug: "manutencao_casa",    name: "Manutenção & Reforma", icon: "wrench",     color: "#2563eb", sortOrder: 12, parentSlug: "moradia" },
  { slug: "servicos_domesticos",name: "Serviços Domésticos",  icon: "users",      color: "#1d4ed8", sortOrder: 13, parentSlug: "moradia" },

  // ── SUBCATEGORIES OF COMPRAS ──────────────────────────────────────────────
  { slug: "eletronicos",      name: "Eletrônicos",          icon: "smartphone",  color: "#ea580c", sortOrder: 86, parentSlug: "compras" },
  { slug: "casa_decoracao",   name: "Casa & Decoração",     icon: "sofa",        color: "#c2410c", sortOrder: 87, parentSlug: "compras" },
  { slug: "cosmeticos",       name: "Cosméticos & Beleza",  icon: "sparkles",    color: "#fb923c", sortOrder: 88, parentSlug: "compras" },
  { slug: "brinquedos_jogos", name: "Brinquedos & Jogos",  icon: "gamepad-2",   color: "#fdba74", sortOrder: 89, parentSlug: "compras" },

  // ── SUBCATEGORIES OF EDUCACAO ─────────────────────────────────────────────
  { slug: "cursos_plataformas", name: "Cursos & Plataformas", icon: "graduation-cap", color: "#6366f1", sortOrder: 71, parentSlug: "educacao" },
  { slug: "aulas_particulares", name: "Aulas Particulares",   icon: "users",          color: "#4f46e5", sortOrder: 72, parentSlug: "educacao" },
];

async function main() {
  console.log("🌱 Seeding categories v2...\n");
  for (const cat of CATEGORIES) {
    try {
      await upsertCategory(cat);
    } catch (e) {
      console.error(`  ✗ ${cat.slug}: ${e.message}`);
    }
  }
  console.log("\n✅ Done.");
}

main().catch((e) => { console.error(e); process.exit(1); });
