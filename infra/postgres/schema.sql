CREATE SCHEMA IF NOT EXISTS __SCHEMA__;
SET search_path TO __SCHEMA__;

CREATE TABLE IF NOT EXISTS tenants (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS business_entity_profiles (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  entity_type TEXT NOT NULL,
  effective_from DATE NOT NULL,
  effective_to DATE NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS financial_accounts (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  institution TEXT NOT NULL,
  account_label TEXT NOT NULL,
  last4 TEXT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS statements (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  financial_account_id TEXT NOT NULL REFERENCES financial_accounts(id) ON DELETE CASCADE,
  institution TEXT NOT NULL,
  account_label TEXT NOT NULL,
  file_name TEXT NOT NULL,
  stored_path TEXT NOT NULL,
  source_path TEXT NOT NULL,
  checksum TEXT NOT NULL,
  statement_year INTEGER NULL,
  statement_month INTEGER NULL,
  statement_day INTEGER NULL,
  folder_year_mismatch BOOLEAN NOT NULL DEFAULT FALSE,
  status TEXT NOT NULL,
  parse_diagnostics JSONB NULL,
  error TEXT NULL,
  uploaded_by TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  processed_at TIMESTAMPTZ NULL
);

CREATE TABLE IF NOT EXISTS transactions (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  statement_id TEXT NOT NULL REFERENCES statements(id) ON DELETE CASCADE,
  financial_account_id TEXT NOT NULL REFERENCES financial_accounts(id) ON DELETE CASCADE,
  posted_date DATE NOT NULL,
  amount NUMERIC(14, 2) NOT NULL,
  description TEXT NOT NULL,
  raw_line TEXT NULL,
  taxonomy_id TEXT NOT NULL,
  category_code TEXT NOT NULL,
  confidence NUMERIC(5, 4) NOT NULL,
  classification_method TEXT NOT NULL,
  reason_codes JSONB NOT NULL DEFAULT '[]'::jsonb,
  needs_review BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS review_queue_items (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  statement_id TEXT NULL REFERENCES statements(id) ON DELETE CASCADE,
  transaction_id TEXT NULL REFERENCES transactions(id) ON DELETE CASCADE,
  reason TEXT NOT NULL,
  detail TEXT NULL,
  status TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  resolved_at TIMESTAMPTZ NULL,
  resolution_note TEXT NULL
);

CREATE TABLE IF NOT EXISTS audit_events (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  action TEXT NOT NULL,
  payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS classification_rules (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  payload JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_business_entity_profiles_tenant_id ON business_entity_profiles(tenant_id);
CREATE INDEX IF NOT EXISTS idx_financial_accounts_tenant_id ON financial_accounts(tenant_id);
CREATE INDEX IF NOT EXISTS idx_statements_tenant_id ON statements(tenant_id);
CREATE INDEX IF NOT EXISTS idx_statements_status ON statements(status);
CREATE UNIQUE INDEX IF NOT EXISTS idx_statements_tenant_checksum ON statements(tenant_id, checksum);
CREATE INDEX IF NOT EXISTS idx_transactions_tenant_id ON transactions(tenant_id);
CREATE INDEX IF NOT EXISTS idx_transactions_statement_id ON transactions(statement_id);
CREATE INDEX IF NOT EXISTS idx_transactions_posted_date ON transactions(posted_date);
CREATE INDEX IF NOT EXISTS idx_transactions_category_code ON transactions(category_code);
CREATE INDEX IF NOT EXISTS idx_review_queue_tenant_status ON review_queue_items(tenant_id, status);
CREATE INDEX IF NOT EXISTS idx_audit_events_tenant_created ON audit_events(tenant_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_classification_rules_tenant ON classification_rules(tenant_id);

ALTER TABLE tenants ENABLE ROW LEVEL SECURITY;
ALTER TABLE business_entity_profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE financial_accounts ENABLE ROW LEVEL SECURITY;
ALTER TABLE statements ENABLE ROW LEVEL SECURITY;
ALTER TABLE transactions ENABLE ROW LEVEL SECURITY;
ALTER TABLE review_queue_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE audit_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE classification_rules ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_isolation_tenants ON tenants;
CREATE POLICY tenant_isolation_tenants ON tenants
  USING (current_setting('app.tenant_id', true) IS NULL OR id = current_setting('app.tenant_id', true))
  WITH CHECK (current_setting('app.tenant_id', true) IS NULL OR id = current_setting('app.tenant_id', true));

DROP POLICY IF EXISTS tenant_isolation_business_entity_profiles ON business_entity_profiles;
CREATE POLICY tenant_isolation_business_entity_profiles ON business_entity_profiles
  USING (current_setting('app.tenant_id', true) IS NULL OR tenant_id = current_setting('app.tenant_id', true))
  WITH CHECK (current_setting('app.tenant_id', true) IS NULL OR tenant_id = current_setting('app.tenant_id', true));

DROP POLICY IF EXISTS tenant_isolation_financial_accounts ON financial_accounts;
CREATE POLICY tenant_isolation_financial_accounts ON financial_accounts
  USING (current_setting('app.tenant_id', true) IS NULL OR tenant_id = current_setting('app.tenant_id', true))
  WITH CHECK (current_setting('app.tenant_id', true) IS NULL OR tenant_id = current_setting('app.tenant_id', true));

DROP POLICY IF EXISTS tenant_isolation_statements ON statements;
CREATE POLICY tenant_isolation_statements ON statements
  USING (current_setting('app.tenant_id', true) IS NULL OR tenant_id = current_setting('app.tenant_id', true))
  WITH CHECK (current_setting('app.tenant_id', true) IS NULL OR tenant_id = current_setting('app.tenant_id', true));

DROP POLICY IF EXISTS tenant_isolation_transactions ON transactions;
CREATE POLICY tenant_isolation_transactions ON transactions
  USING (current_setting('app.tenant_id', true) IS NULL OR tenant_id = current_setting('app.tenant_id', true))
  WITH CHECK (current_setting('app.tenant_id', true) IS NULL OR tenant_id = current_setting('app.tenant_id', true));

DROP POLICY IF EXISTS tenant_isolation_review_queue ON review_queue_items;
CREATE POLICY tenant_isolation_review_queue ON review_queue_items
  USING (current_setting('app.tenant_id', true) IS NULL OR tenant_id = current_setting('app.tenant_id', true))
  WITH CHECK (current_setting('app.tenant_id', true) IS NULL OR tenant_id = current_setting('app.tenant_id', true));

DROP POLICY IF EXISTS tenant_isolation_audit_events ON audit_events;
CREATE POLICY tenant_isolation_audit_events ON audit_events
  USING (current_setting('app.tenant_id', true) IS NULL OR tenant_id = current_setting('app.tenant_id', true))
  WITH CHECK (current_setting('app.tenant_id', true) IS NULL OR tenant_id = current_setting('app.tenant_id', true));

DROP POLICY IF EXISTS tenant_isolation_classification_rules ON classification_rules;
CREATE POLICY tenant_isolation_classification_rules ON classification_rules
  USING (current_setting('app.tenant_id', true) IS NULL OR tenant_id = current_setting('app.tenant_id', true))
  WITH CHECK (current_setting('app.tenant_id', true) IS NULL OR tenant_id = current_setting('app.tenant_id', true));
