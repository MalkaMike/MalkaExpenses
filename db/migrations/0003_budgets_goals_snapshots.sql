-- 0003_budgets_goals_snapshots.sql
-- Budgets per category, goals, monthly net-worth snapshots

CREATE TABLE IF NOT EXISTS budgets (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  category_id UUID NOT NULL REFERENCES categories(id) ON DELETE CASCADE,
  monthly_limit NUMERIC(14, 2) NOT NULL CHECK (monthly_limit > 0),
  effective_from DATE NOT NULL DEFAULT CURRENT_DATE,
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS ux_budget_category ON budgets(category_id);
ALTER TABLE budgets ENABLE ROW LEVEL SECURITY;

CREATE TABLE IF NOT EXISTS goals (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  target_amount NUMERIC(14, 2) NOT NULL CHECK (target_amount > 0),
  current_amount NUMERIC(14, 2) NOT NULL DEFAULT 0,
  target_date DATE,
  icon TEXT,
  color TEXT,
  is_archived BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE goals ENABLE ROW LEVEL SECURITY;

-- Monthly net-worth snapshots (one row per month-end).
-- Reflects share_amount sums; admin can also store real_amount equivalent.
CREATE TABLE IF NOT EXISTS net_worth_snapshots (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  month CHAR(7) NOT NULL,  -- YYYY-MM
  shared_balance NUMERIC(14, 2) NOT NULL,
  real_balance NUMERIC(14, 2),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS ux_snapshot_month ON net_worth_snapshots(month);
ALTER TABLE net_worth_snapshots ENABLE ROW LEVEL SECURITY;
