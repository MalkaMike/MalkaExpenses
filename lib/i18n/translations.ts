// ============================================================================
// All UI strings with PT-BR and EN translations.
// Currency/date formatting stays pt-BR regardless of language.
// To add a new string: add a key here, then call t(key, lang) in the component.
// ============================================================================

export type Lang = "pt" | "en";

export const STRINGS = {
  // ── Navigation ─────────────────────────────────────────────────────────────
  "nav.home":         { pt: "Início",       en: "Home" },
  "nav.transactions": { pt: "Movimentos",   en: "Transactions" },
  "nav.categories":   { pt: "Categorias",   en: "Categories" },
  "nav.budgets":      { pt: "Orçamentos",   en: "Budgets" },
  "nav.import":       { pt: "Importar",     en: "Import" },
  "nav.review":       { pt: "Rever",        en: "Review" },

  // ── Home page ───────────────────────────────────────────────────────────────
  "home.net_worth":        { pt: "Patrimônio líquido",  en: "Net worth" },
  "home.accounts":         { pt: "Contas",              en: "Accounts" },
  "home.add_account":      { pt: "Adicionar conta",     en: "Add account" },
  "home.no_accounts":      { pt: "Nenhuma conta ainda.", en: "No accounts yet." },
  "home.balance":          { pt: "Saldo",               en: "Balance" },
  "home.this_month":       { pt: "Este mês",            en: "This month" },
  "home.spend":            { pt: "Gastos",              en: "Spending" },
  "home.income":           { pt: "Receitas",            en: "Income" },

  // ── Account detail ──────────────────────────────────────────────────────────
  "account.back":           { pt: "voltar",             en: "back" },
  "account.import":         { pt: "importar extrato",   en: "import statement" },
  "account.recent_months":  { pt: "Últimos meses",      en: "Recent months" },
  "account.movements":      { pt: "Movimentos",         en: "Movements" },
  "account.no_movements":   { pt: "Nenhum movimento.",  en: "No movements." },
  "account.balance":        { pt: "Saldo",              en: "Balance" },

  // ── Account edit panel ──────────────────────────────────────────────────────
  "account.edit":           { pt: "Editar conta",       en: "Edit account" },
  "account.name":           { pt: "Nome",               en: "Name" },
  "account.bank":           { pt: "Banco",              en: "Bank" },
  "account.type":           { pt: "Tipo",               en: "Type" },
  "account.save":           { pt: "Salvar",             en: "Save" },
  "account.archive":        { pt: "Arquivar",           en: "Archive" },
  "account.confirm_delete": { pt: "Confirmar exclusão", en: "Confirm delete" },
  "account.real_balance":   { pt: "Saldo inicial real (R$)", en: "Real starting balance (R$)" },
  "account.shared_balance": { pt: "Saldo inicial exibido",   en: "Displayed starting balance" },

  // ── Transactions page ────────────────────────────────────────────────────────
  "tx.title":        { pt: "Movimentos",              en: "Transactions" },
  "tx.search":       { pt: "Buscar...",               en: "Search..." },
  "tx.no_results":   { pt: "Nenhum resultado.",       en: "No results." },
  "tx.filter_all":   { pt: "Todos",                   en: "All" },
  "tx.filter_debit": { pt: "Débitos",                 en: "Debits" },
  "tx.filter_credit":{ pt: "Créditos",                en: "Credits" },

  // ── Import page ─────────────────────────────────────────────────────────────
  "import.title":          { pt: "Importar extrato",          en: "Import statement" },
  "import.select_account": { pt: "Conta destino",             en: "Destination account" },
  "import.drop_file":      { pt: "Soltar arquivo aqui",       en: "Drop file here" },
  "import.or_click":       { pt: "ou clique para selecionar", en: "or click to select" },
  "import.supported":      { pt: "OFX · QFX · PDF",          en: "OFX · QFX · PDF" },
  "import.preview":        { pt: "Pré-visualização",          en: "Preview" },
  "import.confirm":        { pt: "Confirmar importação",      en: "Confirm import" },
  "import.cancel":         { pt: "Cancelar",                  en: "Cancel" },
  "import.done":           { pt: "Importação concluída!",     en: "Import complete!" },
  "import.duplicates":     { pt: "duplicadas ignoradas",      en: "duplicates skipped" },
  "import.categorized":    { pt: "categorizadas pela IA",     en: "categorized by AI" },
  "import.new_tx":         { pt: "novas transações",          en: "new transactions" },
  "import.parsing_pdf":    { pt: "✦ Gemini a ler PDF...",     en: "✦ Gemini reading PDF..." },
  "import.ai_cat":         { pt: "✦ IA a categorizar...",     en: "✦ AI categorizing..." },
  "import.back":           { pt: "nova importação",           en: "new import" },
  "import.all_dupes":      { pt: "Tudo duplicado",            en: "All duplicates" },
  "import.already_imported":{ pt: "já importado",            en: "already imported" },

  // ── Review queue ────────────────────────────────────────────────────────────
  "review.title":          { pt: "Para rever",                en: "Needs review" },
  "review.no_pending":     { pt: "Nada para rever! ✓",        en: "Nothing to review! ✓" },
  "review.accept":         { pt: "Aceitar",                   en: "Accept" },
  "review.skip":           { pt: "Pular",                     en: "Skip" },
  "review.bulk_accept":    { pt: "Aceitar todos",             en: "Accept all" },

  // ── Categories page ─────────────────────────────────────────────────────────
  "cat.title":        { pt: "Categorias",           en: "Categories" },
  "cat.this_month":   { pt: "Este mês",             en: "This month" },
  "cat.no_data":      { pt: "Nenhum dado.",         en: "No data." },
  "cat.add":          { pt: "Nova categoria",       en: "New category" },
  "cat.subcategory":  { pt: "Subcategoria de",      en: "Subcategory of" },

  // ── Budgets page ─────────────────────────────────────────────────────────────
  "budget.title":       { pt: "Orçamentos",             en: "Budgets" },
  "budget.set":         { pt: "Definir orçamento",      en: "Set budget" },
  "budget.spent":       { pt: "gasto",                  en: "spent" },
  "budget.of":          { pt: "de",                     en: "of" },
  "budget.remaining":   { pt: "restante",               en: "remaining" },
  "budget.over":        { pt: "excedido",               en: "over budget" },
  "budget.no_budgets":  { pt: "Nenhum orçamento ainda.", en: "No budgets yet." },

  // ── Alerts bell ──────────────────────────────────────────────────────────────
  "alerts.title":          { pt: "Alertas",                        en: "Alerts" },
  "alerts.all_clear":      { pt: "Tudo em ordem!",                 en: "All clear!" },
  "alerts.all_clear_sub":  { pt: "Nenhum alerta no momento.",      en: "No alerts right now." },
  "alerts.loading":        { pt: "A verificar…",                   en: "Checking…" },
  "alerts.pending_review": { pt: "transações para rever",          en: "transactions to review" },
  "alerts.pending_sub":    { pt: "Categorias com baixa confiança", en: "Low-confidence categories" },
  "alerts.missing_months": { pt: "Meses em falta",                 en: "Missing months" },
  "alerts.failed_imports": { pt: "Importações falhadas",           en: "Failed imports" },

  // ── Shared ────────────────────────────────────────────────────────────────────
  "common.save":    { pt: "Salvar",   en: "Save" },
  "common.cancel":  { pt: "Cancelar",en: "Cancel" },
  "common.delete":  { pt: "Apagar",  en: "Delete" },
  "common.edit":    { pt: "Editar",  en: "Edit" },
  "common.close":   { pt: "Fechar",  en: "Close" },
  "common.loading": { pt: "A carregar…", en: "Loading…" },
  "common.error":   { pt: "Erro",    en: "Error" },
  "common.back":    { pt: "voltar",  en: "back" },
} as const;

export type StringKey = keyof typeof STRINGS;

export function t(key: StringKey, lang: Lang): string {
  return STRINGS[key][lang];
}

/** Utility: returns "pt" or "en" from the cookie value, defaulting to "pt" */
export function parseLang(raw: string | undefined): Lang {
  return raw === "en" ? "en" : "pt";
}
