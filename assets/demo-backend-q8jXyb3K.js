const __vite__mapDeps=(i,m=__vite__mapDeps,d=(m.f||(m.f=["assets/vite-browser-external-Cn0MOYvd.js","assets/rolldown-runtime-CbXtAM7H.js"])))=>i.map(i=>d[i]);
import{n as e}from"./rolldown-runtime-CbXtAM7H.js";import{y as t}from"./react-Cvkt9Dcn.js";import{i as n,n as r,r as i}from"./image-cache-DvK6fM-g.js";var a=`-- =============================================================================
-- Espeteks — 0001: schema central
-- Convenções:
--   * Valores monetários: INTEGER em centavos (sufixo _cents). Nunca float.
--   * Percentuais: basis points (sufixo _bp). 10000 bp = 100%.
--   * Datas: timestamptz. "business_date" é a data local da loja.
--   * Estados: TEXT + CHECK (máquinas de estado aplicadas pelas funções RPC).
--   * Registros com histórico nunca são apagados: usam active/visible/status.
-- =============================================================================

create schema if not exists private;
revoke all on schema private from public;
comment on schema private is 'Funções e tabelas internas. NÃO exposto pela Data API.';

-- -----------------------------------------------------------------------------
-- Utilitários
-- -----------------------------------------------------------------------------
create or replace function private.touch_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

-- Valida o formato de horários: {"mon":[["18:00","23:30"]], ...}
create or replace function private.valid_opening_hours(p jsonb)
returns boolean
language plpgsql
immutable
set search_path = ''
as $$
declare
  k text;
  v jsonb;
  r jsonb;
begin
  if p is null or jsonb_typeof(p) <> 'object' then
    return false;
  end if;
  for k, v in select * from jsonb_each(p) loop
    if k not in ('sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat') then
      return false;
    end if;
    if jsonb_typeof(v) <> 'array' or jsonb_array_length(v) > 4 then
      return false;
    end if;
    for r in select * from jsonb_array_elements(v) loop
      if jsonb_typeof(r) <> 'array' or jsonb_array_length(r) <> 2 then
        return false;
      end if;
      if not ((r ->> 0) ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'
              and (r ->> 1) ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$') then
        return false;
      end if;
    end loop;
  end loop;
  return true;
end;
$$;

-- -----------------------------------------------------------------------------
-- Perfis, cargos e permissões
-- -----------------------------------------------------------------------------
create table public.roles (
  key text primary key check (key ~ '^[a-z_]{2,32}$'),
  name text not null check (char_length(name) between 1 and 60),
  description text not null default '',
  sort_order integer not null default 0
);

create table public.permissions (
  key text primary key check (key ~ '^[a-z_]+\\.[a-z_]+$'),
  module text not null,
  description text not null
);

create table public.role_permissions (
  role_key text not null references public.roles (key) on delete cascade,
  permission_key text not null references public.permissions (key) on delete cascade,
  primary key (role_key, permission_key)
);

-- Perfil do funcionário. O cargo NUNCA vem de user_metadata: é definido apenas
-- por funções privilegiadas (Edge Function admin-users / bootstrap).
-- ON DELETE RESTRICT: funcionários com histórico não podem ser apagados — desative.
create table public.profiles (
  id uuid primary key references auth.users (id) on delete restrict,
  full_name text not null default '' check (char_length(full_name) <= 120),
  email text,
  role_key text references public.roles (key),
  active boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index profiles_role_idx on public.profiles (role_key) where active;

create trigger profiles_touch before update on public.profiles
  for each row execute function private.touch_updated_at();

-- -----------------------------------------------------------------------------
-- Configurações do estabelecimento (linha única)
-- -----------------------------------------------------------------------------
create table public.store_settings (
  id smallint primary key default 1 check (id = 1),
  store_name text not null default 'Espeteks' check (char_length(store_name) between 1 and 80),
  tagline text not null default '' check (char_length(tagline) <= 160),
  logo_path text check (char_length(logo_path) <= 300),
  address text not null default '' check (char_length(address) <= 300),
  phone text not null default '' check (char_length(phone) <= 30),
  whatsapp text not null default '' check (char_length(whatsapp) <= 30),
  instagram text not null default '' check (char_length(instagram) <= 60),
  timezone text not null default 'America/Sao_Paulo',
  opening_hours jsonb not null default '{}'::jsonb check (private.valid_opening_hours(opening_hours)),
  enforce_opening_hours boolean not null default false,
  accepting_orders boolean not null default true,
  menu_notice text not null default '' check (char_length(menu_notice) <= 500),
  dine_in_enabled boolean not null default true,
  pickup_enabled boolean not null default true,
  delivery_enabled boolean not null default false,
  require_phone_pickup boolean not null default true,
  delivery_min_order_cents integer not null default 0 check (delivery_min_order_cents >= 0),
  pickup_estimate_minutes integer check (pickup_estimate_minutes between 1 and 600),
  delivery_estimate_minutes integer check (delivery_estimate_minutes between 1 and 600),
  auto_accept_table_orders boolean not null default false,
  max_pending_orders_per_table integer not null default 5 check (max_pending_orders_per_table between 1 and 50),
  public_order_limit_per_10min integer not null default 8 check (public_order_limit_per_10min between 1 and 200),
  service_fee_enabled boolean not null default false,
  service_fee_bp integer not null default 1000 check (service_fee_bp between 0 and 3000),
  manager_max_discount_bp integer not null default 2000 check (manager_max_discount_bp between 0 and 10000),
  payment_methods text[] not null default array['cash', 'pix', 'debit', 'credit']
    check (cardinality(payment_methods) > 0 and payment_methods <@ array['cash', 'pix', 'debit', 'credit']),
  late_order_minutes integer not null default 25 check (late_order_minutes between 5 and 240),
  print_paper_width_mm smallint not null default 80 check (print_paper_width_mm in (58, 80)),
  print_header text not null default '' check (char_length(print_header) <= 300),
  print_footer text not null default '' check (char_length(print_footer) <= 300),
  pii_retention_days integer not null default 180 check (pii_retention_days between 30 and 3650),
  updated_at timestamptz not null default now(),
  updated_by uuid references public.profiles (id)
);
insert into public.store_settings (id) values (1);

create or replace function private.store_settings_before_update()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  -- fuso horário inválido quebraria o cálculo da data comercial
  perform now() at time zone new.timezone;
  new.updated_at := now();
  new.updated_by := auth.uid();
  return new;
exception when invalid_parameter_value then
  raise exception using message = 'INVALID_INPUT', detail = 'Fuso horário inválido.';
end;
$$;

create trigger store_settings_touch before update on public.store_settings
  for each row execute function private.store_settings_before_update();

-- -----------------------------------------------------------------------------
-- Cardápio
-- -----------------------------------------------------------------------------
create table public.categories (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(btrim(name)) between 1 and 60),
  description text not null default '' check (char_length(description) <= 300),
  sort_order integer not null default 0,
  visible boolean not null default true,
  active boolean not null default true,
  is_demo boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index categories_name_uq on public.categories (lower(btrim(name))) where active;
create index categories_sort_idx on public.categories (sort_order, name);
create trigger categories_touch before update on public.categories
  for each row execute function private.touch_updated_at();

create table public.products (
  id uuid primary key default gen_random_uuid(),
  category_id uuid not null references public.categories (id),
  name text not null check (char_length(btrim(name)) between 1 and 80),
  description text not null default '' check (char_length(description) <= 500),
  price_cents integer not null check (price_cents between 0 and 10000000),
  image_path text check (char_length(image_path) <= 300),
  featured boolean not null default false,
  available boolean not null default true, -- disponível agora (ex.: acabou o estoque)
  visible boolean not null default true,   -- aparece no cardápio público
  active boolean not null default true,    -- inativação lógica
  requires_kitchen boolean not null default true,
  max_add_ons integer check (max_add_ons between 0 and 50),
  sort_order integer not null default 0,
  is_demo boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index products_category_idx on public.products (category_id, sort_order);
create trigger products_touch before update on public.products
  for each row execute function private.touch_updated_at();

-- Custo separado do produto: RLS filtra linhas, não colunas. Assim a cozinha/atendimento
-- leem o cardápio sem enxergar o custo (restrito a menu.manage / reports.view).
create table public.product_costs (
  product_id uuid primary key references public.products (id),
  cost_cents integer not null check (cost_cents between 0 and 10000000),
  updated_at timestamptz not null default now()
);
create trigger product_costs_touch before update on public.product_costs
  for each row execute function private.touch_updated_at();

create table public.product_variants (
  id uuid primary key default gen_random_uuid(),
  product_id uuid not null references public.products (id),
  name text not null check (char_length(btrim(name)) between 1 and 60),
  price_cents integer not null check (price_cents between 0 and 10000000),
  active boolean not null default true,
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index product_variants_name_uq on public.product_variants (product_id, lower(btrim(name))) where active;
create trigger product_variants_touch before update on public.product_variants
  for each row execute function private.touch_updated_at();

create table public.add_ons (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(btrim(name)) between 1 and 60),
  price_cents integer not null check (price_cents between 0 and 1000000),
  active boolean not null default true,
  available boolean not null default true,
  sort_order integer not null default 0,
  is_demo boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index add_ons_name_uq on public.add_ons (lower(btrim(name))) where active;
create trigger add_ons_touch before update on public.add_ons
  for each row execute function private.touch_updated_at();

create table public.product_add_ons (
  product_id uuid not null references public.products (id) on delete cascade,
  add_on_id uuid not null references public.add_ons (id) on delete cascade,
  max_quantity smallint not null default 1 check (max_quantity between 1 and 10),
  primary key (product_id, add_on_id)
);
create index product_add_ons_addon_idx on public.product_add_ons (add_on_id);

-- -----------------------------------------------------------------------------
-- Mesas e QR Codes
-- -----------------------------------------------------------------------------
create table public.tables (
  id uuid primary key default gen_random_uuid(),
  label text not null check (char_length(btrim(label)) between 1 and 30),
  area text not null default '' check (char_length(area) <= 40),
  seats smallint check (seats between 1 and 50),
  active boolean not null default true,
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index tables_label_uq on public.tables (lower(btrim(label))) where active;
create trigger tables_touch before update on public.tables
  for each row execute function private.touch_updated_at();

-- Token público aleatório (>= 122 bits). Nunca usar o id sequencial/uuid da mesa no QR.
create table public.table_qr_tokens (
  id uuid primary key default gen_random_uuid(),
  table_id uuid not null references public.tables (id),
  token text not null unique check (token ~ '^[A-Za-z0-9_-]{22,64}$'),
  active boolean not null default true,
  created_at timestamptz not null default now(),
  created_by uuid references public.profiles (id),
  revoked_at timestamptz,
  revoked_by uuid references public.profiles (id),
  check (active or revoked_at is not null)
);
create unique index table_qr_tokens_one_active on public.table_qr_tokens (table_id) where active;

-- -----------------------------------------------------------------------------
-- Entregas
-- -----------------------------------------------------------------------------
create table public.delivery_zones (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(btrim(name)) between 1 and 80),
  fee_cents integer not null check (fee_cents between 0 and 100000),
  min_order_cents integer check (min_order_cents between 0 and 10000000),
  estimate_minutes integer check (estimate_minutes between 1 and 600),
  active boolean not null default true,
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index delivery_zones_name_uq on public.delivery_zones (lower(btrim(name))) where active;
create trigger delivery_zones_touch before update on public.delivery_zones
  for each row execute function private.touch_updated_at();

-- -----------------------------------------------------------------------------
-- Caixa
-- -----------------------------------------------------------------------------
create table public.cash_sessions (
  id uuid primary key default gen_random_uuid(),
  session_number bigint generated always as identity unique,
  opened_by uuid not null references public.profiles (id),
  opened_at timestamptz not null default now(),
  opening_float_cents integer not null check (opening_float_cents between 0 and 100000000),
  status text not null default 'open' check (status in ('open', 'closed')),
  closed_by uuid references public.profiles (id),
  closed_at timestamptz,
  expected_cash_cents integer,
  expected_pix_cents integer,
  expected_debit_cents integer,
  expected_credit_cents integer,
  counted_cash_cents integer check (counted_cash_cents >= 0),
  counted_pix_cents integer check (counted_pix_cents >= 0),
  counted_debit_cents integer check (counted_debit_cents >= 0),
  counted_credit_cents integer check (counted_credit_cents >= 0),
  diff_cash_cents integer generated always as (counted_cash_cents - expected_cash_cents) stored,
  diff_pix_cents integer generated always as (counted_pix_cents - expected_pix_cents) stored,
  diff_debit_cents integer generated always as (counted_debit_cents - expected_debit_cents) stored,
  diff_credit_cents integer generated always as (counted_credit_cents - expected_credit_cents) stored,
  closing_notes text check (char_length(closing_notes) <= 500),
  check ((status = 'closed') = (closed_at is not null)),
  check (status = 'open' or (expected_cash_cents is not null and counted_cash_cents is not null))
);
create unique index cash_sessions_one_open_per_user on public.cash_sessions (opened_by) where status = 'open';
create index cash_sessions_opened_idx on public.cash_sessions (opened_at desc);

create table public.cash_movements (
  id uuid primary key default gen_random_uuid(),
  cash_session_id uuid not null references public.cash_sessions (id),
  kind text not null check (kind in ('supply', 'withdrawal', 'income', 'expense')),
  amount_cents integer not null check (amount_cents between 1 and 100000000),
  reason text not null check (char_length(btrim(reason)) between 3 and 200),
  created_by uuid not null references public.profiles (id),
  created_at timestamptz not null default now()
);
create index cash_movements_session_idx on public.cash_movements (cash_session_id, created_at);

-- -----------------------------------------------------------------------------
-- Comandas / contas (entidade financeira)
--   kind: table (mesa), counter (balcão/avulsa), pickup (retirada), delivery (entrega)
--   Totais são desnormalizados e recalculados exclusivamente por private.recalc_tab().
-- -----------------------------------------------------------------------------
create table public.dining_tabs (
  id uuid primary key default gen_random_uuid(),
  tab_number bigint generated always as identity unique,
  kind text not null check (kind in ('table', 'counter', 'pickup', 'delivery')),
  table_id uuid references public.tables (id),
  label text not null default '' check (char_length(label) <= 60),
  customer_name text not null default '' check (char_length(customer_name) <= 80),
  status text not null default 'open' check (status in ('open', 'closing', 'closed', 'cancelled')),
  service_fee_enabled boolean not null default false,
  service_fee_bp integer not null default 0 check (service_fee_bp between 0 and 3000),
  subtotal_cents integer not null default 0 check (subtotal_cents >= 0),
  service_fee_cents integer not null default 0 check (service_fee_cents >= 0),
  delivery_fee_cents integer not null default 0 check (delivery_fee_cents >= 0),
  discount_cents integer not null default 0 check (discount_cents >= 0),
  total_cents integer not null default 0 check (total_cents >= 0),
  paid_cents integer not null default 0 check (paid_cents >= 0),
  pending_payment_cents integer not null default 0 check (pending_payment_cents >= 0),
  balance_cents integer generated always as (total_cents - paid_cents) stored,
  opened_by uuid references public.profiles (id),
  opened_at timestamptz not null default now(),
  closed_by uuid references public.profiles (id),
  closed_at timestamptz,
  closed_with_balance_cents integer not null default 0 check (closed_with_balance_cents >= 0),
  close_note text check (char_length(close_note) <= 300),
  cancelled_by uuid references public.profiles (id),
  cancelled_at timestamptz,
  cancel_reason text check (char_length(cancel_reason) <= 300),
  version integer not null default 0,
  updated_at timestamptz not null default now(),
  check (kind <> 'table' or table_id is not null),
  check ((status = 'closed') = (closed_at is not null)),
  check ((status = 'cancelled') = (cancelled_at is not null)),
  check (total_cents = greatest(subtotal_cents + service_fee_cents + delivery_fee_cents - discount_cents, 0))
);
create unique index dining_tabs_one_open_per_table on public.dining_tabs (table_id)
  where status in ('open', 'closing');
create index dining_tabs_status_idx on public.dining_tabs (status, opened_at desc);
create index dining_tabs_closed_idx on public.dining_tabs (closed_at) where status = 'closed';
create trigger dining_tabs_touch before update on public.dining_tabs
  for each row execute function private.touch_updated_at();

create table public.discounts (
  id uuid primary key default gen_random_uuid(),
  dining_tab_id uuid not null references public.dining_tabs (id),
  kind text not null check (kind in ('amount', 'percent')),
  value integer not null check (value > 0),
  reason text not null check (char_length(btrim(reason)) between 3 and 200),
  status text not null default 'active' check (status in ('active', 'voided')),
  created_by uuid not null references public.profiles (id),
  created_at timestamptz not null default now(),
  voided_by uuid references public.profiles (id),
  voided_at timestamptz,
  void_reason text check (char_length(void_reason) <= 200),
  check (kind <> 'percent' or value <= 10000),
  check ((status = 'voided') = (voided_at is not null))
);
create index discounts_tab_idx on public.discounts (dining_tab_id);

-- -----------------------------------------------------------------------------
-- Pedidos
-- -----------------------------------------------------------------------------
create table public.orders (
  id uuid primary key default gen_random_uuid(),
  business_date date not null,
  daily_number integer not null check (daily_number > 0),
  code text generated always as (
    '#' || case when daily_number < 1000 then lpad(daily_number::text, 3, '0') else daily_number::text end
  ) stored,
  public_token text not null unique check (public_token ~ '^[A-Za-z0-9_-]{22,64}$'),
  channel text not null check (channel in ('table', 'counter', 'pickup', 'delivery')),
  source text not null check (source in ('customer', 'staff')),
  table_id uuid references public.tables (id),
  qr_token_id uuid references public.table_qr_tokens (id),
  dining_tab_id uuid references public.dining_tabs (id),
  customer_name text not null default '' check (char_length(customer_name) <= 80),
  notes text not null default '' check (char_length(notes) <= 500),
  status text not null default 'pending'
    check (status in ('pending', 'accepted', 'preparing', 'ready', 'completed', 'cancelled')),
  delivery_status text check (delivery_status in ('awaiting', 'out_for_delivery', 'delivered', 'failed')),
  priority smallint not null default 0 check (priority between 0 and 2),
  items_subtotal_cents integer not null check (items_subtotal_cents >= 0),
  delivery_fee_cents integer not null default 0 check (delivery_fee_cents >= 0),
  total_cents integer not null check (total_cents >= 0),
  delivery_zone_id uuid references public.delivery_zones (id),
  idempotency_key uuid unique,
  created_by uuid references public.profiles (id),
  accepted_by uuid references public.profiles (id),
  accepted_at timestamptz,
  preparing_at timestamptz,
  ready_at timestamptz,
  completed_at timestamptz,
  out_for_delivery_at timestamptz,
  delivered_at timestamptz,
  cancelled_by uuid references public.profiles (id),
  cancelled_at timestamptz,
  cancel_reason text check (char_length(cancel_reason) <= 300),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (business_date, daily_number),
  check ((channel = 'delivery') = (delivery_status is not null)),
  check (channel <> 'table' or table_id is not null),
  check (channel = 'delivery' or delivery_fee_cents = 0),
  check (total_cents = items_subtotal_cents + delivery_fee_cents),
  check (status = 'pending' or status = 'cancelled' or dining_tab_id is not null),
  check ((status = 'cancelled') = (cancelled_at is not null))
);
create index orders_status_idx on public.orders (status, created_at desc);
create index orders_tab_idx on public.orders (dining_tab_id);
create index orders_table_idx on public.orders (table_id, created_at desc);
create index orders_created_idx on public.orders (created_at desc);
create trigger orders_touch before update on public.orders
  for each row execute function private.touch_updated_at();

-- Dados pessoais do cliente separados do pedido: a cozinha vê o pedido mas não o telefone/endereço.
create table public.order_contacts (
  order_id uuid primary key references public.orders (id),
  phone text check (phone ~ '^[0-9]{10,13}$'),
  cep text check (cep ~ '^[0-9]{8}$'),
  street text check (char_length(street) <= 120),
  number text check (char_length(number) <= 20),
  complement text check (char_length(complement) <= 80),
  neighborhood text check (char_length(neighborhood) <= 80),
  reference text check (char_length(reference) <= 160),
  purged_at timestamptz
);

create table public.order_items (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.orders (id),
  product_id uuid not null references public.products (id),
  variant_id uuid references public.product_variants (id),
  product_name text not null,
  variant_name text,
  category_name text not null default '',
  unit_price_cents integer not null check (unit_price_cents >= 0),
  add_ons_unit_cents integer not null default 0 check (add_ons_unit_cents >= 0),
  quantity integer not null check (quantity between 1 and 99),
  line_total_cents integer not null,
  unit_cost_cents integer check (unit_cost_cents >= 0),
  notes text not null default '' check (char_length(notes) <= 200),
  requires_kitchen boolean not null,
  status text not null default 'pending' check (status in ('pending', 'preparing', 'ready', 'cancelled')),
  position smallint not null default 0,
  cancelled_by uuid references public.profiles (id),
  cancelled_at timestamptz,
  cancel_reason text check (char_length(cancel_reason) <= 300),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (line_total_cents = (unit_price_cents + add_ons_unit_cents) * quantity),
  check ((status = 'cancelled') = (cancelled_at is not null))
);
create index order_items_order_idx on public.order_items (order_id, position);
create index order_items_product_idx on public.order_items (product_id);
create trigger order_items_touch before update on public.order_items
  for each row execute function private.touch_updated_at();

create table public.order_item_add_ons (
  id uuid primary key default gen_random_uuid(),
  order_item_id uuid not null references public.order_items (id),
  add_on_id uuid not null references public.add_ons (id),
  name text not null,
  unit_price_cents integer not null check (unit_price_cents >= 0),
  quantity smallint not null check (quantity between 1 and 10),
  total_cents integer not null,
  check (total_cents = unit_price_cents * quantity)
);
create index order_item_add_ons_item_idx on public.order_item_add_ons (order_item_id);

create table public.order_status_history (
  id bigint generated always as identity primary key,
  order_id uuid not null references public.orders (id),
  field text not null check (field in ('status', 'delivery_status')),
  from_status text,
  to_status text not null,
  changed_by uuid references public.profiles (id),
  created_at timestamptz not null default now()
);
create index order_status_history_order_idx on public.order_status_history (order_id, created_at);

create table public.order_item_status_history (
  id bigint generated always as identity primary key,
  order_item_id uuid not null references public.order_items (id),
  from_status text,
  to_status text not null,
  changed_by uuid references public.profiles (id),
  created_at timestamptz not null default now()
);
create index order_item_status_history_item_idx on public.order_item_status_history (order_item_id, created_at);

create table public.cancellations (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.orders (id),
  order_item_id uuid references public.order_items (id),
  reason text not null check (char_length(btrim(reason)) between 3 and 300),
  status text not null check (status in ('requested', 'approved', 'rejected')),
  requested_by uuid not null references public.profiles (id),
  requested_at timestamptz not null default now(),
  resolved_by uuid references public.profiles (id),
  resolved_at timestamptz,
  resolution_note text check (char_length(resolution_note) <= 300),
  check ((status = 'requested') = (resolved_at is null))
);
create index cancellations_status_idx on public.cancellations (status, requested_at desc);
create unique index cancellations_one_open_request on public.cancellations
  (order_id, coalesce(order_item_id, '00000000-0000-0000-0000-000000000000'::uuid))
  where status = 'requested';

-- -----------------------------------------------------------------------------
-- Pagamentos (registro manual no caixa)
--   pending   -> aguardando conferência (ex.: Pix a confirmar). Reserva saldo, não conta como recebido.
--   confirmed -> recebido e conferido pelo funcionário.
--   cancelled -> pagamento pendente que não se concretizou.
--   refunded  -> estornado (exige evento auditável).
-- Nunca armazenar número de cartão, CVV ou dados sensíveis.
-- -----------------------------------------------------------------------------
create table public.payments (
  id uuid primary key default gen_random_uuid(),
  dining_tab_id uuid not null references public.dining_tabs (id),
  cash_session_id uuid not null references public.cash_sessions (id),
  method text not null check (method in ('cash', 'pix', 'debit', 'credit')),
  amount_cents integer not null check (amount_cents between 1 and 100000000),
  received_cents integer not null,
  change_cents integer generated always as (received_cents - amount_cents) stored,
  status text not null check (status in ('pending', 'confirmed', 'cancelled', 'refunded')),
  external_reference text check (char_length(external_reference) <= 80),
  request_id uuid not null unique,
  created_by uuid not null references public.profiles (id),
  created_at timestamptz not null default now(),
  confirmed_by uuid references public.profiles (id),
  confirmed_at timestamptz,
  cancelled_by uuid references public.profiles (id),
  cancelled_at timestamptz,
  refunded_by uuid references public.profiles (id),
  refunded_at timestamptz,
  status_reason text check (char_length(status_reason) <= 200),
  check (received_cents >= amount_cents),
  check (method = 'cash' or received_cents = amount_cents),
  check ((status in ('confirmed', 'refunded')) = (confirmed_at is not null)),
  check ((status = 'refunded') = (refunded_at is not null)),
  check ((status = 'cancelled') = (cancelled_at is not null))
);
create index payments_tab_idx on public.payments (dining_tab_id);
create index payments_session_idx on public.payments (cash_session_id);
create index payments_created_idx on public.payments (created_at desc);

-- Eventos financeiros imutáveis. amount_cents com sinal: + recebido, - estornado.
-- cash_session_id = sessão de caixa onde o efeito financeiro ocorreu.
create table public.payment_events (
  id bigint generated always as identity primary key,
  payment_id uuid not null references public.payments (id),
  event text not null check (event in ('registered', 'confirmed', 'cancelled', 'refunded')),
  method text not null check (method in ('cash', 'pix', 'debit', 'credit')),
  amount_cents integer not null,
  cash_session_id uuid references public.cash_sessions (id),
  reason text,
  actor_id uuid references public.profiles (id),
  created_at timestamptz not null default now(),
  check (event <> 'confirmed' or amount_cents > 0),
  check (event <> 'refunded' or amount_cents < 0),
  check (event not in ('registered', 'cancelled') or amount_cents = 0)
);
create index payment_events_session_idx on public.payment_events (cash_session_id, event);
create index payment_events_created_idx on public.payment_events (created_at);

-- -----------------------------------------------------------------------------
-- Auditoria (somente inserção, via funções)
-- -----------------------------------------------------------------------------
create table public.audit_logs (
  id bigint generated always as identity primary key,
  actor_id uuid references public.profiles (id),
  actor_role text,
  action text not null,
  entity text not null,
  entity_id text,
  details jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create index audit_logs_created_idx on public.audit_logs (created_at desc);
create index audit_logs_entity_idx on public.audit_logs (entity, entity_id);
create index audit_logs_actor_idx on public.audit_logs (actor_id, created_at desc);

-- -----------------------------------------------------------------------------
-- Tabelas internas (schema private, inacessíveis pela API)
-- -----------------------------------------------------------------------------
create table private.idempotency_keys (
  scope text not null,
  key uuid not null,
  request_hash text not null,
  response jsonb,
  created_at timestamptz not null default now(),
  primary key (scope, key)
);
create index idempotency_keys_created_idx on private.idempotency_keys (created_at);

create table private.rate_limit_hits (
  bucket text not null,
  created_at timestamptz not null default now()
);
create index rate_limit_hits_bucket_idx on private.rate_limit_hits (bucket, created_at);

create table private.order_counters (
  business_date date primary key,
  last_number integer not null
);
`,o=`-- =============================================================================
-- Espeteks — 0002: cargos, permissões, funções de autorização, auditoria
-- A autorização é sempre derivada de public.profiles + public.role_permissions,
-- que só podem ser alterados por funções privilegiadas. user_metadata é ignorado.
-- =============================================================================

insert into public.roles (key, name, description, sort_order) values
  ('admin',     'Administrador', 'Acesso integral ao sistema.', 1),
  ('manager',   'Gerente',       'Operação, vendas, relatórios, descontos e cancelamentos.', 2),
  ('attendant', 'Atendente',     'Pedidos, mesas, comandas e atendimento.', 3),
  ('kitchen',   'Cozinha',       'Pedidos em preparo e atualização de status operacional.', 4),
  ('cashier',   'Caixa',         'Contas, recebimentos, fechamento de vendas e caixa.', 5);

insert into public.permissions (key, module, description) values
  ('orders.view',            'Pedidos',       'Visualizar pedidos e atendimento'),
  ('orders.manage',          'Pedidos',       'Aceitar, recusar, encaminhar e concluir pedidos; solicitar cancelamento'),
  ('orders.create',          'Pedidos',       'Lançar pedidos pelo atendimento / acrescentar itens'),
  ('orders.cancel',          'Pedidos',       'Executar e aprovar cancelamentos de pedidos e itens'),
  ('kitchen.view',           'Cozinha',       'Visualizar o painel da cozinha'),
  ('kitchen.update',         'Cozinha',       'Atualizar status de preparo'),
  ('customers.view_contact', 'Clientes',      'Ver telefone e endereço de clientes'),
  ('tabs.view',              'Comandas',      'Consultar mesas, comandas e contas'),
  ('tabs.manage',            'Comandas',      'Abrir comandas, pedir conta, taxa de serviço'),
  ('tabs.transfer',          'Comandas',      'Transferir comandas e pedidos entre mesas'),
  ('tabs.discount',          'Comandas',      'Aplicar e anular descontos'),
  ('tabs.reopen',            'Comandas',      'Reabrir contas fechadas'),
  ('tabs.force_close',       'Comandas',      'Encerrar conta com saldo pendente (excepcional)'),
  ('payments.register',      'Pagamentos',    'Registrar/confirmar pagamentos e finalizar vendas'),
  ('payments.refund',        'Pagamentos',    'Estornar pagamentos'),
  ('cash.operate',           'Caixa',         'Abrir e fechar o próprio caixa, sangrias e reforços'),
  ('cash.view_all',          'Caixa',         'Consultar e fechar caixas de todos os operadores'),
  ('menu.manage',            'Cardápio',      'Cadastrar produtos, categorias, adicionais e preços'),
  ('menu.availability',      'Cardápio',      'Alterar a disponibilidade de produtos'),
  ('tables.manage',          'Mesas',         'Cadastrar mesas e gerenciar QR Codes'),
  ('delivery.manage',        'Entregas',      'Bairros, taxas e regras de entrega'),
  ('settings.manage',        'Configurações', 'Configurações do estabelecimento'),
  ('staff.manage',           'Equipe',        'Gerenciar funcionários'),
  ('permissions.manage',     'Equipe',        'Editar permissões dos cargos'),
  ('reports.view',           'Relatórios',    'Dashboard financeiro e relatórios'),
  ('audit.view',             'Auditoria',     'Consultar histórico e auditoria');

-- Administrador recebe todas (e também é tratado como superusuário lógico em has_perm).
insert into public.role_permissions (role_key, permission_key)
select 'admin', key from public.permissions;

insert into public.role_permissions (role_key, permission_key)
select 'manager', unnest(array[
  'orders.view', 'orders.manage', 'orders.create', 'orders.cancel', 'kitchen.view', 'kitchen.update',
  'customers.view_contact', 'tabs.view', 'tabs.manage', 'tabs.transfer', 'tabs.discount', 'tabs.reopen',
  'payments.register', 'payments.refund', 'cash.operate', 'cash.view_all', 'menu.availability',
  'reports.view', 'audit.view'
]);

insert into public.role_permissions (role_key, permission_key)
select 'attendant', unnest(array[
  'orders.view', 'orders.manage', 'orders.create', 'kitchen.view', 'customers.view_contact',
  'tabs.view', 'tabs.manage', 'menu.availability'
]);

insert into public.role_permissions (role_key, permission_key)
select 'kitchen', unnest(array['kitchen.view', 'kitchen.update', 'menu.availability']);

insert into public.role_permissions (role_key, permission_key)
select 'cashier', unnest(array[
  'orders.view', 'orders.manage', 'customers.view_contact', 'tabs.view', 'tabs.manage',
  'payments.register', 'cash.operate'
]);

-- -----------------------------------------------------------------------------
-- Funções de autorização (SECURITY DEFINER para evitar recursão de RLS em profiles)
-- -----------------------------------------------------------------------------
create or replace function private.current_role_key()
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select p.role_key from public.profiles p where p.id = auth.uid() and p.active;
$$;

create or replace function private.is_staff()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.profiles p
    where p.id = auth.uid() and p.active and p.role_key is not null
  );
$$;

create or replace function private.has_perm(p_perm text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.profiles p
    where p.id = auth.uid()
      and p.active
      and p.role_key is not null
      and (
        p.role_key = 'admin'
        or exists (
          select 1 from public.role_permissions rp
          where rp.role_key = p.role_key and rp.permission_key = p_perm
        )
      )
  );
$$;

create or replace function private.require_perm(p_perm text)
returns void
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not private.has_perm(p_perm) then
    raise exception using errcode = '42501', message = 'FORBIDDEN',
      detail = 'Você não tem permissão para esta operação (' || p_perm || ').';
  end if;
end;
$$;

create or replace function private.require_any_perm(variadic p_perms text[])
returns void
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  p text;
begin
  foreach p in array p_perms loop
    if private.has_perm(p) then
      return;
    end if;
  end loop;
  raise exception using errcode = '42501', message = 'FORBIDDEN',
    detail = 'Você não tem permissão para esta operação (' || array_to_string(p_perms, ' ou ') || ').';
end;
$$;

-- Usuário autenticado e ativo (id do perfil) ou erro.
create or replace function private.current_staff_id()
returns uuid
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v uuid;
begin
  select p.id into v from public.profiles p
  where p.id = auth.uid() and p.active and p.role_key is not null;
  if v is null then
    raise exception using errcode = '42501', message = 'FORBIDDEN', detail = 'Sessão sem perfil ativo.';
  end if;
  return v;
end;
$$;

-- -----------------------------------------------------------------------------
-- Auditoria
-- -----------------------------------------------------------------------------
create or replace function private.audit(
  p_action text,
  p_entity text,
  p_entity_id text,
  p_details jsonb default '{}'::jsonb
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.audit_logs (actor_id, actor_role, action, entity, entity_id, details)
  values (
    (select p.id from public.profiles p where p.id = auth.uid()),
    private.current_role_key(),
    p_action,
    p_entity,
    p_entity_id,
    coalesce(p_details, '{}'::jsonb)
  );
end;
$$;

-- Gatilho genérico de auditoria para tabelas de configuração/cadastro.
create or replace function private.audit_row_change()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_row jsonb;
  v_diff jsonb;
begin
  v_row := case when tg_op = 'DELETE' then to_jsonb(old) else to_jsonb(new) end;
  if tg_op = 'UPDATE' then
    select jsonb_object_agg(n.key, jsonb_build_object('from', o.value, 'to', n.value))
      into v_diff
    from jsonb_each(to_jsonb(new)) n
    join jsonb_each(to_jsonb(old)) o using (key)
    where n.value is distinct from o.value and n.key not in ('updated_at', 'updated_by');
    if v_diff is null then
      return new;
    end if;
  elsif tg_op = 'INSERT' then
    v_diff := v_row;
  else
    v_diff := v_row;
  end if;
  perform private.audit(
    lower(tg_op),
    tg_table_name,
    coalesce(v_row ->> 'id', v_row ->> 'product_id', v_row ->> 'role_key'),
    v_diff
  );
  return coalesce(new, old);
end;
$$;

create trigger audit_categories after insert or update or delete on public.categories
  for each row execute function private.audit_row_change();
create trigger audit_products after insert or update or delete on public.products
  for each row execute function private.audit_row_change();
create trigger audit_product_costs after insert or update or delete on public.product_costs
  for each row execute function private.audit_row_change();
create trigger audit_product_variants after insert or update or delete on public.product_variants
  for each row execute function private.audit_row_change();
create trigger audit_add_ons after insert or update or delete on public.add_ons
  for each row execute function private.audit_row_change();
create trigger audit_product_add_ons after insert or update or delete on public.product_add_ons
  for each row execute function private.audit_row_change();
create trigger audit_tables after insert or update or delete on public.tables
  for each row execute function private.audit_row_change();
create trigger audit_delivery_zones after insert or update or delete on public.delivery_zones
  for each row execute function private.audit_row_change();
create trigger audit_store_settings after update on public.store_settings
  for each row execute function private.audit_row_change();
create trigger audit_role_permissions after insert or delete on public.role_permissions
  for each row execute function private.audit_row_change();
create trigger audit_profiles after update on public.profiles
  for each row execute function private.audit_row_change();

-- -----------------------------------------------------------------------------
-- Histórico de status de pedidos e itens
-- -----------------------------------------------------------------------------
create or replace function private.log_order_status()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := (select p.id from public.profiles p where p.id = auth.uid());
begin
  if tg_op = 'INSERT' then
    insert into public.order_status_history (order_id, field, from_status, to_status, changed_by)
    values (new.id, 'status', null, new.status, v_actor);
    if new.delivery_status is not null then
      insert into public.order_status_history (order_id, field, from_status, to_status, changed_by)
      values (new.id, 'delivery_status', null, new.delivery_status, v_actor);
    end if;
  else
    if new.status is distinct from old.status then
      insert into public.order_status_history (order_id, field, from_status, to_status, changed_by)
      values (new.id, 'status', old.status, new.status, v_actor);
    end if;
    if new.delivery_status is distinct from old.delivery_status then
      insert into public.order_status_history (order_id, field, from_status, to_status, changed_by)
      values (new.id, 'delivery_status', old.delivery_status, new.delivery_status, v_actor);
    end if;
  end if;
  return new;
end;
$$;

create trigger orders_status_history after insert or update of status, delivery_status on public.orders
  for each row execute function private.log_order_status();

create or replace function private.log_order_item_status()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' or new.status is distinct from old.status then
    insert into public.order_item_status_history (order_item_id, from_status, to_status, changed_by)
    values (
      new.id,
      case when tg_op = 'INSERT' then null else old.status end,
      new.status,
      (select p.id from public.profiles p where p.id = auth.uid())
    );
  end if;
  return new;
end;
$$;

create trigger order_items_status_history after insert or update of status on public.order_items
  for each row execute function private.log_order_item_status();

-- -----------------------------------------------------------------------------
-- Perfis: criados automaticamente, SEM cargo e INATIVOS.
-- O cargo é atribuído pela Edge Function admin-users (service role) ou pelo bootstrap.
-- -----------------------------------------------------------------------------
create or replace function private.handle_new_auth_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.profiles (id, email, full_name, role_key, active)
  values (
    new.id,
    new.email,
    left(coalesce(new.raw_user_meta_data ->> 'full_name', ''), 120),
    null,
    false
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

create trigger on_auth_user_created after insert on auth.users
  for each row execute function private.handle_new_auth_user();

create or replace function private.handle_auth_user_email_change()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.profiles set email = new.email where id = new.id;
  return new;
end;
$$;

create trigger on_auth_user_email_changed after update of email on auth.users
  for each row execute function private.handle_auth_user_email_change();

-- Executar UMA vez no SQL Editor do Supabase (como postgres), após criar o usuário em
-- Authentication > Users. Recusa se já houver um administrador ativo.
--   select private.bootstrap_first_admin('voce@exemplo.com', 'Seu Nome');
create or replace function private.bootstrap_first_admin(p_email text, p_full_name text default '')
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id uuid;
begin
  if exists (select 1 from public.profiles where role_key = 'admin' and active) then
    raise exception 'Já existe um administrador ativo. Use o painel de Funcionários.';
  end if;
  select u.id into v_id from auth.users u where lower(u.email) = lower(btrim(p_email));
  if v_id is null then
    raise exception 'Usuário % não encontrado em auth.users. Crie-o primeiro em Authentication > Users.', p_email;
  end if;
  insert into public.profiles (id, email, full_name, role_key, active)
  values (v_id, lower(btrim(p_email)), coalesce(p_full_name, ''), 'admin', true)
  on conflict (id) do update
    set role_key = 'admin', active = true,
        full_name = case when excluded.full_name <> '' then excluded.full_name else public.profiles.full_name end;
  insert into public.audit_logs (actor_id, actor_role, action, entity, entity_id, details)
  values (null, 'system', 'bootstrap_admin', 'profiles', v_id::text, jsonb_build_object('email', p_email));
  return 'Administrador configurado: ' || p_email;
end;
$$;

-- -----------------------------------------------------------------------------
-- RPC: dados de acesso do usuário logado (para a interface).
-- A interface usa isso apenas para exibir/ocultar recursos; o banco revalida tudo.
-- -----------------------------------------------------------------------------
create or replace function public.my_access()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_profile public.profiles;
  v_perms text[];
begin
  select * into v_profile from public.profiles where id = auth.uid();
  if v_profile.id is null then
    return jsonb_build_object('authenticated', auth.uid() is not null, 'active', false, 'permissions', '[]'::jsonb);
  end if;
  if v_profile.active and v_profile.role_key = 'admin' then
    select array_agg(key order by key) into v_perms from public.permissions;
  elsif v_profile.active and v_profile.role_key is not null then
    select array_agg(permission_key order by permission_key) into v_perms
    from public.role_permissions where role_key = v_profile.role_key;
  end if;
  return jsonb_build_object(
    'authenticated', true,
    'user_id', v_profile.id,
    'email', v_profile.email,
    'full_name', v_profile.full_name,
    'role_key', v_profile.role_key,
    'role_name', (select r.name from public.roles r where r.key = v_profile.role_key),
    'active', v_profile.active and v_profile.role_key is not null,
    'permissions', to_jsonb(coalesce(v_perms, array[]::text[]))
  );
end;
$$;

-- Gestão de cargo/ativação feita pelo banco (a Edge Function também bloqueia o login no Auth).
create or replace function public.set_staff_access(p_user_id uuid, p_role_key text, p_active boolean, p_full_name text default null)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_me uuid;
  v_target public.profiles;
begin
  perform private.require_perm('staff.manage');
  v_me := private.current_staff_id();
  select * into v_target from public.profiles where id = p_user_id for update;
  if v_target.id is null then
    raise exception using message = 'NOT_FOUND', detail = 'Funcionário não encontrado.';
  end if;
  if p_role_key is not null and not exists (select 1 from public.roles where key = p_role_key) then
    raise exception using message = 'INVALID_ROLE', detail = 'Cargo inválido.';
  end if;
  -- Somente administradores podem conceder ou retirar o cargo de administrador.
  if (p_role_key = 'admin' or v_target.role_key = 'admin') and private.current_role_key() <> 'admin' then
    raise exception using errcode = '42501', message = 'FORBIDDEN',
      detail = 'Somente administradores podem alterar administradores.';
  end if;
  if p_user_id = v_me and (p_active is false or p_role_key is distinct from v_target.role_key) then
    raise exception using message = 'SELF_LOCKOUT', detail = 'Você não pode desativar ou alterar o próprio cargo.';
  end if;
  if v_target.role_key = 'admin' and v_target.active
     and (p_active is false or p_role_key is distinct from 'admin')
     and (select count(*) from public.profiles where role_key = 'admin' and active) <= 1 then
    raise exception using message = 'LAST_ADMIN', detail = 'É necessário manter ao menos um administrador ativo.';
  end if;
  update public.profiles
     set role_key = p_role_key,
         active = coalesce(p_active, active),
         full_name = coalesce(nullif(btrim(p_full_name), ''), full_name)
   where id = p_user_id;
end;
$$;

create or replace function public.set_role_permissions(p_role_key text, p_permissions text[])
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform private.require_perm('permissions.manage');
  if p_role_key = 'admin' then
    raise exception using message = 'INVALID_ROLE', detail = 'O cargo Administrador sempre possui todas as permissões.';
  end if;
  if not exists (select 1 from public.roles where key = p_role_key) then
    raise exception using message = 'INVALID_ROLE', detail = 'Cargo inválido.';
  end if;
  if exists (select 1 from unnest(p_permissions) k where k not in (select key from public.permissions)) then
    raise exception using message = 'INVALID_PERMISSION', detail = 'Permissão desconhecida.';
  end if;
  delete from public.role_permissions
   where role_key = p_role_key and permission_key <> all (p_permissions);
  insert into public.role_permissions (role_key, permission_key)
  select p_role_key, k from unnest(p_permissions) k
  on conflict do nothing;
end;
$$;
`,s=`-- =============================================================================
-- Espeteks — 0003: regras de negócio (RPCs transacionais)
--
-- Padrão de erros: RAISE com message = CÓDIGO (ex.: 'PRICE_CHANGED') e detail =
-- texto em português para o usuário. hint pode conter JSON com dados auxiliares.
-- Todas as funções públicas são SECURITY DEFINER com search_path vazio e validam
-- permissões internamente com private.require_perm().
--
-- Ordem de bloqueio (evita deadlocks): mesa -> pedido -> comanda -> pagamento.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- Utilitários
-- -----------------------------------------------------------------------------
create or replace function private.random_token()
returns text
language sql
volatile
set search_path = ''
as $$
  -- 2 x UUIDv4 = 244 bits aleatórios, codificados em base64url (sem padding).
  select translate(
    encode(decode(replace(gen_random_uuid()::text, '-', '') || replace(gen_random_uuid()::text, '-', ''), 'hex'), 'base64'),
    '+/=', '-_'
  );
$$;

create or replace function private.try_uuid(p text)
returns uuid
language plpgsql
immutable
set search_path = ''
as $$
begin
  return p::uuid;
exception when others then
  return null;
end;
$$;

-- Inteiro a partir de jsonb: somente números inteiros (rejeita "2", 1.5, null).
create or replace function private.json_int(p jsonb)
returns integer
language plpgsql
immutable
set search_path = ''
as $$
begin
  if p is null or jsonb_typeof(p) <> 'number' then
    return null;
  end if;
  if (p::text)::numeric <> trunc((p::text)::numeric) or abs((p::text)::numeric) > 2000000000 then
    return null;
  end if;
  return (p::text)::integer;
exception when others then
  return null;
end;
$$;

-- Texto livre: remove caracteres de controle, apara e valida tamanho.
create or replace function private.clean_text(p text, p_max integer, p_field text)
returns text
language plpgsql
immutable
set search_path = ''
as $$
declare
  v text := btrim(regexp_replace(coalesce(p, ''), '[[:cntrl:]]+', ' ', 'g'));
begin
  if char_length(v) > p_max then
    raise exception using message = 'INVALID_INPUT',
      detail = format('O campo "%s" excede %s caracteres.', p_field, p_max);
  end if;
  return v;
end;
$$;

create or replace function private.normalize_phone(p text)
returns text
language plpgsql
immutable
set search_path = ''
as $$
declare
  v text := regexp_replace(coalesce(p, ''), '\\D', '', 'g');
begin
  if v = '' then
    return null;
  end if;
  if char_length(v) < 10 or char_length(v) > 13 then
    raise exception using message = 'INVALID_PHONE', detail = 'Telefone inválido. Informe DDD + número.';
  end if;
  return v;
end;
$$;

create or replace function private.settings()
returns public.store_settings
language sql
stable
security definer
set search_path = ''
as $$
  select * from public.store_settings where id = 1;
$$;

create or replace function private.business_date()
returns date
language sql
stable
security definer
set search_path = ''
as $$
  select (now() at time zone (select s.timezone from public.store_settings s where s.id = 1))::date;
$$;

-- Verifica se a loja está aberta em p_at, considerando intervalos que cruzam a meia-noite.
create or replace function private.is_open_at(p_hours jsonb, p_tz text, p_at timestamptz)
returns boolean
language plpgsql
stable
set search_path = ''
as $$
declare
  v_local timestamp := p_at at time zone p_tz;
  v_time time := v_local::time;
  v_days text[] := array['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];
  v_dow integer := extract(dow from v_local)::integer;
  v_today text := v_days[v_dow + 1];
  v_yday text := v_days[((v_dow + 6) % 7) + 1];
  r jsonb;
  v_start time;
  v_end time;
begin
  for r in select * from jsonb_array_elements(coalesce(p_hours -> v_today, '[]'::jsonb)) loop
    v_start := (r ->> 0)::time;
    v_end := (r ->> 1)::time;
    if v_end > v_start then
      if v_time >= v_start and v_time < v_end then
        return true;
      end if;
    elsif v_time >= v_start then
      return true;
    end if;
  end loop;
  for r in select * from jsonb_array_elements(coalesce(p_hours -> v_yday, '[]'::jsonb)) loop
    v_start := (r ->> 0)::time;
    v_end := (r ->> 1)::time;
    if v_end <= v_start and v_time < v_end then
      return true;
    end if;
  end loop;
  return false;
end;
$$;

create or replace function private.store_open_now()
returns boolean
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  s public.store_settings := private.settings();
begin
  if not s.accepting_orders then
    return false;
  end if;
  if not s.enforce_opening_hours then
    return true;
  end if;
  return private.is_open_at(s.opening_hours, s.timezone, now());
end;
$$;

-- IP do cliente (cabeçalhos repassados pelo gateway do Supabase). Pode ser nulo.
create or replace function private.request_ip()
returns text
language plpgsql
stable
set search_path = ''
as $$
declare
  h jsonb;
begin
  h := nullif(current_setting('request.headers', true), '')::jsonb;
  if h is null then
    return null;
  end if;
  return coalesce(
    nullif(h ->> 'cf-connecting-ip', ''),
    nullif(h ->> 'x-real-ip', ''),
    nullif(btrim(split_part(h ->> 'x-forwarded-for', ',', 1)), '')
  );
exception when others then
  return null;
end;
$$;

-- Limitação de requisições por "balde" (janela deslizante).
create or replace function private.hit_rate_limit(p_bucket text, p_limit integer, p_window interval)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if p_bucket is null then
    return;
  end if;
  perform pg_advisory_xact_lock(hashtext('rl:' || p_bucket));
  if (select count(*) from private.rate_limit_hits
      where bucket = p_bucket and created_at > now() - p_window) >= p_limit then
    raise exception using message = 'RATE_LIMITED',
      detail = 'Muitas solicitações em pouco tempo. Aguarde alguns minutos e tente novamente.';
  end if;
  insert into private.rate_limit_hits (bucket) values (p_bucket);
end;
$$;

create or replace function private.next_order_number(p_date date)
returns integer
language sql
security definer
set search_path = ''
as $$
  insert into private.order_counters as c (business_date, last_number)
  values (p_date, 1)
  on conflict (business_date) do update set last_number = c.last_number + 1
  returning last_number;
$$;

-- -----------------------------------------------------------------------------
-- Precificação: recalcula itens exclusivamente a partir do banco.
-- Entrada: [{product_id, variant_id?, quantity, notes?, add_ons:[{add_on_id, quantity}]}]
-- Saída:   {"lines":[...], "subtotal_cents": n}
-- p_public = true exige produto/categoria visíveis no cardápio.
-- -----------------------------------------------------------------------------
create or replace function private.price_items(p_items jsonb, p_public boolean)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_item jsonb;
  v_addon jsonb;
  v_lines jsonb := '[]'::jsonb;
  v_addons jsonb;
  v_subtotal bigint := 0;
  v_product record;
  v_variant_real_id uuid;
  v_variant_name text;
  v_ao record;
  v_product_id uuid;
  v_variant_id uuid;
  v_ao_id uuid;
  v_qty integer;
  v_ao_qty integer;
  v_unit integer;
  v_ao_unit integer;
  v_ao_units integer;
  v_has_variants boolean;
  v_line_total bigint;
  v_notes text;
  v_seen uuid[];
  v_pos integer := 0;
begin
  if p_items is null or jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) = 0 then
    raise exception using message = 'EMPTY_ORDER', detail = 'Adicione ao menos um item ao pedido.';
  end if;
  if jsonb_array_length(p_items) > 50 then
    raise exception using message = 'INVALID_INPUT', detail = 'Pedido com itens demais (máximo 50 linhas).';
  end if;

  for v_item in select * from jsonb_array_elements(p_items) loop
    v_pos := v_pos + 1;
    if jsonb_typeof(v_item) <> 'object' then
      raise exception using message = 'INVALID_ITEM', detail = 'Item inválido no pedido.';
    end if;

    v_product_id := private.try_uuid(v_item ->> 'product_id');
    v_qty := private.json_int(v_item -> 'quantity');
    if v_product_id is null then
      raise exception using message = 'INVALID_ITEM', detail = 'Produto inválido no pedido.';
    end if;
    if v_qty is null or v_qty < 1 or v_qty > 99 then
      raise exception using message = 'INVALID_QUANTITY', detail = 'Quantidade inválida (1 a 99).';
    end if;

    select p.id, p.name, p.price_cents,
           (select pc.cost_cents from public.product_costs pc where pc.product_id = p.id) as cost_cents,
           p.available, p.visible, p.active,
           p.requires_kitchen, p.max_add_ons, c.name as category_name, c.active as category_active,
           c.visible as category_visible
      into v_product
    from public.products p
    join public.categories c on c.id = p.category_id
    where p.id = v_product_id;

    if v_product.id is null or not v_product.active or not v_product.category_active
       or (p_public and (not v_product.visible or not v_product.category_visible)) then
      raise exception using message = 'PRODUCT_UNAVAILABLE',
        detail = 'Um dos produtos não está mais disponível no cardápio.',
        hint = jsonb_build_object('product_id', v_product_id)::text;
    end if;
    if not v_product.available then
      raise exception using message = 'PRODUCT_UNAVAILABLE',
        detail = format('"%s" está indisponível no momento.', v_product.name),
        hint = jsonb_build_object('product_id', v_product_id)::text;
    end if;

    -- Variação
    v_variant_id := private.try_uuid(v_item ->> 'variant_id');
    select exists (select 1 from public.product_variants pv where pv.product_id = v_product_id and pv.active)
      into v_has_variants;
    v_variant_real_id := null;
    v_variant_name := null;
    if v_has_variants then
      if v_variant_id is null then
        raise exception using message = 'VARIANT_REQUIRED',
          detail = format('Escolha uma opção para "%s".', v_product.name);
      end if;
      v_unit := null;
      select pv.id, pv.name, pv.price_cents into v_variant_real_id, v_variant_name, v_unit
      from public.product_variants pv
      where pv.id = v_variant_id and pv.product_id = v_product_id and pv.active;
      if v_variant_real_id is null then
        raise exception using message = 'PRODUCT_UNAVAILABLE',
          detail = format('A opção escolhida para "%s" não está mais disponível.', v_product.name),
          hint = jsonb_build_object('product_id', v_product_id)::text;
      end if;
    else
      if (v_item ->> 'variant_id') is not null then
        raise exception using message = 'INVALID_ITEM', detail = format('"%s" não possui opções.', v_product.name);
      end if;
      v_unit := v_product.price_cents;
    end if;

    -- Adicionais
    v_addons := '[]'::jsonb;
    v_ao_unit := 0;
    v_ao_units := 0;
    v_seen := array[]::uuid[];
    if v_item ? 'add_ons' and v_item -> 'add_ons' <> 'null'::jsonb then
      if jsonb_typeof(v_item -> 'add_ons') <> 'array' or jsonb_array_length(v_item -> 'add_ons') > 20 then
        raise exception using message = 'INVALID_ITEM', detail = 'Adicionais inválidos.';
      end if;
      for v_addon in select * from jsonb_array_elements(v_item -> 'add_ons') loop
        v_ao_id := private.try_uuid(v_addon ->> 'add_on_id');
        v_ao_qty := coalesce(private.json_int(v_addon -> 'quantity'), case when v_addon ? 'quantity' then -1 else 1 end);
        if v_ao_id is null or v_ao_id = any (v_seen) then
          raise exception using message = 'INVALID_ADDON', detail = 'Adicional inválido ou repetido.';
        end if;
        v_seen := v_seen || v_ao_id;
        select a.id, a.name, a.price_cents, a.active, a.available, pa.max_quantity into v_ao
        from public.product_add_ons pa
        join public.add_ons a on a.id = pa.add_on_id
        where pa.product_id = v_product_id and pa.add_on_id = v_ao_id;
        if v_ao.id is null then
          raise exception using message = 'INVALID_ADDON',
            detail = format('Adicional não permitido para "%s".', v_product.name);
        end if;
        if not v_ao.active or not v_ao.available then
          raise exception using message = 'ADDON_UNAVAILABLE',
            detail = format('O adicional "%s" está indisponível.', v_ao.name);
        end if;
        if v_ao_qty < 1 or v_ao_qty > v_ao.max_quantity then
          raise exception using message = 'INVALID_ADDON',
            detail = format('Quantidade inválida para o adicional "%s" (máximo %s).', v_ao.name, v_ao.max_quantity);
        end if;
        v_ao_unit := v_ao_unit + v_ao.price_cents * v_ao_qty;
        v_ao_units := v_ao_units + v_ao_qty;
        v_addons := v_addons || jsonb_build_object(
          'add_on_id', v_ao.id, 'name', v_ao.name, 'unit_price_cents', v_ao.price_cents,
          'quantity', v_ao_qty, 'total_cents', v_ao.price_cents * v_ao_qty);
      end loop;
    end if;
    if v_product.max_add_ons is not null and v_ao_units > v_product.max_add_ons then
      raise exception using message = 'INVALID_ADDON',
        detail = format('"%s" permite no máximo %s adicionais.', v_product.name, v_product.max_add_ons);
    end if;

    v_notes := private.clean_text(v_item ->> 'notes', 200, 'observação');
    v_line_total := (v_unit + v_ao_unit)::bigint * v_qty;
    v_subtotal := v_subtotal + v_line_total;
    if v_subtotal > 100000000 then
      raise exception using message = 'INVALID_INPUT', detail = 'Valor do pedido acima do limite permitido.';
    end if;

    v_lines := v_lines || jsonb_build_object(
      'position', v_pos,
      'product_id', v_product_id,
      'variant_id', v_variant_real_id,
      'product_name', v_product.name,
      'variant_name', v_variant_name,
      'category_name', v_product.category_name,
      'unit_price_cents', v_unit,
      'add_ons_unit_cents', v_ao_unit,
      'quantity', v_qty,
      'line_total_cents', v_line_total,
      'unit_cost_cents', v_product.cost_cents,
      'notes', v_notes,
      'requires_kitchen', v_product.requires_kitchen,
      'add_ons', v_addons
    );
  end loop;

  return jsonb_build_object('lines', v_lines, 'subtotal_cents', v_subtotal);
end;
$$;

-- Insere pedido + itens + adicionais + contato a partir de um registro normalizado.
create or replace function private.insert_order(p jsonb)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_order_id uuid;
  v_item_id uuid;
  v_line jsonb;
  v_ao jsonb;
  v_date date := private.business_date();
  v_subtotal integer := (p -> 'priced' ->> 'subtotal_cents')::integer;
  v_fee integer := coalesce((p ->> 'delivery_fee_cents')::integer, 0);
begin
  insert into public.orders (
    business_date, daily_number, public_token, channel, source, table_id, qr_token_id, dining_tab_id,
    customer_name, notes, status, delivery_status, items_subtotal_cents, delivery_fee_cents, total_cents,
    delivery_zone_id, idempotency_key, created_by, accepted_by, accepted_at, ready_at
  ) values (
    v_date,
    private.next_order_number(v_date),
    private.random_token(),
    p ->> 'channel',
    p ->> 'source',
    (p ->> 'table_id')::uuid,
    (p ->> 'qr_token_id')::uuid,
    (p ->> 'dining_tab_id')::uuid,
    coalesce(p ->> 'customer_name', ''),
    coalesce(p ->> 'notes', ''),
    p ->> 'status',
    case when p ->> 'channel' = 'delivery' then 'awaiting' end,
    v_subtotal,
    v_fee,
    v_subtotal + v_fee,
    (p ->> 'delivery_zone_id')::uuid,
    (p ->> 'idempotency_key')::uuid,
    (p ->> 'created_by')::uuid,
    (p ->> 'accepted_by')::uuid,
    case when p ->> 'status' <> 'pending' then now() end,
    case when p ->> 'status' = 'ready' then now() end
  )
  returning id into v_order_id;

  if p -> 'contact' is not null and p -> 'contact' <> 'null'::jsonb then
    insert into public.order_contacts (order_id, phone, cep, street, number, complement, neighborhood, reference)
    values (
      v_order_id,
      p -> 'contact' ->> 'phone',
      p -> 'contact' ->> 'cep',
      p -> 'contact' ->> 'street',
      p -> 'contact' ->> 'number',
      p -> 'contact' ->> 'complement',
      p -> 'contact' ->> 'neighborhood',
      p -> 'contact' ->> 'reference'
    );
  end if;

  for v_line in select * from jsonb_array_elements(p -> 'priced' -> 'lines') loop
    insert into public.order_items (
      order_id, product_id, variant_id, product_name, variant_name, category_name, unit_price_cents,
      add_ons_unit_cents, quantity, line_total_cents, unit_cost_cents, notes, requires_kitchen, status, position
    ) values (
      v_order_id,
      (v_line ->> 'product_id')::uuid,
      (v_line ->> 'variant_id')::uuid,
      v_line ->> 'product_name',
      v_line ->> 'variant_name',
      v_line ->> 'category_name',
      (v_line ->> 'unit_price_cents')::integer,
      (v_line ->> 'add_ons_unit_cents')::integer,
      (v_line ->> 'quantity')::integer,
      (v_line ->> 'line_total_cents')::integer,
      (v_line ->> 'unit_cost_cents')::integer,
      coalesce(v_line ->> 'notes', ''),
      (v_line ->> 'requires_kitchen')::boolean,
      case when (v_line ->> 'requires_kitchen')::boolean then 'pending' else 'ready' end,
      (v_line ->> 'position')::smallint
    )
    returning id into v_item_id;

    for v_ao in select * from jsonb_array_elements(v_line -> 'add_ons') loop
      insert into public.order_item_add_ons (order_item_id, add_on_id, name, unit_price_cents, quantity, total_cents)
      values (
        v_item_id,
        (v_ao ->> 'add_on_id')::uuid,
        v_ao ->> 'name',
        (v_ao ->> 'unit_price_cents')::integer,
        (v_ao ->> 'quantity')::smallint,
        (v_ao ->> 'total_cents')::integer
      );
    end loop;
  end loop;

  return v_order_id;
end;
$$;

-- -----------------------------------------------------------------------------
-- Comandas: abertura e recálculo
-- -----------------------------------------------------------------------------
create or replace function private.open_tab_internal(p_kind text, p_table_id uuid, p_label text, p_customer_name text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  s public.store_settings := private.settings();
  v_id uuid;
begin
  if p_kind = 'table' then
    -- serializa a abertura por mesa
    perform 1 from public.tables where id = p_table_id and active for update;
    if not found then
      raise exception using message = 'INVALID_TABLE', detail = 'Mesa inválida ou inativa.';
    end if;
    if exists (select 1 from public.dining_tabs where table_id = p_table_id and status in ('open', 'closing')) then
      raise exception using message = 'TABLE_OCCUPIED', detail = 'Esta mesa já possui uma comanda aberta.';
    end if;
  end if;
  insert into public.dining_tabs (kind, table_id, label, customer_name, status, service_fee_enabled, service_fee_bp, opened_by)
  values (
    p_kind,
    case when p_kind = 'table' then p_table_id end,
    coalesce(p_label, ''),
    coalesce(p_customer_name, ''),
    'open',
    p_kind = 'table' and s.service_fee_enabled,
    s.service_fee_bp,
    (select p.id from public.profiles p where p.id = auth.uid())
  )
  returning id into v_id;
  return v_id;
end;
$$;

create or replace function private.recalc_tab(p_tab_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_tab public.dining_tabs;
  v_sub bigint;
  v_del bigint;
  v_service bigint;
  v_disc bigint;
  v_paid bigint;
  v_pending bigint;
begin
  select * into v_tab from public.dining_tabs where id = p_tab_id;
  if v_tab.id is null then
    return;
  end if;

  select coalesce(sum(oi.line_total_cents), 0) into v_sub
  from public.order_items oi
  join public.orders o on o.id = oi.order_id
  where o.dining_tab_id = p_tab_id and o.status not in ('pending', 'cancelled') and oi.status <> 'cancelled';

  select coalesce(sum(o.delivery_fee_cents), 0) into v_del
  from public.orders o
  where o.dining_tab_id = p_tab_id and o.status not in ('pending', 'cancelled');

  v_service := case when v_tab.service_fee_enabled then round(v_sub * v_tab.service_fee_bp / 10000.0) else 0 end;

  select coalesce(sum(case when d.kind = 'amount' then d.value else round(v_sub * d.value / 10000.0) end), 0)
    into v_disc
  from public.discounts d
  where d.dining_tab_id = p_tab_id and d.status = 'active';
  v_disc := least(v_disc, v_sub + v_service + v_del);

  select coalesce(sum(amount_cents) filter (where status = 'confirmed'), 0),
         coalesce(sum(amount_cents) filter (where status = 'pending'), 0)
    into v_paid, v_pending
  from public.payments where dining_tab_id = p_tab_id;

  update public.dining_tabs
     set subtotal_cents = v_sub,
         service_fee_cents = v_service,
         delivery_fee_cents = v_del,
         discount_cents = v_disc,
         total_cents = v_sub + v_service + v_del - v_disc,
         paid_cents = v_paid,
         pending_payment_cents = v_pending,
         version = version + 1
   where id = p_tab_id;
end;
$$;

-- Bloqueia a comanda e garante que está aberta (open/closing).
create or replace function private.lock_open_tab(p_tab_id uuid)
returns public.dining_tabs
language plpgsql
security definer
set search_path = ''
as $$
declare
  v public.dining_tabs;
begin
  select * into v from public.dining_tabs where id = p_tab_id for update;
  if v.id is null then
    raise exception using message = 'NOT_FOUND', detail = 'Comanda não encontrada.';
  end if;
  if v.status not in ('open', 'closing') then
    raise exception using message = 'TAB_NOT_OPEN',
      detail = 'Esta conta não está aberta. Reabra-a para fazer alterações.';
  end if;
  return v;
end;
$$;

-- Sincroniza o status do pedido com os itens de cozinha.
create or replace function private.sync_order_from_items(p_order_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_order public.orders;
  v_k_active integer;
  v_k_ready integer;
  v_k_started integer;
  v_new text;
begin
  select * into v_order from public.orders where id = p_order_id;
  if v_order.status not in ('accepted', 'preparing', 'ready') then
    return;
  end if;
  select count(*) filter (where requires_kitchen and status <> 'cancelled'),
         count(*) filter (where requires_kitchen and status = 'ready'),
         count(*) filter (where requires_kitchen and status in ('preparing', 'ready'))
    into v_k_active, v_k_ready, v_k_started
  from public.order_items where order_id = p_order_id;

  if v_k_active = v_k_ready then
    v_new := 'ready';
  elsif v_k_started > 0 then
    v_new := 'preparing';
  else
    v_new := 'accepted';
  end if;

  if v_new <> v_order.status then
    update public.orders
       set status = v_new,
           preparing_at = case when v_new in ('preparing', 'ready') then coalesce(preparing_at, now()) else preparing_at end,
           ready_at = case when v_new = 'ready' then now() else null end
     where id = p_order_id;
  end if;
end;
$$;

-- Aceita um pedido pendente, vinculando-o à comanda correta.
create or replace function private.accept_order_internal(p_order_id uuid, p_tab_id uuid)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_order public.orders;
  v_tab public.dining_tabs;
  v_tab_id uuid := p_tab_id;
  v_has_kitchen boolean;
begin
  select * into v_order from public.orders where id = p_order_id for update;
  if v_order.id is null then
    raise exception using message = 'NOT_FOUND', detail = 'Pedido não encontrado.';
  end if;
  if v_order.status <> 'pending' then
    raise exception using message = 'INVALID_TRANSITION', detail = 'Este pedido já foi tratado.';
  end if;

  if v_tab_id is null then
    if v_order.channel = 'table' then
      perform 1 from public.tables where id = v_order.table_id for update;
      select id into v_tab_id from public.dining_tabs
       where table_id = v_order.table_id and status in ('open', 'closing');
      if v_tab_id is null then
        v_tab_id := private.open_tab_internal('table', v_order.table_id, '', v_order.customer_name);
      end if;
    else
      v_tab_id := private.open_tab_internal(v_order.channel, null, '', v_order.customer_name);
    end if;
  end if;

  v_tab := private.lock_open_tab(v_tab_id);
  if v_tab.status = 'closing' then
    update public.dining_tabs set status = 'open' where id = v_tab_id;
  end if;

  select exists (
    select 1 from public.order_items
    where order_id = p_order_id and requires_kitchen and status <> 'cancelled'
  ) into v_has_kitchen;

  update public.orders
     set status = case when v_has_kitchen then 'accepted' else 'ready' end,
         dining_tab_id = v_tab_id,
         accepted_by = (select p.id from public.profiles p where p.id = auth.uid()),
         accepted_at = now(),
         ready_at = case when v_has_kitchen then null else now() end
   where id = p_order_id;

  perform private.recalc_tab(v_tab_id);
  return v_tab_id;
end;
$$;

-- -----------------------------------------------------------------------------
-- Gatilhos de mesas e QR Codes
-- -----------------------------------------------------------------------------
create or replace function private.on_table_insert()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.table_qr_tokens (table_id, token, created_by)
  values (new.id, private.random_token(), (select p.id from public.profiles p where p.id = auth.uid()));
  return new;
end;
$$;

create trigger tables_create_qr after insert on public.tables
  for each row execute function private.on_table_insert();

create or replace function private.on_table_deactivate()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if old.active and not new.active then
    if exists (select 1 from public.dining_tabs where table_id = new.id and status in ('open', 'closing')) then
      raise exception using message = 'TABLE_HAS_OPEN_TAB', detail = 'Feche a comanda da mesa antes de desativá-la.';
    end if;
    update public.table_qr_tokens
       set active = false, revoked_at = now(), revoked_by = (select p.id from public.profiles p where p.id = auth.uid())
     where table_id = new.id and active;
  elsif not old.active and new.active then
    if not exists (select 1 from public.table_qr_tokens where table_id = new.id and active) then
      insert into public.table_qr_tokens (table_id, token, created_by)
      values (new.id, private.random_token(), (select p.id from public.profiles p where p.id = auth.uid()));
    end if;
  end if;
  return new;
end;
$$;

create trigger tables_deactivate before update of active on public.tables
  for each row execute function private.on_table_deactivate();

create or replace function public.regenerate_table_qr(p_table_id uuid)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_token text := private.random_token();
begin
  perform private.require_perm('tables.manage');
  perform 1 from public.tables where id = p_table_id and active for update;
  if not found then
    raise exception using message = 'INVALID_TABLE', detail = 'Mesa inválida ou inativa.';
  end if;
  update public.table_qr_tokens
     set active = false, revoked_at = now(), revoked_by = private.current_staff_id()
   where table_id = p_table_id and active;
  insert into public.table_qr_tokens (table_id, token, created_by)
  values (p_table_id, v_token, private.current_staff_id());
  perform private.audit('regenerate_qr', 'tables', p_table_id::text, '{}'::jsonb);
  return v_token;
end;
$$;

create or replace function public.revoke_table_qr(p_table_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform private.require_perm('tables.manage');
  update public.table_qr_tokens
     set active = false, revoked_at = now(), revoked_by = private.current_staff_id()
   where table_id = p_table_id and active;
  perform private.audit('revoke_qr', 'tables', p_table_id::text, '{}'::jsonb);
end;
$$;

-- -----------------------------------------------------------------------------
-- API PÚBLICA (anon): cardápio, mesa, pedido, status
-- -----------------------------------------------------------------------------
create or replace function public.get_public_menu()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  s public.store_settings := private.settings();
begin
  return jsonb_build_object(
    'store', jsonb_build_object(
      'name', s.store_name,
      'tagline', s.tagline,
      'logo_path', s.logo_path,
      'address', s.address,
      'phone', s.phone,
      'whatsapp', s.whatsapp,
      'instagram', s.instagram,
      'timezone', s.timezone,
      'opening_hours', s.opening_hours,
      'menu_notice', s.menu_notice,
      'accepting_orders', s.accepting_orders,
      'open_now', private.store_open_now(),
      'dine_in_enabled', s.dine_in_enabled,
      'pickup_enabled', s.pickup_enabled,
      'delivery_enabled', s.delivery_enabled,
      'require_phone_pickup', s.require_phone_pickup,
      'delivery_min_order_cents', s.delivery_min_order_cents,
      'pickup_estimate_minutes', s.pickup_estimate_minutes,
      'delivery_estimate_minutes', s.delivery_estimate_minutes,
      'payment_methods', to_jsonb(s.payment_methods),
      'service_fee_enabled', s.service_fee_enabled,
      'service_fee_bp', s.service_fee_bp
    ),
    'categories', coalesce((
      select jsonb_agg(cat order by cat_sort, cat_name)
      from (
        select c.sort_order as cat_sort, c.name as cat_name,
          jsonb_build_object(
            'id', c.id,
            'name', c.name,
            'description', c.description,
            'products', (
              select jsonb_agg(jsonb_build_object(
                'id', p.id,
                'name', p.name,
                'description', p.description,
                'price_cents', p.price_cents,
                'image_path', p.image_path,
                'featured', p.featured,
                'available', p.available,
                'max_add_ons', p.max_add_ons,
                'variants', coalesce((
                  select jsonb_agg(jsonb_build_object('id', v.id, 'name', v.name, 'price_cents', v.price_cents)
                                   order by v.sort_order, v.price_cents)
                  from public.product_variants v where v.product_id = p.id and v.active
                ), '[]'::jsonb),
                'add_ons', coalesce((
                  select jsonb_agg(jsonb_build_object(
                           'id', a.id, 'name', a.name, 'price_cents', a.price_cents,
                           'max_quantity', pa.max_quantity, 'available', a.available)
                         order by a.sort_order, a.name)
                  from public.product_add_ons pa
                  join public.add_ons a on a.id = pa.add_on_id
                  where pa.product_id = p.id and a.active
                ), '[]'::jsonb)
              ) order by p.sort_order, p.name)
              from public.products p
              where p.category_id = c.id and p.active and p.visible
            )
          ) as cat
        from public.categories c
        where c.active and c.visible
          and exists (select 1 from public.products p where p.category_id = c.id and p.active and p.visible)
      ) q
    ), '[]'::jsonb),
    'delivery_zones', case when s.delivery_enabled then coalesce((
      select jsonb_agg(jsonb_build_object(
               'id', z.id, 'name', z.name, 'fee_cents', z.fee_cents,
               'min_order_cents', z.min_order_cents, 'estimate_minutes', z.estimate_minutes)
             order by z.sort_order, z.name)
      from public.delivery_zones z where z.active
    ), '[]'::jsonb) else '[]'::jsonb end
  );
end;
$$;

create or replace function public.resolve_table(p_token text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v record;
begin
  perform private.hit_rate_limit('resolve:' || coalesce(private.request_ip(), 'unknown'), 120, interval '10 minutes');
  if p_token is null or p_token !~ '^[A-Za-z0-9_-]{22,64}$' then
    raise exception using message = 'INVALID_TABLE', detail = 'QR Code inválido ou expirado. Chame um atendente.';
  end if;
  select t.label, t.area into v
  from public.table_qr_tokens q
  join public.tables t on t.id = q.table_id
  where q.token = p_token and q.active and t.active;
  if v.label is null then
    raise exception using message = 'INVALID_TABLE', detail = 'QR Code inválido ou expirado. Chame um atendente.';
  end if;
  return jsonb_build_object('label', v.label, 'area', v.area);
end;
$$;

-- Pedido feito pelo cliente (cardápio público). Nunca confia em preços, taxas ou
-- totais enviados pelo navegador. Idempotente pela chave idempotency_key.
--
-- payload: {
--   idempotency_key: uuid, channel: 'table'|'pickup'|'delivery', table_token?: text,
--   customer_name?: text, phone?: text, notes?: text, expected_total_cents?: int,
--   items: [...], delivery?: {zone_id, cep?, street, number, complement?, reference?}
-- }
create or replace function public.place_order(p_payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  s public.store_settings := private.settings();
  v_key uuid;
  v_hash text;
  v_existing record;
  v_channel text;
  v_table_id uuid;
  v_qr_id uuid;
  v_name text;
  v_phone text;
  v_notes text;
  v_priced jsonb;
  v_zone_id uuid;
  v_zone_name text;
  v_zone_min integer;
  v_fee integer := 0;
  v_total integer;
  v_expected integer;
  v_min integer;
  v_contact jsonb;
  v_status text := 'pending';
  v_order_id uuid;
  v_order public.orders;
  v_response jsonb;
  v_ip text := private.request_ip();
  v_street text;
  v_number text;
  v_cep text;
begin
  if p_payload is null or jsonb_typeof(p_payload) <> 'object' then
    raise exception using message = 'INVALID_INPUT', detail = 'Requisição inválida.';
  end if;

  -- 1) Idempotência: a mesma chave devolve o mesmo pedido (clique duplo, reenvio, falha de rede).
  v_key := private.try_uuid(p_payload ->> 'idempotency_key');
  if v_key is null then
    raise exception using message = 'INVALID_INPUT', detail = 'Chave de idempotência ausente.';
  end if;
  v_hash := md5((p_payload - 'expected_total_cents')::text);
  insert into private.idempotency_keys (scope, key, request_hash)
  values ('place_order', v_key, v_hash)
  on conflict do nothing;
  if not found then
    select * into v_existing from private.idempotency_keys where scope = 'place_order' and key = v_key;
    if v_existing.request_hash <> v_hash then
      raise exception using message = 'IDEMPOTENCY_CONFLICT',
        detail = 'Esta solicitação já foi usada para outro pedido. Recarregue a página.';
    end if;
    if v_existing.response is not null then
      return v_existing.response || jsonb_build_object('replayed', true);
    end if;
  end if;

  -- 2) Limites anti-abuso
  perform private.hit_rate_limit('order:ip:' || v_ip, s.public_order_limit_per_10min, interval '10 minutes')
    where v_ip is not null;
  perform private.hit_rate_limit('order:global', 600, interval '10 minutes');

  -- 3) Regras da loja
  v_channel := p_payload ->> 'channel';
  if v_channel is null or v_channel not in ('table', 'pickup', 'delivery') then
    raise exception using message = 'INVALID_INPUT', detail = 'Modalidade de pedido inválida.';
  end if;
  if not private.store_open_now() then
    raise exception using message = 'STORE_CLOSED', detail = 'No momento não estamos recebendo pedidos.';
  end if;
  if (v_channel = 'table' and not s.dine_in_enabled)
     or (v_channel = 'pickup' and not s.pickup_enabled)
     or (v_channel = 'delivery' and not s.delivery_enabled) then
    raise exception using message = 'CHANNEL_DISABLED', detail = 'Esta modalidade de pedido está desativada no momento.';
  end if;

  v_name := private.clean_text(p_payload ->> 'customer_name', 80, 'nome');
  v_notes := private.clean_text(p_payload ->> 'notes', 500, 'observações');
  v_phone := private.normalize_phone(p_payload ->> 'phone');

  -- 4) Modalidade
  if v_channel = 'table' then
    if coalesce(p_payload ->> 'table_token', '') !~ '^[A-Za-z0-9_-]{22,64}$' then
      raise exception using message = 'INVALID_TABLE', detail = 'QR Code inválido ou expirado. Chame um atendente.';
    end if;
    select q.id, t.id into v_qr_id, v_table_id
    from public.table_qr_tokens q
    join public.tables t on t.id = q.table_id
    where q.token = p_payload ->> 'table_token' and q.active and t.active;
    if v_table_id is null then
      raise exception using message = 'INVALID_TABLE', detail = 'QR Code inválido ou expirado. Chame um atendente.';
    end if;
    perform private.hit_rate_limit('order:qr:' || v_qr_id, 12, interval '10 minutes');
    if (select count(*) from public.orders where table_id = v_table_id and status = 'pending')
       >= s.max_pending_orders_per_table then
      raise exception using message = 'TOO_MANY_PENDING',
        detail = 'Há pedidos desta mesa aguardando confirmação. Aguarde o atendimento.';
    end if;
  else
    if char_length(v_name) < 2 then
      raise exception using message = 'INVALID_INPUT', detail = 'Informe seu nome.';
    end if;
    if v_phone is null and (v_channel = 'delivery' or s.require_phone_pickup) then
      raise exception using message = 'INVALID_PHONE', detail = 'Informe um telefone para contato.';
    end if;
    if v_phone is not null then
      perform private.hit_rate_limit('order:phone:' || v_phone, 5, interval '10 minutes');
    end if;
  end if;

  if v_channel = 'delivery' then
    select z.id, z.name, z.fee_cents, z.min_order_cents into v_zone_id, v_zone_name, v_fee, v_zone_min
    from public.delivery_zones z
    where z.id = private.try_uuid(p_payload -> 'delivery' ->> 'zone_id') and z.active;
    if v_zone_id is null then
      raise exception using message = 'ZONE_NOT_SERVED', detail = 'Ainda não entregamos neste bairro.';
    end if;
    v_street := private.clean_text(p_payload -> 'delivery' ->> 'street', 120, 'rua');
    v_number := private.clean_text(p_payload -> 'delivery' ->> 'number', 20, 'número');
    v_cep := nullif(regexp_replace(coalesce(p_payload -> 'delivery' ->> 'cep', ''), '\\D', '', 'g'), '');
    if char_length(v_street) < 3 or char_length(v_number) < 1 then
      raise exception using message = 'INVALID_ADDRESS', detail = 'Informe rua e número para entrega.';
    end if;
    if v_cep is not null and char_length(v_cep) <> 8 then
      raise exception using message = 'INVALID_ADDRESS', detail = 'CEP inválido.';
    end if;
    v_contact := jsonb_build_object(
      'phone', v_phone,
      'cep', v_cep,
      'street', v_street,
      'number', v_number,
      'complement', nullif(private.clean_text(p_payload -> 'delivery' ->> 'complement', 80, 'complemento'), ''),
      'neighborhood', v_zone_name,
      'reference', nullif(private.clean_text(p_payload -> 'delivery' ->> 'reference', 160, 'referência'), '')
    );
  elsif v_phone is not null then
    v_contact := jsonb_build_object('phone', v_phone);
  end if;

  -- 5) Preços oficiais
  v_priced := private.price_items(p_payload -> 'items', true);
  v_total := (v_priced ->> 'subtotal_cents')::integer + v_fee;

  if v_channel = 'delivery' then
    v_min := greatest(coalesce(v_zone_min, 0), s.delivery_min_order_cents);
    if (v_priced ->> 'subtotal_cents')::integer < v_min then
      raise exception using message = 'BELOW_MINIMUM',
        detail = format('Pedido mínimo para entrega: R$ %s.', to_char(v_min / 100.0, 'FM999G990D00')),
        hint = jsonb_build_object('min_order_cents', v_min)::text;
    end if;
  end if;

  -- 6) Total esperado pelo cliente: se divergir, avisa em vez de cobrar outro valor silenciosamente.
  v_expected := private.json_int(p_payload -> 'expected_total_cents');
  if v_expected is not null and v_expected <> v_total then
    raise exception using message = 'PRICE_CHANGED',
      detail = 'Os valores do cardápio foram atualizados. Revise o pedido antes de confirmar.',
      hint = jsonb_build_object('total_cents', v_total, 'lines', v_priced -> 'lines', 'delivery_fee_cents', v_fee)::text;
  end if;

  -- 7) Registro
  v_order_id := private.insert_order(jsonb_build_object(
    'channel', v_channel,
    'source', 'customer',
    'table_id', v_table_id,
    'qr_token_id', v_qr_id,
    'customer_name', v_name,
    'notes', v_notes,
    'status', 'pending',
    'priced', v_priced,
    'delivery_fee_cents', v_fee,
    'delivery_zone_id', v_zone_id,
    'idempotency_key', v_key,
    'contact', v_contact
  ));

  -- Associação automática à comanda da mesa somente se a loja permitir.
  if v_channel = 'table' and s.auto_accept_table_orders then
    perform private.accept_order_internal(v_order_id, null);
  end if;

  select * into v_order from public.orders where id = v_order_id;
  v_response := jsonb_build_object(
    'order_code', v_order.code,
    'public_token', v_order.public_token,
    'status', v_order.status,
    'total_cents', v_order.total_cents,
    'replayed', false
  );
  update private.idempotency_keys set response = v_response where scope = 'place_order' and key = v_key;

  -- limpeza oportunista
  if random() < 0.02 then
    delete from private.rate_limit_hits where created_at < now() - interval '1 day';
    delete from private.idempotency_keys where created_at < now() - interval '3 days';
  end if;

  return v_response;
end;
$$;

-- Consulta pública de status pelo token secreto do pedido (sem pagamentos/endereço/telefone).
create or replace function public.get_order_status(p_token text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_order public.orders;
  s public.store_settings := private.settings();
begin
  perform private.hit_rate_limit('status:' || coalesce(private.request_ip(), 'unknown'), 600, interval '10 minutes');
  if p_token is null or p_token !~ '^[A-Za-z0-9_-]{22,64}$' then
    raise exception using message = 'NOT_FOUND', detail = 'Pedido não encontrado.';
  end if;
  select * into v_order from public.orders where public_token = p_token;
  if v_order.id is null then
    raise exception using message = 'NOT_FOUND', detail = 'Pedido não encontrado.';
  end if;
  return jsonb_build_object(
    'code', v_order.code,
    'channel', v_order.channel,
    'status', v_order.status,
    'delivery_status', v_order.delivery_status,
    'created_at', v_order.created_at,
    'accepted_at', v_order.accepted_at,
    'ready_at', v_order.ready_at,
    'completed_at', v_order.completed_at,
    'out_for_delivery_at', v_order.out_for_delivery_at,
    'delivered_at', v_order.delivered_at,
    'cancelled_at', v_order.cancelled_at,
    'customer_first_name', split_part(v_order.customer_name, ' ', 1),
    'table_label', (select t.label from public.tables t where t.id = v_order.table_id),
    'items_subtotal_cents', v_order.items_subtotal_cents,
    'delivery_fee_cents', v_order.delivery_fee_cents,
    'total_cents', v_order.total_cents,
    'store_name', s.store_name,
    'store_phone', s.phone,
    'estimate_minutes', case v_order.channel
      when 'pickup' then s.pickup_estimate_minutes
      when 'delivery' then coalesce((select z.estimate_minutes from public.delivery_zones z where z.id = v_order.delivery_zone_id), s.delivery_estimate_minutes)
    end,
    'items', coalesce((
      select jsonb_agg(jsonb_build_object(
        'name', oi.product_name,
        'variant', oi.variant_name,
        'quantity', oi.quantity,
        'status', oi.status,
        'line_total_cents', oi.line_total_cents,
        'notes', oi.notes,
        'add_ons', coalesce((
          select jsonb_agg(jsonb_build_object('name', a.name, 'quantity', a.quantity))
          from public.order_item_add_ons a where a.order_item_id = oi.id
        ), '[]'::jsonb)
      ) order by oi.position)
      from public.order_items oi where oi.order_id = v_order.id
    ), '[]'::jsonb)
  );
end;
$$;

-- -----------------------------------------------------------------------------
-- PEDIDOS — operações da equipe
-- -----------------------------------------------------------------------------

-- Pedido lançado pela equipe (balcão, mesa, retirada, entrega ou acréscimo em comanda).
-- payload: { idempotency_key, channel, dining_tab_id?, table_id?, customer_name?, phone?, notes?,
--            items, delivery?: {zone_id, cep?, street, number, complement?, reference?} }
create or replace function public.staff_place_order(p_payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_me uuid;
  v_key uuid;
  v_existing public.orders;
  v_channel text;
  v_tab public.dining_tabs;
  v_tab_id uuid;
  v_table_id uuid;
  v_name text;
  v_notes text;
  v_phone text;
  v_priced jsonb;
  v_zone_id uuid;
  v_zone_name text;
  v_fee integer := 0;
  v_contact jsonb;
  v_has_kitchen boolean;
  v_order_id uuid;
  v_order public.orders;
begin
  perform private.require_perm('orders.create');
  v_me := private.current_staff_id();

  v_key := private.try_uuid(p_payload ->> 'idempotency_key');
  if v_key is null then
    raise exception using message = 'INVALID_INPUT', detail = 'Chave de idempotência ausente.';
  end if;
  select * into v_existing from public.orders where idempotency_key = v_key;
  if v_existing.id is not null then
    return jsonb_build_object('order_id', v_existing.id, 'order_code', v_existing.code,
                              'dining_tab_id', v_existing.dining_tab_id, 'replayed', true);
  end if;

  v_channel := p_payload ->> 'channel';
  v_name := private.clean_text(p_payload ->> 'customer_name', 80, 'nome');
  v_notes := private.clean_text(p_payload ->> 'notes', 500, 'observações');
  v_phone := private.normalize_phone(p_payload ->> 'phone');
  v_tab_id := private.try_uuid(p_payload ->> 'dining_tab_id');
  v_table_id := private.try_uuid(p_payload ->> 'table_id');

  if v_tab_id is not null then
    -- acréscimo em comanda existente
    select * into v_tab from public.dining_tabs where id = v_tab_id;
    if v_tab.id is null then
      raise exception using message = 'NOT_FOUND', detail = 'Comanda não encontrada.';
    end if;
    v_channel := case when v_tab.kind = 'table' then 'table' else 'counter' end;
    v_table_id := v_tab.table_id;
  elsif v_channel = 'table' then
    if v_table_id is null then
      raise exception using message = 'INVALID_TABLE', detail = 'Selecione a mesa.';
    end if;
    perform 1 from public.tables where id = v_table_id and active for update;
    if not found then
      raise exception using message = 'INVALID_TABLE', detail = 'Mesa inválida ou inativa.';
    end if;
    select id into v_tab_id from public.dining_tabs where table_id = v_table_id and status in ('open', 'closing');
    if v_tab_id is null then
      v_tab_id := private.open_tab_internal('table', v_table_id, '', v_name);
    end if;
  elsif v_channel in ('counter', 'pickup', 'delivery') then
    v_table_id := null;
  else
    raise exception using message = 'INVALID_INPUT', detail = 'Modalidade de pedido inválida.';
  end if;

  if v_channel = 'delivery' then
    select z.id, z.name, z.fee_cents into v_zone_id, v_zone_name, v_fee
    from public.delivery_zones z
    where z.id = private.try_uuid(p_payload -> 'delivery' ->> 'zone_id') and z.active;
    if v_zone_id is null then
      raise exception using message = 'ZONE_NOT_SERVED', detail = 'Selecione um bairro atendido.';
    end if;
    if v_phone is null then
      raise exception using message = 'INVALID_PHONE', detail = 'Informe um telefone para contato.';
    end if;
    v_contact := jsonb_build_object(
      'phone', v_phone,
      'cep', nullif(regexp_replace(coalesce(p_payload -> 'delivery' ->> 'cep', ''), '\\D', '', 'g'), ''),
      'street', private.clean_text(p_payload -> 'delivery' ->> 'street', 120, 'rua'),
      'number', private.clean_text(p_payload -> 'delivery' ->> 'number', 20, 'número'),
      'complement', nullif(private.clean_text(p_payload -> 'delivery' ->> 'complement', 80, 'complemento'), ''),
      'neighborhood', v_zone_name,
      'reference', nullif(private.clean_text(p_payload -> 'delivery' ->> 'reference', 160, 'referência'), '')
    );
    if char_length(v_contact ->> 'street') < 3 or char_length(v_contact ->> 'number') < 1 then
      raise exception using message = 'INVALID_ADDRESS', detail = 'Informe rua e número para entrega.';
    end if;
  elsif v_phone is not null then
    v_contact := jsonb_build_object('phone', v_phone);
  end if;

  if v_channel in ('pickup', 'delivery') and char_length(v_name) < 2 then
    raise exception using message = 'INVALID_INPUT', detail = 'Informe o nome do cliente.';
  end if;

  v_priced := private.price_items(p_payload -> 'items', false);

  if v_tab_id is null then
    v_tab_id := private.open_tab_internal(v_channel, null, '', v_name);
  end if;
  v_tab := private.lock_open_tab(v_tab_id);
  if v_tab.status = 'closing' then
    update public.dining_tabs set status = 'open' where id = v_tab_id;
  end if;

  select exists (select 1 from jsonb_array_elements(v_priced -> 'lines') l where (l ->> 'requires_kitchen')::boolean)
    into v_has_kitchen;

  v_order_id := private.insert_order(jsonb_build_object(
    'channel', v_channel,
    'source', 'staff',
    'table_id', v_table_id,
    'dining_tab_id', v_tab_id,
    'customer_name', v_name,
    'notes', v_notes,
    'status', case when v_has_kitchen then 'accepted' else 'ready' end,
    'priced', v_priced,
    'delivery_fee_cents', v_fee,
    'delivery_zone_id', v_zone_id,
    'idempotency_key', v_key,
    'created_by', v_me,
    'accepted_by', v_me,
    'contact', v_contact
  ));

  perform private.recalc_tab(v_tab_id);
  select * into v_order from public.orders where id = v_order_id;
  return jsonb_build_object('order_id', v_order.id, 'order_code', v_order.code,
                            'dining_tab_id', v_tab_id, 'public_token', v_order.public_token, 'replayed', false);
end;
$$;

create or replace function public.accept_order(p_order_id uuid, p_dining_tab_id uuid default null)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_tab uuid;
begin
  perform private.require_any_perm('orders.manage', 'kitchen.update');
  if p_dining_tab_id is not null then
    perform private.require_perm('tabs.transfer');
  end if;
  v_tab := private.accept_order_internal(p_order_id, p_dining_tab_id);
  perform private.audit('accept_order', 'orders', p_order_id::text, jsonb_build_object('dining_tab_id', v_tab));
  return v_tab;
end;
$$;

-- Transições de preparo/entrega ao cliente.
--   accepted -> preparing          (kitchen.update)
--   accepted|preparing -> ready    (kitchen.update)
--   ready -> completed             (orders.manage) — servido / retirado (entregas usam set_delivery_status)
create or replace function public.advance_order(p_order_id uuid, p_to text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_order public.orders;
begin
  select * into v_order from public.orders where id = p_order_id for update;
  if v_order.id is null then
    raise exception using message = 'NOT_FOUND', detail = 'Pedido não encontrado.';
  end if;

  if p_to = 'preparing' then
    perform private.require_perm('kitchen.update');
    if v_order.status <> 'accepted' then
      raise exception using message = 'INVALID_TRANSITION', detail = 'O pedido não está aguardando preparo.';
    end if;
    update public.order_items set status = 'preparing'
     where order_id = p_order_id and requires_kitchen and status = 'pending';
    perform private.sync_order_from_items(p_order_id);
  elsif p_to = 'ready' then
    perform private.require_perm('kitchen.update');
    if v_order.status not in ('accepted', 'preparing') then
      raise exception using message = 'INVALID_TRANSITION', detail = 'O pedido não está em preparo.';
    end if;
    update public.order_items set status = 'ready'
     where order_id = p_order_id and status in ('pending', 'preparing');
    perform private.sync_order_from_items(p_order_id);
  elsif p_to = 'completed' then
    perform private.require_perm('orders.manage');
    if v_order.status <> 'ready' then
      raise exception using message = 'INVALID_TRANSITION', detail = 'Somente pedidos prontos podem ser concluídos.';
    end if;
    if v_order.channel = 'delivery' then
      raise exception using message = 'INVALID_TRANSITION',
        detail = 'Pedidos de entrega são concluídos ao registrar a entrega.';
    end if;
    update public.orders set status = 'completed', completed_at = now() where id = p_order_id;
  else
    raise exception using message = 'INVALID_TRANSITION', detail = 'Transição de status inválida.';
  end if;
end;
$$;

-- Status por item (preparos independentes). O pedido fica pronto quando todos os itens de cozinha estão prontos.
create or replace function public.set_item_status(p_item_id uuid, p_to text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_item public.order_items;
  v_order public.orders;
begin
  perform private.require_perm('kitchen.update');
  select * into v_item from public.order_items where id = p_item_id;
  if v_item.id is null then
    raise exception using message = 'NOT_FOUND', detail = 'Item não encontrado.';
  end if;
  select * into v_order from public.orders where id = v_item.order_id for update;
  select * into v_item from public.order_items where id = p_item_id for update;

  if v_order.status not in ('accepted', 'preparing', 'ready')
     or coalesce(v_order.delivery_status, 'awaiting') <> 'awaiting' then
    raise exception using message = 'INVALID_TRANSITION', detail = 'Este pedido não pode mais ser alterado pela cozinha.';
  end if;
  if not v_item.requires_kitchen or v_item.status = 'cancelled' then
    raise exception using message = 'INVALID_TRANSITION', detail = 'Este item não está em preparo.';
  end if;
  if not ((v_item.status = 'pending' and p_to in ('preparing', 'ready'))
          or (v_item.status = 'preparing' and p_to in ('ready', 'pending'))
          or (v_item.status = 'ready' and p_to = 'preparing')) then
    raise exception using message = 'INVALID_TRANSITION', detail = 'Transição de status do item inválida.';
  end if;
  update public.order_items set status = p_to where id = p_item_id;
  perform private.sync_order_from_items(v_order.id);
end;
$$;

--   awaiting -> out_for_delivery (pedido pronto)
--   out_for_delivery -> delivered (conclui o pedido) | failed
--   failed -> out_for_delivery | awaiting
create or replace function public.set_delivery_status(p_order_id uuid, p_to text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_order public.orders;
begin
  perform private.require_perm('orders.manage');
  select * into v_order from public.orders where id = p_order_id for update;
  if v_order.id is null or v_order.channel <> 'delivery' then
    raise exception using message = 'NOT_FOUND', detail = 'Pedido de entrega não encontrado.';
  end if;
  if v_order.status = 'cancelled' then
    raise exception using message = 'INVALID_TRANSITION', detail = 'Pedido cancelado.';
  end if;
  if v_order.delivery_status = 'awaiting' and p_to = 'out_for_delivery' then
    if v_order.status <> 'ready' then
      raise exception using message = 'INVALID_TRANSITION',
        detail = 'O pedido só pode sair para entrega depois de pronto.';
    end if;
    update public.orders set delivery_status = p_to, out_for_delivery_at = now() where id = p_order_id;
  elsif v_order.delivery_status = 'out_for_delivery' and p_to = 'delivered' then
    update public.orders
       set delivery_status = 'delivered', delivered_at = now(), status = 'completed', completed_at = now()
     where id = p_order_id;
  elsif v_order.delivery_status = 'out_for_delivery' and p_to = 'failed' then
    update public.orders set delivery_status = 'failed' where id = p_order_id;
  elsif v_order.delivery_status = 'failed' and p_to in ('out_for_delivery', 'awaiting') then
    update public.orders
       set delivery_status = p_to,
           out_for_delivery_at = case when p_to = 'out_for_delivery' then now() else out_for_delivery_at end
     where id = p_order_id;
  else
    raise exception using message = 'INVALID_TRANSITION', detail = 'Transição de entrega inválida.';
  end if;
  perform private.audit('delivery_status', 'orders', p_order_id::text,
                        jsonb_build_object('from', v_order.delivery_status, 'to', p_to));
end;
$$;

-- Cancelamento (núcleo, sem checagem de permissão — chamado pelas funções públicas).
create or replace function private.do_cancel_order(p_order_id uuid, p_reason text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_order public.orders;
  v_me uuid := private.current_staff_id();
begin
  select * into v_order from public.orders where id = p_order_id for update;
  if v_order.id is null then
    raise exception using message = 'NOT_FOUND', detail = 'Pedido não encontrado.';
  end if;
  if v_order.status = 'cancelled' then
    raise exception using message = 'INVALID_TRANSITION', detail = 'O pedido já está cancelado.';
  end if;
  if v_order.dining_tab_id is not null then
    perform private.lock_open_tab(v_order.dining_tab_id);
  end if;
  update public.order_items
     set status = 'cancelled', cancelled_at = now(), cancelled_by = v_me, cancel_reason = p_reason
   where order_id = p_order_id and status <> 'cancelled';
  update public.orders
     set status = 'cancelled', cancelled_at = now(), cancelled_by = v_me, cancel_reason = p_reason
   where id = p_order_id;
  if v_order.dining_tab_id is not null then
    perform private.recalc_tab(v_order.dining_tab_id);
  end if;
  perform private.audit('cancel_order', 'orders', p_order_id::text,
                        jsonb_build_object('reason', p_reason, 'previous_status', v_order.status,
                                           'total_cents', v_order.total_cents));
end;
$$;

create or replace function private.do_cancel_item(p_item_id uuid, p_reason text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_item public.order_items;
  v_order public.orders;
  v_me uuid := private.current_staff_id();
  v_remaining bigint;
begin
  select * into v_item from public.order_items where id = p_item_id;
  if v_item.id is null then
    raise exception using message = 'NOT_FOUND', detail = 'Item não encontrado.';
  end if;
  select * into v_order from public.orders where id = v_item.order_id for update;
  select * into v_item from public.order_items where id = p_item_id for update;
  if v_item.status = 'cancelled' or v_order.status = 'cancelled' then
    raise exception using message = 'INVALID_TRANSITION', detail = 'O item já está cancelado.';
  end if;
  if v_order.dining_tab_id is not null then
    perform private.lock_open_tab(v_order.dining_tab_id);
  end if;

  update public.order_items
     set status = 'cancelled', cancelled_at = now(), cancelled_by = v_me, cancel_reason = p_reason
   where id = p_item_id;

  select count(*) into v_remaining from public.order_items where order_id = v_order.id and status <> 'cancelled';
  if v_remaining = 0 then
    update public.orders
       set status = 'cancelled', cancelled_at = now(), cancelled_by = v_me, cancel_reason = p_reason
     where id = v_order.id;
  else
    update public.orders
       set items_subtotal_cents = s.sub, total_cents = s.sub + delivery_fee_cents
      from (select coalesce(sum(line_total_cents), 0)::integer as sub
              from public.order_items where order_id = v_order.id and status <> 'cancelled') s
     where id = v_order.id;
    perform private.sync_order_from_items(v_order.id);
  end if;

  if v_order.dining_tab_id is not null then
    perform private.recalc_tab(v_order.dining_tab_id);
  end if;
  perform private.audit('cancel_item', 'order_items', p_item_id::text,
                        jsonb_build_object('reason', p_reason, 'order_id', v_order.id,
                                           'product', v_item.product_name, 'line_total_cents', v_item.line_total_cents));
end;
$$;

-- Cancelamento autorizado de pedido. Pedidos pendentes podem ser recusados por quem gerencia pedidos.
create or replace function public.cancel_order(p_order_id uuid, p_reason text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_status text;
  v_reason text := private.clean_text(p_reason, 300, 'motivo');
  v_me uuid;
begin
  select status into v_status from public.orders where id = p_order_id;
  if v_status = 'pending' then
    perform private.require_any_perm('orders.manage', 'orders.cancel');
  else
    perform private.require_perm('orders.cancel');
  end if;
  v_me := private.current_staff_id();
  if char_length(v_reason) < 3 then
    raise exception using message = 'REASON_REQUIRED', detail = 'Informe o motivo do cancelamento.';
  end if;
  perform private.do_cancel_order(p_order_id, v_reason);
  update public.cancellations
     set status = 'approved', resolved_by = v_me, resolved_at = now(), resolution_note = 'Executado diretamente'
   where order_id = p_order_id and status = 'requested';
  insert into public.cancellations (order_id, reason, status, requested_by, resolved_by, resolved_at)
  values (p_order_id, v_reason, 'approved', v_me, v_me, now());
end;
$$;

create or replace function public.cancel_order_item(p_item_id uuid, p_reason text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_reason text := private.clean_text(p_reason, 300, 'motivo');
  v_order_id uuid;
  v_me uuid;
begin
  perform private.require_perm('orders.cancel');
  v_me := private.current_staff_id();
  if char_length(v_reason) < 3 then
    raise exception using message = 'REASON_REQUIRED', detail = 'Informe o motivo do cancelamento.';
  end if;
  select order_id into v_order_id from public.order_items where id = p_item_id;
  perform private.do_cancel_item(p_item_id, v_reason);
  update public.cancellations
     set status = 'approved', resolved_by = v_me, resolved_at = now(), resolution_note = 'Executado diretamente'
   where order_item_id = p_item_id and status = 'requested';
  insert into public.cancellations (order_id, order_item_id, reason, status, requested_by, resolved_by, resolved_at)
  values (v_order_id, p_item_id, v_reason, 'approved', v_me, v_me, now());
end;
$$;

create or replace function public.request_cancellation(p_order_id uuid, p_item_id uuid, p_reason text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_reason text := private.clean_text(p_reason, 300, 'motivo');
  v_id uuid;
  v_status text;
begin
  perform private.require_perm('orders.manage');
  if char_length(v_reason) < 3 then
    raise exception using message = 'REASON_REQUIRED', detail = 'Informe o motivo do cancelamento.';
  end if;
  select status into v_status from public.orders where id = p_order_id;
  if v_status is null or v_status = 'cancelled' then
    raise exception using message = 'INVALID_TRANSITION', detail = 'Pedido inexistente ou já cancelado.';
  end if;
  if p_item_id is not null and not exists (
    select 1 from public.order_items where id = p_item_id and order_id = p_order_id and status <> 'cancelled'
  ) then
    raise exception using message = 'NOT_FOUND', detail = 'Item não encontrado neste pedido.';
  end if;
  begin
    insert into public.cancellations (order_id, order_item_id, reason, status, requested_by)
    values (p_order_id, p_item_id, v_reason, 'requested', private.current_staff_id())
    returning id into v_id;
  exception when unique_violation then
    raise exception using message = 'ALREADY_REQUESTED', detail = 'Já existe uma solicitação de cancelamento em aberto.';
  end;
  return v_id;
end;
$$;

create or replace function public.resolve_cancellation(p_cancellation_id uuid, p_approve boolean, p_note text default null)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v public.cancellations;
begin
  perform private.require_perm('orders.cancel');
  select * into v from public.cancellations where id = p_cancellation_id for update;
  if v.id is null or v.status <> 'requested' then
    raise exception using message = 'INVALID_TRANSITION', detail = 'Solicitação inexistente ou já resolvida.';
  end if;
  if p_approve then
    if v.order_item_id is not null then
      perform private.do_cancel_item(v.order_item_id, v.reason);
    else
      perform private.do_cancel_order(v.order_id, v.reason);
    end if;
  end if;
  update public.cancellations
     set status = case when p_approve then 'approved' else 'rejected' end,
         resolved_by = private.current_staff_id(),
         resolved_at = now(),
         resolution_note = private.clean_text(p_note, 300, 'observação')
   where id = p_cancellation_id;
end;
$$;

-- -----------------------------------------------------------------------------
-- COMANDAS
-- -----------------------------------------------------------------------------
create or replace function public.open_tab(p_kind text, p_table_id uuid, p_label text default '', p_customer_name text default '')
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id uuid;
begin
  perform private.require_perm('tabs.manage');
  perform private.current_staff_id();
  if p_kind not in ('table', 'counter') then
    raise exception using message = 'INVALID_INPUT', detail = 'Tipo de comanda inválido.';
  end if;
  if p_kind = 'table' and p_table_id is null then
    raise exception using message = 'INVALID_TABLE', detail = 'Selecione a mesa.';
  end if;
  v_id := private.open_tab_internal(
    p_kind, p_table_id,
    private.clean_text(p_label, 60, 'identificação'),
    private.clean_text(p_customer_name, 80, 'cliente'));
  perform private.audit('open_tab', 'dining_tabs', v_id::text, jsonb_build_object('table_id', p_table_id, 'kind', p_kind));
  return v_id;
end;
$$;

create or replace function public.update_tab_info(p_tab_id uuid, p_label text, p_customer_name text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform private.require_perm('tabs.manage');
  perform private.lock_open_tab(p_tab_id);
  update public.dining_tabs
     set label = private.clean_text(p_label, 60, 'identificação'),
         customer_name = private.clean_text(p_customer_name, 80, 'cliente')
   where id = p_tab_id;
end;
$$;

-- open <-> closing (conta pedida / aguardando pagamento)
create or replace function public.set_tab_status(p_tab_id uuid, p_to text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v public.dining_tabs;
begin
  perform private.require_any_perm('tabs.manage', 'payments.register');
  v := private.lock_open_tab(p_tab_id);
  if not ((v.status = 'open' and p_to = 'closing') or (v.status = 'closing' and p_to = 'open')) then
    raise exception using message = 'INVALID_TRANSITION', detail = 'Transição de comanda inválida.';
  end if;
  update public.dining_tabs set status = p_to where id = p_tab_id;
end;
$$;

create or replace function public.set_tab_service_fee(p_tab_id uuid, p_enabled boolean)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v public.dining_tabs;
begin
  perform private.require_perm('tabs.manage');
  v := private.lock_open_tab(p_tab_id);
  update public.dining_tabs
     set service_fee_enabled = p_enabled,
         service_fee_bp = case when service_fee_bp = 0 then (private.settings()).service_fee_bp else service_fee_bp end
   where id = p_tab_id;
  perform private.recalc_tab(p_tab_id);
  if (select balance_cents from public.dining_tabs where id = p_tab_id) < 0 then
    raise exception using message = 'OVERPAID', detail = 'A alteração deixaria a conta com pagamento acima do total.';
  end if;
  perform private.audit('service_fee', 'dining_tabs', p_tab_id::text, jsonb_build_object('enabled', p_enabled));
end;
$$;

create or replace function public.transfer_tab(p_tab_id uuid, p_table_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v public.dining_tabs;
begin
  perform private.require_perm('tabs.transfer');
  perform 1 from public.tables where id = p_table_id and active for update;
  if not found then
    raise exception using message = 'INVALID_TABLE', detail = 'Mesa de destino inválida.';
  end if;
  v := private.lock_open_tab(p_tab_id);
  if v.table_id = p_table_id then
    return;
  end if;
  if exists (select 1 from public.dining_tabs where table_id = p_table_id and status in ('open', 'closing')) then
    raise exception using message = 'TABLE_OCCUPIED', detail = 'A mesa de destino já possui comanda aberta.';
  end if;
  update public.dining_tabs set table_id = p_table_id, kind = 'table' where id = p_tab_id;
  perform private.audit('transfer_tab', 'dining_tabs', p_tab_id::text,
                        jsonb_build_object('from_table', v.table_id, 'to_table', p_table_id));
end;
$$;

create or replace function public.move_order(p_order_id uuid, p_target_tab_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_order public.orders;
begin
  perform private.require_perm('tabs.transfer');
  select * into v_order from public.orders where id = p_order_id for update;
  if v_order.id is null or v_order.status in ('pending', 'cancelled') or v_order.dining_tab_id is null then
    raise exception using message = 'INVALID_TRANSITION', detail = 'Somente pedidos aceitos podem ser transferidos.';
  end if;
  if v_order.dining_tab_id = p_target_tab_id then
    return;
  end if;
  -- bloqueia as duas comandas em ordem determinística
  perform private.lock_open_tab(least(v_order.dining_tab_id, p_target_tab_id));
  perform private.lock_open_tab(greatest(v_order.dining_tab_id, p_target_tab_id));
  update public.orders set dining_tab_id = p_target_tab_id where id = p_order_id;
  perform private.recalc_tab(v_order.dining_tab_id);
  perform private.recalc_tab(p_target_tab_id);
  perform private.audit('move_order', 'orders', p_order_id::text,
                        jsonb_build_object('from_tab', v_order.dining_tab_id, 'to_tab', p_target_tab_id));
end;
$$;

create or replace function public.apply_discount(p_tab_id uuid, p_kind text, p_value integer, p_reason text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v public.dining_tabs;
  v_id uuid;
  v_reason text := private.clean_text(p_reason, 200, 'motivo');
  v_limit integer := (private.settings()).manager_max_discount_bp;
begin
  perform private.require_perm('tabs.discount');
  if p_kind not in ('amount', 'percent') or p_value is null or p_value <= 0
     or (p_kind = 'percent' and p_value > 10000) then
    raise exception using message = 'INVALID_INPUT', detail = 'Desconto inválido.';
  end if;
  if char_length(v_reason) < 3 then
    raise exception using message = 'REASON_REQUIRED', detail = 'Informe o motivo do desconto.';
  end if;
  v := private.lock_open_tab(p_tab_id);
  if v.subtotal_cents = 0 then
    raise exception using message = 'INVALID_INPUT', detail = 'Não há itens para aplicar desconto.';
  end if;
  insert into public.discounts (dining_tab_id, kind, value, reason, created_by)
  values (p_tab_id, p_kind, p_value, v_reason, private.current_staff_id())
  returning id into v_id;
  perform private.recalc_tab(p_tab_id);
  select * into v from public.dining_tabs where id = p_tab_id;
  if private.current_role_key() <> 'admin'
     and v.discount_cents * 10000 > (v.subtotal_cents::bigint * v_limit) then
    raise exception using message = 'DISCOUNT_LIMIT',
      detail = format('Desconto acima do limite permitido (%s%% do subtotal). Solicite a um administrador.',
                      to_char(v_limit / 100.0, 'FM990D##'));
  end if;
  if v.balance_cents < 0 then
    raise exception using message = 'OVERPAID', detail = 'O desconto deixaria a conta com pagamento acima do total.';
  end if;
  perform private.audit('apply_discount', 'dining_tabs', p_tab_id::text,
                        jsonb_build_object('discount_id', v_id, 'kind', p_kind, 'value', p_value, 'reason', v_reason));
  return v_id;
end;
$$;

create or replace function public.void_discount(p_discount_id uuid, p_reason text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_d public.discounts;
  v_reason text := private.clean_text(p_reason, 200, 'motivo');
begin
  perform private.require_perm('tabs.discount');
  select * into v_d from public.discounts where id = p_discount_id;
  if v_d.id is null or v_d.status <> 'active' then
    raise exception using message = 'INVALID_TRANSITION', detail = 'Desconto inexistente ou já anulado.';
  end if;
  if char_length(v_reason) < 3 then
    raise exception using message = 'REASON_REQUIRED', detail = 'Informe o motivo.';
  end if;
  perform private.lock_open_tab(v_d.dining_tab_id);
  update public.discounts
     set status = 'voided', voided_at = now(), voided_by = private.current_staff_id(), void_reason = v_reason
   where id = p_discount_id;
  perform private.recalc_tab(v_d.dining_tab_id);
  perform private.audit('void_discount', 'dining_tabs', v_d.dining_tab_id::text,
                        jsonb_build_object('discount_id', p_discount_id, 'reason', v_reason));
end;
$$;

-- Finaliza a venda: somente com saldo zero, sem pedidos pendentes e sem pagamentos a conferir.
create or replace function public.close_tab(p_tab_id uuid)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v public.dining_tabs;
  v_active integer;
begin
  perform private.require_perm('payments.register');
  v := private.lock_open_tab(p_tab_id);
  perform private.recalc_tab(p_tab_id);
  select * into v from public.dining_tabs where id = p_tab_id;

  if exists (select 1 from public.orders where dining_tab_id = p_tab_id and status = 'pending') then
    raise exception using message = 'PENDING_ORDERS', detail = 'Há pedidos pendentes de aceite nesta conta.';
  end if;
  if v.pending_payment_cents > 0 then
    raise exception using message = 'PENDING_PAYMENTS', detail = 'Há pagamentos aguardando conferência.';
  end if;
  select count(*) into v_active from public.orders where dining_tab_id = p_tab_id and status <> 'cancelled';
  if v_active = 0 and v.paid_cents = 0 then
    update public.dining_tabs
       set status = 'cancelled', cancelled_at = now(), cancelled_by = private.current_staff_id(),
           cancel_reason = 'Conta sem itens'
     where id = p_tab_id;
    perform private.audit('cancel_tab', 'dining_tabs', p_tab_id::text, jsonb_build_object('reason', 'empty'));
    return 'cancelled';
  end if;
  if v.balance_cents > 0 then
    raise exception using message = 'BALANCE_DUE',
      detail = format('Ainda há saldo pendente de R$ %s.', to_char(v.balance_cents / 100.0, 'FM999G990D00')),
      hint = jsonb_build_object('balance_cents', v.balance_cents)::text;
  end if;
  if v.balance_cents < 0 then
    raise exception using message = 'OVERPAID',
      detail = 'O valor pago excede o total. Estorne a diferença antes de finalizar.',
      hint = jsonb_build_object('balance_cents', v.balance_cents)::text;
  end if;
  update public.dining_tabs
     set status = 'closed', closed_at = now(), closed_by = private.current_staff_id()
   where id = p_tab_id;
  perform private.audit('close_tab', 'dining_tabs', p_tab_id::text,
                        jsonb_build_object('total_cents', v.total_cents, 'paid_cents', v.paid_cents));
  return 'closed';
end;
$$;

-- Fluxo administrativo excepcional: encerra com saldo pendente (perda/cortesia), auditado.
create or replace function public.force_close_tab(p_tab_id uuid, p_reason text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v public.dining_tabs;
  v_reason text := private.clean_text(p_reason, 300, 'motivo');
begin
  perform private.require_perm('tabs.force_close');
  if char_length(v_reason) < 10 then
    raise exception using message = 'REASON_REQUIRED', detail = 'Descreva a justificativa (mínimo 10 caracteres).';
  end if;
  v := private.lock_open_tab(p_tab_id);
  perform private.recalc_tab(p_tab_id);
  select * into v from public.dining_tabs where id = p_tab_id;
  if exists (select 1 from public.orders where dining_tab_id = p_tab_id and status = 'pending') then
    raise exception using message = 'PENDING_ORDERS', detail = 'Há pedidos pendentes de aceite nesta conta.';
  end if;
  if v.pending_payment_cents > 0 then
    raise exception using message = 'PENDING_PAYMENTS', detail = 'Há pagamentos aguardando conferência.';
  end if;
  if v.balance_cents <= 0 then
    raise exception using message = 'INVALID_TRANSITION', detail = 'A conta não tem saldo pendente; use Finalizar venda.';
  end if;
  update public.dining_tabs
     set status = 'closed', closed_at = now(), closed_by = private.current_staff_id(),
         closed_with_balance_cents = v.balance_cents, close_note = v_reason
   where id = p_tab_id;
  perform private.audit('force_close_tab', 'dining_tabs', p_tab_id::text,
                        jsonb_build_object('balance_cents', v.balance_cents, 'reason', v_reason));
end;
$$;

create or replace function public.reopen_tab(p_tab_id uuid, p_reason text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v public.dining_tabs;
  v_reason text := private.clean_text(p_reason, 300, 'motivo');
begin
  perform private.require_perm('tabs.reopen');
  if char_length(v_reason) < 5 then
    raise exception using message = 'REASON_REQUIRED', detail = 'Informe o motivo da reabertura.';
  end if;
  select * into v from public.dining_tabs where id = p_tab_id;
  if v.id is null then
    raise exception using message = 'NOT_FOUND', detail = 'Comanda não encontrada.';
  end if;
  if v.table_id is not null then
    perform 1 from public.tables where id = v.table_id for update;
  end if;
  select * into v from public.dining_tabs where id = p_tab_id for update;
  if v.status <> 'closed' then
    raise exception using message = 'INVALID_TRANSITION', detail = 'Somente contas fechadas podem ser reabertas.';
  end if;
  if v.table_id is not null and exists (
    select 1 from public.dining_tabs where table_id = v.table_id and status in ('open', 'closing') and id <> p_tab_id
  ) then
    raise exception using message = 'TABLE_OCCUPIED', detail = 'A mesa já possui outra comanda aberta.';
  end if;
  update public.dining_tabs
     set status = 'open', closed_at = null, closed_by = null, closed_with_balance_cents = 0, close_note = null
   where id = p_tab_id;
  perform private.audit('reopen_tab', 'dining_tabs', p_tab_id::text,
                        jsonb_build_object('reason', v_reason, 'previous_closed_at', v.closed_at,
                                           'previous_closed_by', v.closed_by,
                                           'previous_closed_with_balance_cents', v.closed_with_balance_cents));
end;
$$;

create or replace function public.cancel_tab(p_tab_id uuid, p_reason text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v public.dining_tabs;
  v_reason text := private.clean_text(p_reason, 300, 'motivo');
begin
  perform private.require_perm('tabs.manage');
  if char_length(v_reason) < 3 then
    raise exception using message = 'REASON_REQUIRED', detail = 'Informe o motivo.';
  end if;
  v := private.lock_open_tab(p_tab_id);
  if exists (select 1 from public.orders where dining_tab_id = p_tab_id and status <> 'cancelled') then
    raise exception using message = 'TAB_HAS_ORDERS', detail = 'Cancele os pedidos da conta antes de cancelá-la.';
  end if;
  if exists (select 1 from public.payments where dining_tab_id = p_tab_id and status in ('pending', 'confirmed')) then
    raise exception using message = 'TAB_HAS_PAYMENTS', detail = 'Estorne os pagamentos antes de cancelar a conta.';
  end if;
  update public.dining_tabs
     set status = 'cancelled', cancelled_at = now(), cancelled_by = private.current_staff_id(), cancel_reason = v_reason
   where id = p_tab_id;
  perform private.audit('cancel_tab', 'dining_tabs', p_tab_id::text, jsonb_build_object('reason', v_reason));
end;
$$;

-- -----------------------------------------------------------------------------
-- PAGAMENTOS
-- -----------------------------------------------------------------------------
create or replace function private.my_open_cash_session()
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select id from public.cash_sessions where opened_by = auth.uid() and status = 'open';
$$;

create or replace function private.require_open_cash_session()
returns uuid
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v uuid := private.my_open_cash_session();
begin
  if v is null then
    raise exception using message = 'NO_CASH_SESSION', detail = 'Abra o seu caixa antes de registrar pagamentos.';
  end if;
  return v;
end;
$$;

-- Registra um pagamento manual. Cash sempre confirmado; Pix/cartão podem ficar pendentes até a conferência.
-- Idempotente por p_request_id. Bloqueia a comanda para impedir quitação concorrente indevida.
create or replace function public.register_payment(
  p_tab_id uuid,
  p_method text,
  p_amount_cents integer,
  p_received_cents integer default null,
  p_confirm boolean default true,
  p_external_reference text default null,
  p_request_id uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  s public.store_settings := private.settings();
  v_me uuid;
  v_session uuid;
  v_tab public.dining_tabs;
  v_existing public.payments;
  v_received integer;
  v_status text;
  v_available integer;
  v_id uuid;
  v_ref text := nullif(private.clean_text(p_external_reference, 80, 'referência'), '');
begin
  perform private.require_perm('payments.register');
  v_me := private.current_staff_id();
  if p_request_id is null then
    raise exception using message = 'INVALID_INPUT', detail = 'Identificador da operação ausente.';
  end if;
  if p_method is null or p_method not in ('cash', 'pix', 'debit', 'credit') then
    raise exception using message = 'INVALID_INPUT', detail = 'Forma de pagamento inválida.';
  end if;
  if not (p_method = any (s.payment_methods)) then
    raise exception using message = 'METHOD_DISABLED', detail = 'Forma de pagamento desativada nas configurações.';
  end if;
  if p_amount_cents is null or p_amount_cents <= 0 then
    raise exception using message = 'INVALID_AMOUNT', detail = 'Informe um valor maior que zero.';
  end if;

  v_session := private.require_open_cash_session();
  v_tab := private.lock_open_tab(p_tab_id);

  select * into v_existing from public.payments where request_id = p_request_id;
  if v_existing.id is not null then
    if v_existing.dining_tab_id <> p_tab_id or v_existing.amount_cents <> p_amount_cents or v_existing.method <> p_method then
      raise exception using message = 'IDEMPOTENCY_CONFLICT', detail = 'Operação duplicada com dados diferentes.';
    end if;
    return jsonb_build_object('payment_id', v_existing.id, 'status', v_existing.status,
                              'change_cents', v_existing.change_cents, 'replayed', true);
  end if;

  perform private.recalc_tab(p_tab_id);
  select * into v_tab from public.dining_tabs where id = p_tab_id;
  v_available := v_tab.total_cents - v_tab.paid_cents - v_tab.pending_payment_cents;
  if p_amount_cents > v_available then
    raise exception using message = 'AMOUNT_EXCEEDS_BALANCE',
      detail = format('Valor acima do saldo em aberto (R$ %s).', to_char(greatest(v_available, 0) / 100.0, 'FM999G990D00')),
      hint = jsonb_build_object('available_cents', v_available)::text;
  end if;

  if p_method = 'cash' then
    v_received := coalesce(p_received_cents, p_amount_cents);
    if v_received < p_amount_cents then
      raise exception using message = 'INSUFFICIENT_CASH', detail = 'Valor recebido menor que o valor a pagar.';
    end if;
    if v_received > p_amount_cents + 100000 then
      raise exception using message = 'INVALID_AMOUNT', detail = 'Troco acima de R$ 1.000,00. Confira o valor recebido.';
    end if;
    v_status := 'confirmed';
  else
    v_received := p_amount_cents;
    v_status := case when coalesce(p_confirm, true) then 'confirmed' else 'pending' end;
  end if;

  insert into public.payments (
    dining_tab_id, cash_session_id, method, amount_cents, received_cents, status, external_reference,
    request_id, created_by, confirmed_by, confirmed_at
  ) values (
    p_tab_id, v_session, p_method, p_amount_cents, v_received, v_status, v_ref,
    p_request_id, v_me,
    case when v_status = 'confirmed' then v_me end,
    case when v_status = 'confirmed' then now() end
  )
  returning id into v_id;

  insert into public.payment_events (payment_id, event, method, amount_cents, cash_session_id, actor_id)
  values (v_id, case when v_status = 'confirmed' then 'confirmed' else 'registered' end, p_method,
          case when v_status = 'confirmed' then p_amount_cents else 0 end, v_session, v_me);

  perform private.recalc_tab(p_tab_id);
  select * into v_tab from public.dining_tabs where id = p_tab_id;
  return jsonb_build_object(
    'payment_id', v_id,
    'status', v_status,
    'change_cents', v_received - p_amount_cents,
    'balance_cents', v_tab.balance_cents,
    'replayed', false
  );
end;
$$;

create or replace function public.confirm_payment(p_payment_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v public.payments;
  v_me uuid;
  v_session uuid;
begin
  perform private.require_perm('payments.register');
  v_me := private.current_staff_id();
  v_session := private.require_open_cash_session();
  select * into v from public.payments where id = p_payment_id;
  if v.id is null then
    raise exception using message = 'NOT_FOUND', detail = 'Pagamento não encontrado.';
  end if;
  perform private.lock_open_tab(v.dining_tab_id);
  select * into v from public.payments where id = p_payment_id for update;
  if v.status <> 'pending' then
    raise exception using message = 'INVALID_TRANSITION', detail = 'Somente pagamentos pendentes podem ser confirmados.';
  end if;
  update public.payments set status = 'confirmed', confirmed_by = v_me, confirmed_at = now() where id = p_payment_id;
  insert into public.payment_events (payment_id, event, method, amount_cents, cash_session_id, actor_id)
  values (p_payment_id, 'confirmed', v.method, v.amount_cents, v_session, v_me);
  perform private.recalc_tab(v.dining_tab_id);
end;
$$;

create or replace function public.cancel_payment(p_payment_id uuid, p_reason text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v public.payments;
  v_me uuid;
  v_reason text := private.clean_text(p_reason, 200, 'motivo');
begin
  perform private.require_perm('payments.register');
  v_me := private.current_staff_id();
  if char_length(v_reason) < 3 then
    raise exception using message = 'REASON_REQUIRED', detail = 'Informe o motivo.';
  end if;
  select * into v from public.payments where id = p_payment_id;
  if v.id is null then
    raise exception using message = 'NOT_FOUND', detail = 'Pagamento não encontrado.';
  end if;
  perform private.lock_open_tab(v.dining_tab_id);
  select * into v from public.payments where id = p_payment_id for update;
  if v.status <> 'pending' then
    raise exception using message = 'INVALID_TRANSITION',
      detail = 'Somente pagamentos pendentes podem ser cancelados. Pagamentos confirmados exigem estorno.';
  end if;
  update public.payments
     set status = 'cancelled', cancelled_by = v_me, cancelled_at = now(), status_reason = v_reason
   where id = p_payment_id;
  insert into public.payment_events (payment_id, event, method, amount_cents, cash_session_id, reason, actor_id)
  values (p_payment_id, 'cancelled', v.method, 0, private.my_open_cash_session(), v_reason, v_me);
  perform private.recalc_tab(v.dining_tab_id);
end;
$$;

-- Estorno de pagamento confirmado. A conta precisa estar aberta (reabra contas fechadas antes).
create or replace function public.refund_payment(p_payment_id uuid, p_reason text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v public.payments;
  v_me uuid;
  v_session uuid;
  v_reason text := private.clean_text(p_reason, 200, 'motivo');
begin
  perform private.require_perm('payments.refund');
  v_me := private.current_staff_id();
  if char_length(v_reason) < 5 then
    raise exception using message = 'REASON_REQUIRED', detail = 'Informe o motivo do estorno.';
  end if;
  select * into v from public.payments where id = p_payment_id;
  if v.id is null then
    raise exception using message = 'NOT_FOUND', detail = 'Pagamento não encontrado.';
  end if;
  v_session := private.my_open_cash_session();
  if v.method = 'cash' and v_session is null then
    raise exception using message = 'NO_CASH_SESSION', detail = 'Estornos em dinheiro exigem o seu caixa aberto.';
  end if;
  perform private.lock_open_tab(v.dining_tab_id);
  select * into v from public.payments where id = p_payment_id for update;
  if v.status <> 'confirmed' then
    raise exception using message = 'INVALID_TRANSITION', detail = 'Somente pagamentos confirmados podem ser estornados.';
  end if;
  update public.payments
     set status = 'refunded', refunded_by = v_me, refunded_at = now(), status_reason = v_reason
   where id = p_payment_id;
  insert into public.payment_events (payment_id, event, method, amount_cents, cash_session_id, reason, actor_id)
  values (p_payment_id, 'refunded', v.method, -v.amount_cents, v_session, v_reason, v_me);
  perform private.recalc_tab(v.dining_tab_id);
  perform private.audit('refund_payment', 'payments', p_payment_id::text,
                        jsonb_build_object('amount_cents', v.amount_cents, 'method', v.method, 'reason', v_reason));
end;
$$;

-- -----------------------------------------------------------------------------
-- CAIXA
-- -----------------------------------------------------------------------------
create or replace function private.cash_session_figures(p_session_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v public.cash_sessions;
  v_sales jsonb;
  v_refunds jsonb;
  v_mov jsonb;
  v_exp_cash bigint;
begin
  select * into v from public.cash_sessions where id = p_session_id;

  select jsonb_build_object(
           'cash', coalesce(sum(amount_cents) filter (where method = 'cash'), 0),
           'pix', coalesce(sum(amount_cents) filter (where method = 'pix'), 0),
           'debit', coalesce(sum(amount_cents) filter (where method = 'debit'), 0),
           'credit', coalesce(sum(amount_cents) filter (where method = 'credit'), 0))
    into v_sales
  from public.payment_events where cash_session_id = p_session_id and event = 'confirmed';

  select jsonb_build_object(
           'cash', coalesce(-sum(amount_cents) filter (where method = 'cash'), 0),
           'pix', coalesce(-sum(amount_cents) filter (where method = 'pix'), 0),
           'debit', coalesce(-sum(amount_cents) filter (where method = 'debit'), 0),
           'credit', coalesce(-sum(amount_cents) filter (where method = 'credit'), 0))
    into v_refunds
  from public.payment_events where cash_session_id = p_session_id and event = 'refunded';

  select jsonb_build_object(
           'supply', coalesce(sum(amount_cents) filter (where kind = 'supply'), 0),
           'withdrawal', coalesce(sum(amount_cents) filter (where kind = 'withdrawal'), 0),
           'income', coalesce(sum(amount_cents) filter (where kind = 'income'), 0),
           'expense', coalesce(sum(amount_cents) filter (where kind = 'expense'), 0))
    into v_mov
  from public.cash_movements where cash_session_id = p_session_id;

  v_exp_cash := v.opening_float_cents
              + (v_sales ->> 'cash')::bigint - (v_refunds ->> 'cash')::bigint
              + (v_mov ->> 'supply')::bigint + (v_mov ->> 'income')::bigint
              - (v_mov ->> 'withdrawal')::bigint - (v_mov ->> 'expense')::bigint;

  return jsonb_build_object(
    'session_id', v.id,
    'session_number', v.session_number,
    'status', v.status,
    'opened_by', v.opened_by,
    'opened_at', v.opened_at,
    'opening_float_cents', v.opening_float_cents,
    'sales', v_sales,
    'refunds', v_refunds,
    'movements', v_mov,
    'pending_payments', (select count(*) from public.payments where cash_session_id = p_session_id and status = 'pending'),
    'expected', jsonb_build_object(
      'cash', v_exp_cash,
      'pix', (v_sales ->> 'pix')::bigint - (v_refunds ->> 'pix')::bigint,
      'debit', (v_sales ->> 'debit')::bigint - (v_refunds ->> 'debit')::bigint,
      'credit', (v_sales ->> 'credit')::bigint - (v_refunds ->> 'credit')::bigint
    )
  );
end;
$$;

create or replace function public.get_cash_session_summary(p_session_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_owner uuid;
begin
  select opened_by into v_owner from public.cash_sessions where id = p_session_id;
  if v_owner is null then
    raise exception using message = 'NOT_FOUND', detail = 'Caixa não encontrado.';
  end if;
  if not (private.has_perm('cash.view_all') or (v_owner = auth.uid() and private.has_perm('cash.operate'))) then
    raise exception using errcode = '42501', message = 'FORBIDDEN', detail = 'Sem acesso a este caixa.';
  end if;
  return private.cash_session_figures(p_session_id);
end;
$$;

create or replace function public.open_cash_session(p_opening_float_cents integer)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id uuid;
  v_me uuid;
begin
  perform private.require_perm('cash.operate');
  v_me := private.current_staff_id();
  if p_opening_float_cents is null or p_opening_float_cents < 0 then
    raise exception using message = 'INVALID_AMOUNT', detail = 'Informe o saldo inicial (troco).';
  end if;
  begin
    insert into public.cash_sessions (opened_by, opening_float_cents)
    values (v_me, p_opening_float_cents)
    returning id into v_id;
  exception when unique_violation then
    raise exception using message = 'CASH_SESSION_ALREADY_OPEN', detail = 'Você já possui um caixa aberto.';
  end;
  perform private.audit('open_cash_session', 'cash_sessions', v_id::text,
                        jsonb_build_object('opening_float_cents', p_opening_float_cents));
  return v_id;
end;
$$;

create or replace function public.add_cash_movement(p_kind text, p_amount_cents integer, p_reason text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_session uuid;
  v_id uuid;
  v_reason text := private.clean_text(p_reason, 200, 'motivo');
  v_expected_cash bigint;
begin
  perform private.require_perm('cash.operate');
  if p_kind not in ('supply', 'withdrawal', 'income', 'expense') then
    raise exception using message = 'INVALID_INPUT', detail = 'Tipo de movimentação inválido.';
  end if;
  if p_amount_cents is null or p_amount_cents <= 0 then
    raise exception using message = 'INVALID_AMOUNT', detail = 'Informe um valor maior que zero.';
  end if;
  if char_length(v_reason) < 3 then
    raise exception using message = 'REASON_REQUIRED', detail = 'Informe a justificativa da movimentação.';
  end if;
  v_session := private.require_open_cash_session();
  perform 1 from public.cash_sessions where id = v_session for update;
  if p_kind in ('withdrawal', 'expense') then
    v_expected_cash := (private.cash_session_figures(v_session) -> 'expected' ->> 'cash')::bigint;
    if p_amount_cents > v_expected_cash then
      raise exception using message = 'INSUFFICIENT_CASH_IN_DRAWER',
        detail = 'Valor maior que o dinheiro esperado na gaveta.';
    end if;
  end if;
  insert into public.cash_movements (cash_session_id, kind, amount_cents, reason, created_by)
  values (v_session, p_kind, p_amount_cents, v_reason, private.current_staff_id())
  returning id into v_id;
  perform private.audit('cash_movement', 'cash_sessions', v_session::text,
                        jsonb_build_object('kind', p_kind, 'amount_cents', p_amount_cents, 'reason', v_reason));
  return v_id;
end;
$$;

create or replace function public.close_cash_session(
  p_session_id uuid,
  p_counted_cash_cents integer,
  p_counted_pix_cents integer,
  p_counted_debit_cents integer,
  p_counted_credit_cents integer,
  p_notes text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v public.cash_sessions;
  v_fig jsonb;
  v_notes text := nullif(private.clean_text(p_notes, 500, 'observações'), '');
  v_has_diff boolean;
begin
  select * into v from public.cash_sessions where id = p_session_id for update;
  if v.id is null then
    raise exception using message = 'NOT_FOUND', detail = 'Caixa não encontrado.';
  end if;
  if not (private.has_perm('cash.view_all') or (v.opened_by = auth.uid() and private.has_perm('cash.operate'))) then
    raise exception using errcode = '42501', message = 'FORBIDDEN', detail = 'Sem permissão para fechar este caixa.';
  end if;
  if v.status <> 'open' then
    raise exception using message = 'INVALID_TRANSITION', detail = 'Este caixa já está fechado.';
  end if;
  if p_counted_cash_cents is null or p_counted_cash_cents < 0
     or coalesce(p_counted_pix_cents, 0) < 0 or coalesce(p_counted_debit_cents, 0) < 0
     or coalesce(p_counted_credit_cents, 0) < 0 then
    raise exception using message = 'INVALID_AMOUNT', detail = 'Informe os valores conferidos.';
  end if;
  v_fig := private.cash_session_figures(p_session_id);
  if (v_fig ->> 'pending_payments')::integer > 0 then
    raise exception using message = 'PENDING_PAYMENTS',
      detail = 'Há pagamentos pendentes de conferência registrados neste caixa.';
  end if;
  v_has_diff := p_counted_cash_cents <> (v_fig -> 'expected' ->> 'cash')::bigint
             or coalesce(p_counted_pix_cents, 0) <> (v_fig -> 'expected' ->> 'pix')::bigint
             or coalesce(p_counted_debit_cents, 0) <> (v_fig -> 'expected' ->> 'debit')::bigint
             or coalesce(p_counted_credit_cents, 0) <> (v_fig -> 'expected' ->> 'credit')::bigint;
  if v_has_diff and (v_notes is null or char_length(v_notes) < 5) then
    raise exception using message = 'NOTES_REQUIRED',
      detail = 'Há diferença entre o esperado e o conferido. Registre uma justificativa.',
      hint = (v_fig -> 'expected')::text;
  end if;
  update public.cash_sessions
     set status = 'closed',
         closed_at = now(),
         closed_by = private.current_staff_id(),
         expected_cash_cents = (v_fig -> 'expected' ->> 'cash')::integer,
         expected_pix_cents = (v_fig -> 'expected' ->> 'pix')::integer,
         expected_debit_cents = (v_fig -> 'expected' ->> 'debit')::integer,
         expected_credit_cents = (v_fig -> 'expected' ->> 'credit')::integer,
         counted_cash_cents = p_counted_cash_cents,
         counted_pix_cents = coalesce(p_counted_pix_cents, 0),
         counted_debit_cents = coalesce(p_counted_debit_cents, 0),
         counted_credit_cents = coalesce(p_counted_credit_cents, 0),
         closing_notes = v_notes
   where id = p_session_id;
  perform private.audit('close_cash_session', 'cash_sessions', p_session_id::text,
                        jsonb_build_object('expected', v_fig -> 'expected', 'notes', v_notes));
  return v_fig;
end;
$$;

-- -----------------------------------------------------------------------------
-- Cardápio — disponibilidade rápida (cozinha/atendimento)
-- -----------------------------------------------------------------------------
create or replace function public.set_product_availability(p_product_id uuid, p_available boolean)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform private.require_perm('menu.availability');
  update public.products set available = p_available where id = p_product_id and active;
  if not found then
    raise exception using message = 'NOT_FOUND', detail = 'Produto não encontrado.';
  end if;
end;
$$;

create or replace function public.set_add_on_availability(p_add_on_id uuid, p_available boolean)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform private.require_perm('menu.availability');
  update public.add_ons set available = p_available where id = p_add_on_id and active;
  if not found then
    raise exception using message = 'NOT_FOUND', detail = 'Adicional não encontrado.';
  end if;
end;
$$;

-- -----------------------------------------------------------------------------
-- Manutenção / LGPD
-- -----------------------------------------------------------------------------
-- Remove telefone/endereço de pedidos antigos (política de retenção configurável).
create or replace function private.purge_customer_data()
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_days integer := (private.settings()).pii_retention_days;
  v_count integer;
begin
  update public.order_contacts c
     set phone = null, cep = null, street = null, number = null, complement = null, reference = null,
         purged_at = now()
    from public.orders o
   where o.id = c.order_id and c.purged_at is null
     and o.created_at < now() - make_interval(days => v_days);
  get diagnostics v_count = row_count;
  delete from private.rate_limit_hits where created_at < now() - interval '1 day';
  delete from private.idempotency_keys where created_at < now() - interval '3 days';
  return v_count;
end;
$$;

create or replace function public.run_maintenance()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v integer;
begin
  perform private.require_perm('settings.manage');
  v := private.purge_customer_data();
  perform private.audit('maintenance', 'system', null, jsonb_build_object('contacts_purged', v));
  return jsonb_build_object('contacts_purged', v);
end;
$$;

-- Remove dados de demonstração (is_demo). Registros já usados em pedidos são apenas inativados.
create or replace function public.remove_demo_data()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_products integer;
  v_inactivated integer;
begin
  perform private.require_perm('settings.manage');

  update public.products p set active = false, visible = false
   where p.is_demo and exists (select 1 from public.order_items oi where oi.product_id = p.id);
  get diagnostics v_inactivated = row_count;

  delete from public.product_add_ons pa using public.products p
   where pa.product_id = p.id and p.is_demo
     and not exists (select 1 from public.order_items oi where oi.product_id = p.id);
  delete from public.product_variants v using public.products p
   where v.product_id = p.id and p.is_demo
     and not exists (select 1 from public.order_items oi where oi.product_id = p.id);
  delete from public.products p
   where p.is_demo and not exists (select 1 from public.order_items oi where oi.product_id = p.id);
  get diagnostics v_products = row_count;

  delete from public.product_add_ons pa using public.add_ons a
   where pa.add_on_id = a.id and a.is_demo
     and not exists (select 1 from public.order_item_add_ons x where x.add_on_id = a.id);
  update public.add_ons a set active = false
   where a.is_demo and exists (select 1 from public.order_item_add_ons x where x.add_on_id = a.id);
  delete from public.add_ons a
   where a.is_demo and not exists (select 1 from public.order_item_add_ons x where x.add_on_id = a.id);

  update public.categories c set active = false, visible = false
   where c.is_demo and exists (select 1 from public.products p where p.category_id = c.id);
  delete from public.categories c
   where c.is_demo and not exists (select 1 from public.products p where p.category_id = c.id);

  perform private.audit('remove_demo_data', 'system', null,
                        jsonb_build_object('products_deleted', v_products, 'products_inactivated', v_inactivated));
  return jsonb_build_object('products_deleted', v_products, 'products_inactivated', v_inactivated);
end;
$$;
`,c=`-- =============================================================================
-- Espeteks — 0004: Row Level Security e privilégios
--
-- Princípios:
--   * RLS habilitado em TODAS as tabelas do schema public.
--   * anon NÃO tem acesso a nenhuma tabela: o público usa somente as RPCs
--     get_public_menu, resolve_table, place_order e get_order_status.
--   * authenticated só lê o que o cargo permite; escritas operacionais/financeiras
--     acontecem apenas via RPC (sem GRANT de insert/update/delete nessas tabelas).
--   * Cadastros (cardápio, mesas, bairros, configurações) podem ser editados
--     diretamente, mas apenas por quem tem a permissão — validado pela política.
-- =============================================================================

create or replace function private.has_any_perm(variadic p_perms text[])
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (select 1 from unnest(p_perms) p where private.has_perm(p));
$$;

-- -----------------------------------------------------------------------------
-- Habilita RLS
-- -----------------------------------------------------------------------------
alter table public.roles enable row level security;
alter table public.permissions enable row level security;
alter table public.role_permissions enable row level security;
alter table public.profiles enable row level security;
alter table public.store_settings enable row level security;
alter table public.categories enable row level security;
alter table public.products enable row level security;
alter table public.product_costs enable row level security;
alter table public.product_variants enable row level security;
alter table public.add_ons enable row level security;
alter table public.product_add_ons enable row level security;
alter table public.tables enable row level security;
alter table public.table_qr_tokens enable row level security;
alter table public.delivery_zones enable row level security;
alter table public.cash_sessions enable row level security;
alter table public.cash_movements enable row level security;
alter table public.dining_tabs enable row level security;
alter table public.discounts enable row level security;
alter table public.orders enable row level security;
alter table public.order_contacts enable row level security;
alter table public.order_items enable row level security;
alter table public.order_item_add_ons enable row level security;
alter table public.order_status_history enable row level security;
alter table public.order_item_status_history enable row level security;
alter table public.cancellations enable row level security;
alter table public.payments enable row level security;
alter table public.payment_events enable row level security;
alter table public.audit_logs enable row level security;

-- -----------------------------------------------------------------------------
-- Equipe, cargos e permissões
-- -----------------------------------------------------------------------------
create policy "roles: equipe lê" on public.roles
  for select to authenticated using ((select private.is_staff()));

create policy "permissions: equipe lê" on public.permissions
  for select to authenticated using ((select private.is_staff()));

create policy "role_permissions: equipe lê" on public.role_permissions
  for select to authenticated using ((select private.is_staff()));

create policy "profiles: próprio perfil ou equipe" on public.profiles
  for select to authenticated
  using (id = (select auth.uid()) or (select private.is_staff()));

-- -----------------------------------------------------------------------------
-- Configurações
-- -----------------------------------------------------------------------------
create policy "store_settings: equipe lê" on public.store_settings
  for select to authenticated using ((select private.is_staff()));

create policy "store_settings: admin altera" on public.store_settings
  for update to authenticated
  using ((select private.has_perm('settings.manage')))
  with check ((select private.has_perm('settings.manage')));

-- -----------------------------------------------------------------------------
-- Cardápio
-- -----------------------------------------------------------------------------
create policy "categories: equipe lê" on public.categories
  for select to authenticated using ((select private.is_staff()));
create policy "categories: cardápio insere" on public.categories
  for insert to authenticated with check ((select private.has_perm('menu.manage')));
create policy "categories: cardápio altera" on public.categories
  for update to authenticated
  using ((select private.has_perm('menu.manage')))
  with check ((select private.has_perm('menu.manage')));

create policy "products: equipe lê" on public.products
  for select to authenticated using ((select private.is_staff()));
create policy "products: cardápio insere" on public.products
  for insert to authenticated with check ((select private.has_perm('menu.manage')));
create policy "products: cardápio altera" on public.products
  for update to authenticated
  using ((select private.has_perm('menu.manage')))
  with check ((select private.has_perm('menu.manage')));

create policy "product_costs: gestão lê" on public.product_costs
  for select to authenticated using ((select private.has_any_perm('menu.manage', 'reports.view')));
create policy "product_costs: cardápio insere" on public.product_costs
  for insert to authenticated with check ((select private.has_perm('menu.manage')));
create policy "product_costs: cardápio altera" on public.product_costs
  for update to authenticated
  using ((select private.has_perm('menu.manage')))
  with check ((select private.has_perm('menu.manage')));
create policy "product_costs: cardápio remove" on public.product_costs
  for delete to authenticated using ((select private.has_perm('menu.manage')));

create policy "product_variants: equipe lê" on public.product_variants
  for select to authenticated using ((select private.is_staff()));
create policy "product_variants: cardápio insere" on public.product_variants
  for insert to authenticated with check ((select private.has_perm('menu.manage')));
create policy "product_variants: cardápio altera" on public.product_variants
  for update to authenticated
  using ((select private.has_perm('menu.manage')))
  with check ((select private.has_perm('menu.manage')));

create policy "add_ons: equipe lê" on public.add_ons
  for select to authenticated using ((select private.is_staff()));
create policy "add_ons: cardápio insere" on public.add_ons
  for insert to authenticated with check ((select private.has_perm('menu.manage')));
create policy "add_ons: cardápio altera" on public.add_ons
  for update to authenticated
  using ((select private.has_perm('menu.manage')))
  with check ((select private.has_perm('menu.manage')));

create policy "product_add_ons: equipe lê" on public.product_add_ons
  for select to authenticated using ((select private.is_staff()));
create policy "product_add_ons: cardápio insere" on public.product_add_ons
  for insert to authenticated with check ((select private.has_perm('menu.manage')));
create policy "product_add_ons: cardápio altera" on public.product_add_ons
  for update to authenticated
  using ((select private.has_perm('menu.manage')))
  with check ((select private.has_perm('menu.manage')));
create policy "product_add_ons: cardápio remove" on public.product_add_ons
  for delete to authenticated using ((select private.has_perm('menu.manage')));

-- -----------------------------------------------------------------------------
-- Mesas, QR Codes, entregas
-- -----------------------------------------------------------------------------
create policy "tables: equipe lê" on public.tables
  for select to authenticated using ((select private.is_staff()));
create policy "tables: gestão insere" on public.tables
  for insert to authenticated with check ((select private.has_perm('tables.manage')));
create policy "tables: gestão altera" on public.tables
  for update to authenticated
  using ((select private.has_perm('tables.manage')))
  with check ((select private.has_perm('tables.manage')));

-- Tokens de QR: somente quem administra mesas (impressão/regeneração).
create policy "table_qr_tokens: gestão de mesas lê" on public.table_qr_tokens
  for select to authenticated using ((select private.has_perm('tables.manage')));

create policy "delivery_zones: equipe lê" on public.delivery_zones
  for select to authenticated using ((select private.is_staff()));
create policy "delivery_zones: gestão insere" on public.delivery_zones
  for insert to authenticated with check ((select private.has_perm('delivery.manage')));
create policy "delivery_zones: gestão altera" on public.delivery_zones
  for update to authenticated
  using ((select private.has_perm('delivery.manage')))
  with check ((select private.has_perm('delivery.manage')));

-- -----------------------------------------------------------------------------
-- Pedidos (somente leitura direta; escrita via RPC)
-- -----------------------------------------------------------------------------
create policy "orders: operação lê" on public.orders
  for select to authenticated
  using ((select private.has_any_perm('orders.view', 'kitchen.view', 'tabs.view', 'payments.register', 'reports.view')));

create policy "order_items: operação lê" on public.order_items
  for select to authenticated
  using ((select private.has_any_perm('orders.view', 'kitchen.view', 'tabs.view', 'payments.register', 'reports.view')));

create policy "order_item_add_ons: operação lê" on public.order_item_add_ons
  for select to authenticated
  using ((select private.has_any_perm('orders.view', 'kitchen.view', 'tabs.view', 'payments.register', 'reports.view')));

create policy "order_status_history: operação lê" on public.order_status_history
  for select to authenticated
  using ((select private.has_any_perm('orders.view', 'kitchen.view', 'audit.view')));

create policy "order_item_status_history: operação lê" on public.order_item_status_history
  for select to authenticated
  using ((select private.has_any_perm('orders.view', 'kitchen.view', 'audit.view')));

-- Telefone/endereço: somente quem precisa para executar o serviço.
create policy "order_contacts: autorizados leem" on public.order_contacts
  for select to authenticated using ((select private.has_perm('customers.view_contact')));

create policy "cancellations: operação lê" on public.cancellations
  for select to authenticated
  using ((select private.has_any_perm('orders.view', 'orders.cancel', 'audit.view')));

-- -----------------------------------------------------------------------------
-- Comandas, descontos, pagamentos, caixa
-- -----------------------------------------------------------------------------
create policy "dining_tabs: operação lê" on public.dining_tabs
  for select to authenticated
  using ((select private.has_any_perm('tabs.view', 'payments.register', 'orders.view', 'reports.view')));

create policy "discounts: operação lê" on public.discounts
  for select to authenticated
  using ((select private.has_any_perm('tabs.view', 'payments.register', 'reports.view')));

create policy "payments: financeiro lê" on public.payments
  for select to authenticated
  using ((select private.has_any_perm('payments.register', 'cash.view_all', 'reports.view')));

create policy "payment_events: financeiro lê" on public.payment_events
  for select to authenticated
  using ((select private.has_any_perm('payments.register', 'cash.view_all', 'reports.view')));

create policy "cash_sessions: próprio caixa ou supervisão" on public.cash_sessions
  for select to authenticated
  using (
    (opened_by = (select auth.uid()) and (select private.has_perm('cash.operate')))
    or (select private.has_any_perm('cash.view_all', 'reports.view'))
  );

create policy "cash_movements: próprio caixa ou supervisão" on public.cash_movements
  for select to authenticated
  using (
    (select private.has_any_perm('cash.view_all', 'reports.view'))
    or (
      (select private.has_perm('cash.operate'))
      and exists (
        select 1 from public.cash_sessions s
        where s.id = cash_session_id and s.opened_by = (select auth.uid())
      )
    )
  );

create policy "audit_logs: auditoria lê" on public.audit_logs
  for select to authenticated using ((select private.has_perm('audit.view')));

-- -----------------------------------------------------------------------------
-- Privilégios de tabela (defesa em profundidade além do RLS)
-- -----------------------------------------------------------------------------
revoke all on all tables in schema public from anon, authenticated;
revoke all on all tables in schema private from public, anon, authenticated;
revoke all on all sequences in schema public from anon, authenticated;

grant select on all tables in schema public to authenticated;

grant insert on
  public.categories,
  public.products,
  public.product_variants,
  public.add_ons,
  public.tables,
  public.delivery_zones
to authenticated;
grant insert, update, delete on public.product_add_ons to authenticated;
grant insert, delete on public.product_costs to authenticated;
grant update (cost_cents) on public.product_costs to authenticated;

-- UPDATE somente nas colunas editáveis (ids, datas de controle e flags de demo ficam protegidos).
grant update (name, description, sort_order, visible, active) on public.categories to authenticated;
grant update (category_id, name, description, price_cents, image_path, featured, available, visible, active,
              requires_kitchen, max_add_ons, sort_order) on public.products to authenticated;
grant update (name, price_cents, active, sort_order) on public.product_variants to authenticated;
grant update (name, price_cents, active, available, sort_order) on public.add_ons to authenticated;
grant update (label, area, seats, active, sort_order) on public.tables to authenticated;
grant update (name, fee_cents, min_order_cents, estimate_minutes, active, sort_order) on public.delivery_zones to authenticated;
grant update (store_name, tagline, logo_path, address, phone, whatsapp, instagram, timezone, opening_hours,
              enforce_opening_hours, accepting_orders, menu_notice, dine_in_enabled, pickup_enabled,
              delivery_enabled, require_phone_pickup, delivery_min_order_cents, pickup_estimate_minutes,
              delivery_estimate_minutes, auto_accept_table_orders, max_pending_orders_per_table,
              public_order_limit_per_10min, service_fee_enabled, service_fee_bp, manager_max_discount_bp,
              payment_methods, late_order_minutes, print_paper_width_mm, print_header, print_footer,
              pii_retention_days) on public.store_settings to authenticated;

grant all on all tables in schema public to service_role;
grant usage, select on all sequences in schema public to service_role;

-- -----------------------------------------------------------------------------
-- Privilégios de funções
-- -----------------------------------------------------------------------------
revoke execute on all functions in schema public from public, anon, authenticated;
revoke execute on all functions in schema private from public, anon, authenticated;

-- Helpers usados nas políticas RLS (executados no contexto do usuário).
grant usage on schema private to authenticated;
grant execute on function private.is_staff() to authenticated;
grant execute on function private.has_perm(text) to authenticated;
grant execute on function private.has_any_perm(text[]) to authenticated;
-- Usada em CHECK constraint de store_settings (avaliada no contexto de quem altera).
grant execute on function private.valid_opening_hours(jsonb) to authenticated;

-- API pública (cliente sem login)
grant execute on function public.get_public_menu() to anon, authenticated;
grant execute on function public.resolve_table(text) to anon, authenticated;
grant execute on function public.place_order(jsonb) to anon, authenticated;
grant execute on function public.get_order_status(text) to anon, authenticated;

-- API da equipe (cada função valida a permissão internamente)
grant execute on function public.my_access() to authenticated;
grant execute on function public.set_staff_access(uuid, text, boolean, text) to authenticated;
grant execute on function public.set_role_permissions(text, text[]) to authenticated;
grant execute on function public.regenerate_table_qr(uuid) to authenticated;
grant execute on function public.revoke_table_qr(uuid) to authenticated;
grant execute on function public.staff_place_order(jsonb) to authenticated;
grant execute on function public.accept_order(uuid, uuid) to authenticated;
grant execute on function public.advance_order(uuid, text) to authenticated;
grant execute on function public.set_item_status(uuid, text) to authenticated;
grant execute on function public.set_delivery_status(uuid, text) to authenticated;
grant execute on function public.cancel_order(uuid, text) to authenticated;
grant execute on function public.cancel_order_item(uuid, text) to authenticated;
grant execute on function public.request_cancellation(uuid, uuid, text) to authenticated;
grant execute on function public.resolve_cancellation(uuid, boolean, text) to authenticated;
grant execute on function public.open_tab(text, uuid, text, text) to authenticated;
grant execute on function public.update_tab_info(uuid, text, text) to authenticated;
grant execute on function public.set_tab_status(uuid, text) to authenticated;
grant execute on function public.set_tab_service_fee(uuid, boolean) to authenticated;
grant execute on function public.transfer_tab(uuid, uuid) to authenticated;
grant execute on function public.move_order(uuid, uuid) to authenticated;
grant execute on function public.apply_discount(uuid, text, integer, text) to authenticated;
grant execute on function public.void_discount(uuid, text) to authenticated;
grant execute on function public.close_tab(uuid) to authenticated;
grant execute on function public.force_close_tab(uuid, text) to authenticated;
grant execute on function public.reopen_tab(uuid, text) to authenticated;
grant execute on function public.cancel_tab(uuid, text) to authenticated;
grant execute on function public.register_payment(uuid, text, integer, integer, boolean, text, uuid) to authenticated;
grant execute on function public.confirm_payment(uuid) to authenticated;
grant execute on function public.cancel_payment(uuid, text) to authenticated;
grant execute on function public.refund_payment(uuid, text) to authenticated;
grant execute on function public.get_cash_session_summary(uuid) to authenticated;
grant execute on function public.open_cash_session(integer) to authenticated;
grant execute on function public.add_cash_movement(text, integer, text) to authenticated;
grant execute on function public.close_cash_session(uuid, integer, integer, integer, integer, text) to authenticated;
grant execute on function public.set_product_availability(uuid, boolean) to authenticated;
grant execute on function public.set_add_on_availability(uuid, boolean) to authenticated;
grant execute on function public.run_maintenance() to authenticated;
grant execute on function public.remove_demo_data() to authenticated;

-- Novas funções criadas no futuro não ficam executáveis por padrão.
alter default privileges in schema public revoke execute on functions from public;
alter default privileges in schema public revoke execute on functions from anon, authenticated;
`,l=`-- =============================================================================
-- Espeteks — 0005: Realtime e Storage
--
-- Realtime (postgres_changes): o Supabase aplica as políticas RLS de SELECT a cada
-- assinante autenticado. Assim, a cozinha recebe eventos de pedidos, mas nunca de
-- pagamentos. anon não lê nenhuma tabela, logo não recebe eventos.
-- O cliente público acompanha o pedido por get_order_status (polling), sem canal público.
-- =============================================================================

do $$
begin
  if not exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    create publication supabase_realtime;
  end if;
end;
$$;

alter publication supabase_realtime add table
  public.orders,
  public.order_items,
  public.dining_tabs,
  public.payments,
  public.cancellations,
  public.tables,
  public.products,
  public.add_ons,
  public.cash_sessions;

-- -----------------------------------------------------------------------------
-- Storage: imagens de produtos e logo.
-- Bucket público para leitura (as imagens aparecem no cardápio público);
-- escrita restrita a quem gerencia o cardápio/configurações, apenas em pastas conhecidas.
-- -----------------------------------------------------------------------------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('menu-images', 'menu-images', true, 5242880, array['image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do update
  set public = excluded.public,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

create policy "menu-images: cardápio envia produtos" on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'menu-images'
    and (storage.foldername(name))[1] = 'products'
    and (select private.has_perm('menu.manage'))
  );

create policy "menu-images: configurações envia logo" on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'menu-images'
    and (storage.foldername(name))[1] = 'branding'
    and (select private.has_perm('settings.manage'))
  );

create policy "menu-images: gestão lista" on storage.objects
  for select to authenticated
  using (
    bucket_id = 'menu-images'
    and (select private.has_any_perm('menu.manage', 'settings.manage'))
  );

create policy "menu-images: gestão atualiza" on storage.objects
  for update to authenticated
  using (
    bucket_id = 'menu-images'
    and (
      ((storage.foldername(name))[1] = 'products' and (select private.has_perm('menu.manage')))
      or ((storage.foldername(name))[1] = 'branding' and (select private.has_perm('settings.manage')))
    )
  );

create policy "menu-images: gestão remove" on storage.objects
  for delete to authenticated
  using (
    bucket_id = 'menu-images'
    and (
      ((storage.foldername(name))[1] = 'products' and (select private.has_perm('menu.manage')))
      or ((storage.foldername(name))[1] = 'branding' and (select private.has_perm('settings.manage')))
    )
  );
`,u=`-- =============================================================================
-- Espeteks — 0006: relatórios
--
-- Metodologia (também documentada em docs/RELATORIOS.md):
--   * Venda concluída       = conta (dining_tab) com status 'closed' e closed_at no período.
--   * Faturamento bruto     = soma de total_cents das vendas concluídas (itens + taxa de serviço
--                             + taxa de entrega − descontos). NÃO é lucro.
--   * Total recebido        = soma dos eventos financeiros no período: confirmações (+) e estornos (−).
--   * Pendentes             = pagamentos registrados e ainda não conferidos (status 'pending').
--   * Em aberto             = saldo atual das contas abertas/aguardando pagamento.
--   * Cancelados            = itens cancelados (de pedidos criados no período) + taxas de entrega
--                             de pedidos cancelados. Nunca entram em "recebido".
--   * Margem bruta estimada = receita dos itens com custo cadastrado − custo × quantidade.
--                             Custos de adicionais não são considerados. Exibida com a cobertura.
-- Filtros (p_filters): channel, staff_id, product_id, method.
-- =============================================================================

create or replace function private.report_headline(p_from timestamptz, p_to timestamptz, p_filters jsonb)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_channel text := nullif(p_filters ->> 'channel', '');
  v_staff uuid := private.try_uuid(p_filters ->> 'staff_id');
  v_method text := nullif(p_filters ->> 'method', '');
  v_closed integer;
  v_gross bigint;
  v_discounts bigint;
  v_service bigint;
  v_received bigint;
begin
  select count(*), coalesce(sum(total_cents), 0), coalesce(sum(discount_cents), 0), coalesce(sum(service_fee_cents), 0)
    into v_closed, v_gross, v_discounts, v_service
  from public.dining_tabs t
  where t.status = 'closed' and t.closed_at >= p_from and t.closed_at < p_to
    and (v_channel is null or t.kind = v_channel)
    and (v_staff is null or t.closed_by = v_staff);

  select coalesce(sum(e.amount_cents), 0) into v_received
  from public.payment_events e
  join public.payments p on p.id = e.payment_id
  join public.dining_tabs t on t.id = p.dining_tab_id
  where e.event in ('confirmed', 'refunded') and e.created_at >= p_from and e.created_at < p_to
    and (v_method is null or e.method = v_method)
    and (v_staff is null or e.actor_id = v_staff)
    and (v_channel is null or t.kind = v_channel);

  return jsonb_build_object(
    'sales_count', v_closed,
    'gross_cents', v_gross,
    'received_cents', v_received,
    'discounts_cents', v_discounts,
    'service_fee_cents', v_service,
    'avg_ticket_cents', case when v_closed > 0 then round(v_gross::numeric / v_closed) else 0 end
  );
end;
$$;

create or replace function public.report_overview(p_from timestamptz, p_to timestamptz, p_filters jsonb default '{}'::jsonb)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  s public.store_settings := private.settings();
  v_filters jsonb := coalesce(p_filters, '{}'::jsonb);
  v_channel text := nullif(v_filters ->> 'channel', '');
  v_staff uuid := private.try_uuid(v_filters ->> 'staff_id');
  v_product uuid := private.try_uuid(v_filters ->> 'product_id');
  v_method text := nullif(v_filters ->> 'method', '');
  v_span interval;
  v_result jsonb;
begin
  perform private.require_perm('reports.view');
  if p_from is null or p_to is null or p_to <= p_from then
    raise exception using message = 'INVALID_INPUT', detail = 'Período inválido.';
  end if;
  if p_to - p_from > interval '400 days' then
    raise exception using message = 'INVALID_INPUT', detail = 'Período máximo de 400 dias.';
  end if;
  v_span := p_to - p_from;

  with
  sold_items as (
    select oi.*, o.channel, o.created_by as order_created_by, o.accepted_by as order_accepted_by
    from public.order_items oi
    join public.orders o on o.id = oi.order_id
    where o.created_at >= p_from and o.created_at < p_to
      and o.status not in ('pending', 'cancelled') and oi.status <> 'cancelled'
      and (v_channel is null or o.channel = v_channel)
      and (v_product is null or oi.product_id = v_product)
      and (v_staff is null or o.created_by = v_staff or o.accepted_by = v_staff)
  ),
  period_orders as (
    select o.*
    from public.orders o
    where o.created_at >= p_from and o.created_at < p_to
      and (v_channel is null or o.channel = v_channel)
  ),
  received as (
    select e.*, p.created_by as payment_created_by
    from public.payment_events e
    join public.payments p on p.id = e.payment_id
    join public.dining_tabs t on t.id = p.dining_tab_id
    where e.event in ('confirmed', 'refunded') and e.created_at >= p_from and e.created_at < p_to
      and (v_method is null or e.method = v_method)
      and (v_staff is null or e.actor_id = v_staff)
      and (v_channel is null or t.kind = v_channel)
  ),
  closed_tabs as (
    select t.*
    from public.dining_tabs t
    where t.status = 'closed' and t.closed_at >= p_from and t.closed_at < p_to
      and (v_channel is null or t.kind = v_channel)
      and (v_staff is null or t.closed_by = v_staff)
  )
  select jsonb_build_object(
    'period', jsonb_build_object('from', p_from, 'to', p_to),
    'headline', private.report_headline(p_from, p_to, v_filters),
    'previous', private.report_headline(p_from - v_span, p_from, v_filters),
    'pending_payments', (
      select jsonb_build_object('count', count(*), 'amount_cents', coalesce(sum(amount_cents), 0))
      from public.payments where status = 'pending'
    ),
    'open_tabs', (
      select jsonb_build_object('count', count(*), 'balance_cents', coalesce(sum(balance_cents), 0),
                                'total_cents', coalesce(sum(total_cents), 0))
      from public.dining_tabs where status in ('open', 'closing')
    ),
    'closed_with_balance', (
      select jsonb_build_object('count', count(*), 'amount_cents', coalesce(sum(closed_with_balance_cents), 0))
      from closed_tabs where closed_with_balance_cents > 0
    ),
    'by_method', coalesce((
      select jsonb_agg(jsonb_build_object('method', method, 'received_cents', total, 'refunded_cents', refunded) order by total desc)
      from (
        select method,
               sum(amount_cents) as total,
               -coalesce(sum(amount_cents) filter (where event = 'refunded'), 0) as refunded
        from received group by method
      ) x
    ), '[]'::jsonb),
    'refunds', (
      select jsonb_build_object('count', count(*), 'amount_cents', coalesce(-sum(amount_cents), 0))
      from received where event = 'refunded'
    ),
    'top_products', coalesce((
      select jsonb_agg(x order by (x ->> 'quantity')::integer desc, (x ->> 'revenue_cents')::bigint desc)
      from (
        select jsonb_build_object('product_id', product_id, 'name', max(product_name),
                                  'quantity', sum(quantity), 'revenue_cents', sum(line_total_cents)) as x
        from sold_items group by product_id
        order by sum(quantity) desc, sum(line_total_cents) desc
        limit 15
      ) q
    ), '[]'::jsonb),
    'by_category', coalesce((
      select jsonb_agg(jsonb_build_object('category', category_name, 'quantity', qty, 'revenue_cents', rev) order by rev desc)
      from (
        select category_name, sum(quantity) as qty, sum(line_total_cents) as rev
        from sold_items group by category_name
      ) q
    ), '[]'::jsonb),
    'by_channel', coalesce((
      select jsonb_agg(jsonb_build_object('channel', kind, 'count', cnt, 'gross_cents', gross) order by gross desc)
      from (select kind, count(*) as cnt, sum(total_cents) as gross from closed_tabs group by kind) q
    ), '[]'::jsonb),
    'by_hour', coalesce((
      select jsonb_agg(jsonb_build_object('hour', h, 'count', cnt, 'gross_cents', gross) order by h)
      from (
        select extract(hour from closed_at at time zone s.timezone)::integer as h,
               count(*) as cnt, sum(total_cents) as gross
        from closed_tabs group by 1
      ) q
    ), '[]'::jsonb),
    'by_day', coalesce((
      select jsonb_agg(jsonb_build_object('day', d, 'count', cnt, 'gross_cents', gross) order by d)
      from (
        select (closed_at at time zone s.timezone)::date as d, count(*) as cnt, sum(total_cents) as gross
        from closed_tabs group by 1
      ) q
    ), '[]'::jsonb),
    'by_staff', coalesce((
      select jsonb_agg(jsonb_build_object('staff_id', staff_id, 'name', coalesce(pr.full_name, pr.email, '—'),
                                          'received_cents', received_cents, 'sales_closed', sales_closed,
                                          'gross_closed_cents', gross_closed_cents)
                       order by received_cents desc)
      from (
        select coalesce(r.staff_id, c.staff_id) as staff_id,
               coalesce(r.received_cents, 0) as received_cents,
               coalesce(c.sales_closed, 0) as sales_closed,
               coalesce(c.gross_closed_cents, 0) as gross_closed_cents
        from (select actor_id as staff_id, sum(amount_cents) as received_cents from received group by actor_id) r
        full join (select closed_by as staff_id, count(*) as sales_closed, sum(total_cents) as gross_closed_cents
                   from closed_tabs group by closed_by) c on c.staff_id = r.staff_id
      ) q
      left join public.profiles pr on pr.id = q.staff_id
    ), '[]'::jsonb),
    'by_cash_session', coalesce((
      select jsonb_agg(jsonb_build_object('session_id', cs.id, 'session_number', cs.session_number,
                                          'operator', coalesce(pr.full_name, pr.email, '—'),
                                          'opened_at', cs.opened_at, 'closed_at', cs.closed_at,
                                          'received_cents', q.total) order by cs.opened_at)
      from (select cash_session_id, sum(amount_cents) as total from received group by cash_session_id) q
      join public.cash_sessions cs on cs.id = q.cash_session_id
      left join public.profiles pr on pr.id = cs.opened_by
    ), '[]'::jsonb),
    'cancellations', (
      select jsonb_build_object(
        'orders_count', (select count(*) from period_orders where status = 'cancelled'),
        'items_count', (select count(*) from public.order_items oi join period_orders o on o.id = oi.order_id
                        where oi.status = 'cancelled'),
        'amount_cents',
          coalesce((select sum(oi.line_total_cents) from public.order_items oi join period_orders o on o.id = oi.order_id
                    where oi.status = 'cancelled'), 0)
          + coalesce((select sum(delivery_fee_cents) from period_orders where status = 'cancelled'), 0)
      )
    ),
    'discounts', (
      select jsonb_build_object('count', count(*), 'amount_cents', coalesce(sum(discount_cents), 0))
      from closed_tabs where discount_cents > 0
    ),
    'kitchen', (
      select jsonb_build_object(
        'avg_prep_minutes', round(avg(extract(epoch from (ready_at - accepted_at)) / 60.0) filter (where ready_at is not null)::numeric, 1),
        'orders_measured', count(*) filter (where ready_at is not null),
        'late_orders', count(*) filter (
          where coalesce(ready_at, now()) - accepted_at > make_interval(mins => s.late_order_minutes)),
        'late_threshold_minutes', s.late_order_minutes
      )
      from period_orders where accepted_at is not null and status <> 'cancelled'
    ),
    'orders', (
      select jsonb_build_object(
        'total', count(*),
        'by_status', coalesce((select jsonb_object_agg(status, c) from (select status, count(*) c from period_orders group by status) z), '{}'::jsonb),
        'deliveries_completed', count(*) filter (where delivery_status = 'delivered'),
        'deliveries_failed', count(*) filter (where delivery_status = 'failed'),
        'pickups', count(*) filter (where channel = 'pickup' and status <> 'cancelled'),
        'customer_orders', count(*) filter (where source = 'customer')
      )
      from period_orders
    ),
    'margin', (
      select jsonb_build_object(
        'revenue_with_cost_cents', coalesce(sum(line_total_cents) filter (where unit_cost_cents is not null), 0),
        'cost_cents', coalesce(sum(unit_cost_cents::bigint * quantity) filter (where unit_cost_cents is not null), 0),
        'gross_margin_cents', coalesce(sum(line_total_cents - unit_cost_cents::bigint * quantity) filter (where unit_cost_cents is not null), 0),
        'items_revenue_cents', coalesce(sum(line_total_cents), 0),
        'coverage_pct', case when coalesce(sum(line_total_cents), 0) = 0 then 0
          else round(100.0 * coalesce(sum(line_total_cents) filter (where unit_cost_cents is not null), 0) / sum(line_total_cents), 1) end
      )
      from sold_items
    )
  ) into v_result;

  return v_result;
end;
$$;

revoke execute on function private.report_headline(timestamptz, timestamptz, jsonb) from public, anon, authenticated;
revoke execute on function public.report_overview(timestamptz, timestamptz, jsonb) from public, anon;
grant execute on function public.report_overview(timestamptz, timestamptz, jsonb) to authenticated;
`,d=`-- =============================================================================
-- Espeteks — 0007: chamados de mesa (garçom / conta) e avaliação de pedidos
-- =============================================================================

-- -----------------------------------------------------------------------------
-- Chamados de mesa
--   O cliente identificado pelo QR chama o garçom ou pede a conta. O chamado NÃO
--   altera a comanda (a equipe decide); apenas notifica o atendimento.
--   open -> acknowledged ("a caminho") -> done | cancelled
-- -----------------------------------------------------------------------------
create table public.service_requests (
  id uuid primary key default gen_random_uuid(),
  table_id uuid not null references public.tables (id),
  qr_token_id uuid references public.table_qr_tokens (id),
  kind text not null check (kind in ('waiter', 'bill')),
  note text not null default '' check (char_length(note) <= 140),
  status text not null default 'open' check (status in ('open', 'acknowledged', 'done', 'cancelled')),
  created_at timestamptz not null default now(),
  acknowledged_by uuid references public.profiles (id),
  acknowledged_at timestamptz,
  resolved_by uuid references public.profiles (id),
  resolved_at timestamptz,
  check ((status in ('done', 'cancelled')) = (resolved_at is not null))
);
-- no máximo um chamado aberto por tipo e mesa (cliques repetidos não geram vários)
create unique index service_requests_one_open on public.service_requests (table_id, kind)
  where status in ('open', 'acknowledged');
create index service_requests_status_idx on public.service_requests (status, created_at);

alter table public.service_requests enable row level security;
create policy "service_requests: atendimento lê" on public.service_requests
  for select to authenticated
  using ((select private.has_any_perm('orders.view', 'tabs.view', 'orders.manage')));
grant select on public.service_requests to authenticated;
grant all on public.service_requests to service_role;

create or replace function public.request_table_service(p_token text, p_kind text, p_note text default '')
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_qr_id uuid;
  v_table_id uuid;
  v_req public.service_requests;
  v_note text := private.clean_text(p_note, 140, 'observação');
begin
  if p_kind is null or p_kind not in ('waiter', 'bill') then
    raise exception using message = 'INVALID_INPUT', detail = 'Tipo de chamado inválido.';
  end if;
  if p_token is null or p_token !~ '^[A-Za-z0-9_-]{22,64}$' then
    raise exception using message = 'INVALID_TABLE', detail = 'QR Code inválido ou expirado. Chame um atendente.';
  end if;
  perform private.hit_rate_limit('service:ip:' || coalesce(private.request_ip(), 'unknown'), 20, interval '10 minutes');

  select q.id, t.id into v_qr_id, v_table_id
  from public.table_qr_tokens q
  join public.tables t on t.id = q.table_id
  where q.token = p_token and q.active and t.active;
  if v_table_id is null then
    raise exception using message = 'INVALID_TABLE', detail = 'QR Code inválido ou expirado. Chame um atendente.';
  end if;

  -- já existe chamado aberto do mesmo tipo: devolve o existente (idempotente)
  select * into v_req from public.service_requests
   where table_id = v_table_id and kind = p_kind and status in ('open', 'acknowledged');
  if v_req.id is null then
    perform private.hit_rate_limit('service:qr:' || v_qr_id, 8, interval '10 minutes');
    insert into public.service_requests (table_id, qr_token_id, kind, note)
    values (v_table_id, v_qr_id, p_kind, v_note)
    returning * into v_req;
  end if;

  return jsonb_build_object('kind', v_req.kind, 'status', v_req.status, 'created_at', v_req.created_at,
                            'acknowledged_at', v_req.acknowledged_at);
end;
$$;

-- Situação dos chamados da mesa (para o cliente acompanhar "a caminho"). Sem dados pessoais.
create or replace function public.get_table_service_status(p_token text)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_table_id uuid;
begin
  if p_token is null or p_token !~ '^[A-Za-z0-9_-]{22,64}$' then
    raise exception using message = 'INVALID_TABLE', detail = 'QR Code inválido ou expirado.';
  end if;
  select t.id into v_table_id
  from public.table_qr_tokens q join public.tables t on t.id = q.table_id
  where q.token = p_token and q.active and t.active;
  if v_table_id is null then
    raise exception using message = 'INVALID_TABLE', detail = 'QR Code inválido ou expirado.';
  end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object('kind', kind, 'status', status, 'created_at', created_at,
                                        'acknowledged_at', acknowledged_at) order by created_at)
    from public.service_requests
    where table_id = v_table_id and status in ('open', 'acknowledged')
  ), '[]'::jsonb);
end;
$$;

-- open -> acknowledged -> done | cancelled
create or replace function public.update_service_request(p_id uuid, p_to text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v public.service_requests;
  v_me uuid;
begin
  perform private.require_any_perm('orders.manage', 'tabs.manage');
  v_me := private.current_staff_id();
  select * into v from public.service_requests where id = p_id for update;
  if v.id is null then
    raise exception using message = 'NOT_FOUND', detail = 'Chamado não encontrado.';
  end if;
  if p_to = 'acknowledged' and v.status = 'open' then
    update public.service_requests set status = 'acknowledged', acknowledged_by = v_me, acknowledged_at = now() where id = p_id;
  elsif p_to in ('done', 'cancelled') and v.status in ('open', 'acknowledged') then
    update public.service_requests
       set status = p_to, resolved_by = v_me, resolved_at = now(),
           acknowledged_by = coalesce(acknowledged_by, v_me), acknowledged_at = coalesce(acknowledged_at, now())
     where id = p_id;
  else
    raise exception using message = 'INVALID_TRANSITION', detail = 'Este chamado já foi atendido.';
  end if;
end;
$$;

-- -----------------------------------------------------------------------------
-- Avaliação do pedido pelo cliente (uma por pedido, após a conclusão)
-- -----------------------------------------------------------------------------
create table public.order_ratings (
  order_id uuid primary key references public.orders (id),
  stars smallint not null check (stars between 1 and 5),
  comment text not null default '' check (char_length(comment) <= 500),
  created_at timestamptz not null default now()
);
create index order_ratings_created_idx on public.order_ratings (created_at desc);

alter table public.order_ratings enable row level security;
create policy "order_ratings: gestão lê" on public.order_ratings
  for select to authenticated
  using ((select private.has_any_perm('reports.view', 'orders.cancel')));
grant select on public.order_ratings to authenticated;
grant all on public.order_ratings to service_role;

create or replace function public.rate_order(p_token text, p_stars integer, p_comment text default '')
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_order public.orders;
  v_comment text := private.clean_text(p_comment, 500, 'comentário');
begin
  perform private.hit_rate_limit('rate:' || coalesce(private.request_ip(), 'unknown'), 20, interval '10 minutes');
  if p_token is null or p_token !~ '^[A-Za-z0-9_-]{22,64}$' then
    raise exception using message = 'NOT_FOUND', detail = 'Pedido não encontrado.';
  end if;
  if p_stars is null or p_stars < 1 or p_stars > 5 then
    raise exception using message = 'INVALID_INPUT', detail = 'Escolha de 1 a 5 estrelas.';
  end if;
  select * into v_order from public.orders where public_token = p_token;
  if v_order.id is null then
    raise exception using message = 'NOT_FOUND', detail = 'Pedido não encontrado.';
  end if;
  if v_order.status <> 'completed' then
    raise exception using message = 'NOT_RATABLE', detail = 'A avaliação fica disponível quando o pedido for concluído.';
  end if;
  begin
    insert into public.order_ratings (order_id, stars, comment) values (v_order.id, p_stars, v_comment);
  exception when unique_violation then
    raise exception using message = 'ALREADY_RATED', detail = 'Este pedido já foi avaliado. Obrigado!';
  end;
  return jsonb_build_object('stars', p_stars);
end;
$$;

-- Status público do pedido agora inclui a avaliação (para não pedir duas vezes).
create or replace function public.get_order_status(p_token text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_order public.orders;
  s public.store_settings := private.settings();
begin
  perform private.hit_rate_limit('status:' || coalesce(private.request_ip(), 'unknown'), 600, interval '10 minutes');
  if p_token is null or p_token !~ '^[A-Za-z0-9_-]{22,64}$' then
    raise exception using message = 'NOT_FOUND', detail = 'Pedido não encontrado.';
  end if;
  select * into v_order from public.orders where public_token = p_token;
  if v_order.id is null then
    raise exception using message = 'NOT_FOUND', detail = 'Pedido não encontrado.';
  end if;
  return jsonb_build_object(
    'code', v_order.code,
    'channel', v_order.channel,
    'status', v_order.status,
    'delivery_status', v_order.delivery_status,
    'created_at', v_order.created_at,
    'accepted_at', v_order.accepted_at,
    'ready_at', v_order.ready_at,
    'completed_at', v_order.completed_at,
    'out_for_delivery_at', v_order.out_for_delivery_at,
    'delivered_at', v_order.delivered_at,
    'cancelled_at', v_order.cancelled_at,
    'customer_first_name', split_part(v_order.customer_name, ' ', 1),
    'table_label', (select t.label from public.tables t where t.id = v_order.table_id),
    'items_subtotal_cents', v_order.items_subtotal_cents,
    'delivery_fee_cents', v_order.delivery_fee_cents,
    'total_cents', v_order.total_cents,
    'store_name', s.store_name,
    'store_phone', s.phone,
    'rating', (select r.stars from public.order_ratings r where r.order_id = v_order.id),
    'estimate_minutes', case v_order.channel
      when 'pickup' then s.pickup_estimate_minutes
      when 'delivery' then coalesce((select z.estimate_minutes from public.delivery_zones z where z.id = v_order.delivery_zone_id), s.delivery_estimate_minutes)
    end,
    'items', coalesce((
      select jsonb_agg(jsonb_build_object(
        'name', oi.product_name,
        'variant', oi.variant_name,
        'quantity', oi.quantity,
        'status', oi.status,
        'line_total_cents', oi.line_total_cents,
        'notes', oi.notes,
        'add_ons', coalesce((
          select jsonb_agg(jsonb_build_object('name', a.name, 'quantity', a.quantity))
          from public.order_item_add_ons a where a.order_item_id = oi.id
        ), '[]'::jsonb)
      ) order by oi.position)
      from public.order_items oi where oi.order_id = v_order.id
    ), '[]'::jsonb)
  );
end;
$$;

-- Relatório de avaliações
create or replace function public.report_ratings(p_from timestamptz, p_to timestamptz)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  perform private.require_perm('reports.view');
  return (
    select jsonb_build_object(
      'count', count(*),
      'average', round(avg(r.stars)::numeric, 2),
      'distribution', jsonb_build_object(
        '5', count(*) filter (where r.stars = 5), '4', count(*) filter (where r.stars = 4),
        '3', count(*) filter (where r.stars = 3), '2', count(*) filter (where r.stars = 2),
        '1', count(*) filter (where r.stars = 1)),
      'recent', coalesce((
        select jsonb_agg(x order by (x ->> 'created_at') desc)
        from (
          select jsonb_build_object('code', o.code, 'stars', rr.stars, 'comment', rr.comment,
                                    'created_at', rr.created_at, 'channel', o.channel) as x
          from public.order_ratings rr join public.orders o on o.id = rr.order_id
          where rr.created_at >= p_from and rr.created_at < p_to
          order by rr.created_at desc limit 20
        ) q
      ), '[]'::jsonb)
    )
    from public.order_ratings r
    where r.created_at >= p_from and r.created_at < p_to
  );
end;
$$;

-- Realtime: chamados chegam ao atendimento na hora
alter publication supabase_realtime add table public.service_requests;

-- Privilégios das novas funções
revoke execute on function public.request_table_service(text, text, text) from public, anon, authenticated;
revoke execute on function public.get_table_service_status(text) from public, anon, authenticated;
revoke execute on function public.update_service_request(uuid, text) from public, anon, authenticated;
revoke execute on function public.rate_order(text, integer, text) from public, anon, authenticated;
revoke execute on function public.get_order_status(text) from public, anon, authenticated;
revoke execute on function public.report_ratings(timestamptz, timestamptz) from public, anon, authenticated;

grant execute on function public.request_table_service(text, text, text) to anon, authenticated;
grant execute on function public.get_table_service_status(text) to anon, authenticated;
grant execute on function public.rate_order(text, integer, text) to anon, authenticated;
grant execute on function public.get_order_status(text) to anon, authenticated;
grant execute on function public.update_service_request(uuid, text) to authenticated;
grant execute on function public.report_ratings(timestamptz, timestamptz) to authenticated;
`,f=`-- =============================================================================
-- Espeteks — 0008: identidade visual pública (nome e logo do sistema)
-- Usada pela tela de login, painel e título/ícone da aba. Somente dados públicos.
-- =============================================================================
create or replace function public.get_branding()
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object('name', s.store_name, 'tagline', s.tagline, 'logo_path', s.logo_path)
  from public.store_settings s
  where s.id = 1;
$$;

revoke execute on function public.get_branding() from public, anon, authenticated;
grant execute on function public.get_branding() to anon, authenticated;
`,p=Object.defineProperty,m=e=>{throw TypeError(e)},ee=(e,t)=>()=>(e&&(t=e(e=0)),t),te=(e,t)=>{for(var n in t)p(e,n,{get:t[n],enumerable:!0})},ne=(e,t,n)=>t.has(e)||m(`Cannot `+n),h=(e,t,n)=>(ne(e,t,`read from private field`),n?n.call(e):t.get(e)),g=(e,t,n)=>t.has(e)?m(`Cannot add the same private member more than once`):t instanceof WeakSet?t.add(e):t.set(e,n),_=(e,t,n,r)=>(ne(e,t,`write to private field`),r?r.call(e,n):t.set(e,n),n),v=(e,t,n)=>(ne(e,t,`access private method`),n),re=(e,t,n,r)=>({set _(r){_(e,t,r,n)},get _(){return h(e,t,r)}}),y=ee(()=>{});te({},{ABSTIME:()=>Ee,ACLITEM:()=>Pe,BIT:()=>Ue,BOOL:()=>oe,BPCHAR:()=>Fe,BYTEA:()=>se,CHAR:()=>ce,CID:()=>ge,CIDR:()=>Ce,CIRCLE:()=>ke,DATE:()=>Le,FLOAT4:()=>we,FLOAT8:()=>Te,GTSVECTOR:()=>at,INET:()=>Ne,INT2:()=>ue,INT4:()=>de,INT8:()=>le,INTERVAL:()=>Ve,JSON:()=>_e,JSONB:()=>ct,MACADDR:()=>Me,MACADDR8:()=>Ae,MONEY:()=>je,NUMERIC:()=>Ge,OID:()=>pe,PATH:()=>xe,PG_DEPENDENCIES:()=>nt,PG_LSN:()=>et,PG_NDISTINCT:()=>tt,PG_NODE_TREE:()=>ye,POLYGON:()=>Se,REFCURSOR:()=>Ke,REGCLASS:()=>Xe,REGCONFIG:()=>ot,REGDICTIONARY:()=>st,REGNAMESPACE:()=>lt,REGOPER:()=>Je,REGOPERATOR:()=>Ye,REGPROC:()=>fe,REGPROCEDURE:()=>qe,REGROLE:()=>ut,REGTYPE:()=>Ze,RELTIME:()=>De,SMGR:()=>be,TEXT:()=>25,TID:()=>me,TIME:()=>Re,TIMESTAMP:()=>ze,TIMESTAMPTZ:()=>Be,TIMETZ:()=>He,TINTERVAL:()=>Oe,TSQUERY:()=>it,TSVECTOR:()=>rt,TXID_SNAPSHOT:()=>$e,UUID:()=>Qe,VARBIT:()=>We,VARCHAR:()=>Ie,XID:()=>he,XML:()=>ve,arrayParser:()=>St,arraySerializer:()=>bt,parseType:()=>ht,parsers:()=>pt,serializers:()=>mt,types:()=>dt}),y();var ie=globalThis.JSON.parse,ae=globalThis.JSON.stringify,oe=16,se=17,ce=18,le=20,ue=21,de=23,fe=24,pe=26,me=27,he=28,ge=29,_e=114,ve=142,ye=194,be=210,xe=602,Se=604,Ce=650,we=700,Te=701,Ee=702,De=703,Oe=704,ke=718,Ae=774,je=790,Me=829,Ne=869,Pe=1033,Fe=1042,Ie=1043,Le=1082,Re=1083,ze=1114,Be=1184,Ve=1186,He=1266,Ue=1560,We=1562,Ge=1700,Ke=1790,qe=2202,Je=2203,Ye=2204,Xe=2205,Ze=2206,Qe=2950,$e=2970,et=3220,tt=3361,nt=3402,rt=3614,it=3615,at=3642,ot=3734,st=3769,ct=3802,lt=4089,ut=4096,dt={string:{to:25,from:[25,Ie,Fe],serialize:e=>e instanceof Date?e.toISOString():e.toString(),parse:e=>e},number:{to:0,from:[ue,de,pe,we,Te],serialize:e=>e.toString(),parse:e=>+e},bigint:{to:le,from:[le],serialize:e=>e.toString(),parse:e=>{let t=BigInt(e);return t<-(2**53-1)||t>2**53-1?t:Number(t)}},json:{to:_e,from:[_e,ct],serialize:e=>typeof e==`string`?e:ae(e,(e,t)=>typeof t==`bigint`?t.toString():t),parse:e=>ie(e)},boolean:{to:oe,from:[oe],serialize:e=>{if(typeof e==`boolean`)return e?`t`:`f`;if(typeof e==`number`){if(e===1)return`t`;if(e===0)return`f`}else if(typeof e==`string`){let t=e.trim().toLowerCase();if([`true`,`t`,`yes`,`y`,`on`,`1`].includes(t))return`t`;if([`false`,`f`,`no`,`n`,`off`,`0`].includes(t))return`f`}throw Error(`Invalid input for boolean type`)},parse:e=>e===`t`},date:{to:Be,from:[Le,ze,Be],serialize:e=>{if(typeof e==`string`)return e;if(typeof e==`number`)return new Date(e).toISOString();if(e instanceof Date)return e.toISOString();throw Error(`Invalid input for date type`)},parse:e=>new Date(e)},bytea:{to:se,from:[se],serialize:e=>{if(!(e instanceof Uint8Array))throw Error(`Invalid input for bytea type`);return`\\x`+Array.from(e).map(e=>e.toString(16).padStart(2,`0`)).join(``)},parse:e=>{let t=e.slice(2);return Uint8Array.from({length:t.length/2},(e,n)=>parseInt(t.substring(n*2,(n+1)*2),16))}}},ft=gt(dt),pt=ft.parsers,mt=ft.serializers;function ht(e,t,n){if(e===null)return null;let r=n?.[t]??ft.parsers[t];return r?r(e,t):e}function gt(e){return Object.keys(e).reduce(({parsers:t,serializers:n},r)=>{let{to:i,from:a,serialize:o,parse:s}=e[r];return n[i]=o,n[r]=o,t[r]=s,Array.isArray(a)?a.forEach(e=>{t[e]=s,n[e]=o}):(t[a]=s,n[a]=o),{parsers:t,serializers:n}},{parsers:{},serializers:{}})}var _t=/\\/g,vt=/"/g;function yt(e){return e.replace(_t,`\\\\`).replace(vt,`\\"`)}function bt(e,t,n){if(Array.isArray(e)===!1)return e;if(!e.length)return`{}`;let r=e[0],i=n===1020?`;`:`,`;return Array.isArray(r)?`{${e.map(e=>bt(e,t,n)).join(i)}}`:`{${e.map(e=>(e===void 0&&(e=null),e===null?`null`:`"`+yt(t?t(e):e.toString())+`"`)).join(i)}}`}var xt={i:0,char:null,str:``,quoted:!1,last:0,p:null};function St(e,t,n){return xt.i=xt.last=0,Ct(xt,e,t,n)[0]}function Ct(e,t,n,r){let i=[],a=r===1020?`;`:`,`;for(;e.i<t.length;e.i++){if(e.char=t[e.i],e.quoted)e.char===`\\`?e.str+=t[++e.i]:e.char===`"`?(i.push(n?n(e.str):e.str),e.str=``,e.quoted=t[e.i+1]===`"`,e.last=e.i+2):e.str+=e.char;else if(e.char===`"`)e.quoted=!0;else if(e.char===`{`)e.last=++e.i,i.push(Ct(e,t,n,r));else if(e.char===`}`){if(e.last<e.i){let r=t.slice(e.last,e.i);r===`NULL`&&!e.quoted?i.push(null):i.push(n?n(r):r)}e.quoted=!1,e.last=e.i+1;break}else if(e.char===a&&e.p!==`}`&&e.p!==`"`){let r=t.slice(e.last,e.i);r===`NULL`&&!e.quoted?i.push(null):i.push(n?n(r):r),e.last=e.i+1}e.p=e.char}return e.last<e.i&&i.push(n?n(t.slice(e.last,e.i+1)):t.slice(e.last,e.i+1)),i}te({},{parseDescribeStatementResults:()=>Tt,parseResults:()=>wt}),y();function wt(e,t,n,r){let i=[],a={rows:[],fields:[]},o=0,s={...t,...n?.parsers};return e.forEach(e=>{switch(e.name){case`rowDescription`:a.fields=e.fields.map(e=>({name:e.name,dataTypeID:e.dataTypeID}));break;case`dataRow`:{if(!a)break;let t=e;n?.rowMode===`array`?a.rows.push(t.fields.map((e,t)=>ht(e,a.fields[t].dataTypeID,s))):a.rows.push(Object.fromEntries(t.fields.map((e,t)=>[a.fields[t].name,ht(e,a.fields[t].dataTypeID,s)])));break}case`commandComplete`:{let t=e.text.split(` `),n=t[0],s=parseInt(t[t.length-1],10);switch(n){case`INSERT`:case`UPDATE`:case`DELETE`:case`COPY`:case`MERGE`:o+=s}let c={...a,command:n,affectedRows:o};Number.isNaN(s)||(c.rowCount=s),r&&(c.blob=r),i.push(c),a={rows:[],fields:[]};break}}}),i.length===0&&i.push({affectedRows:0,rows:[],fields:[]}),i}function Tt(e){let t=e.find(e=>e.name===`parameterDescription`);return t?t.dataTypeIDs:[]}var Et={};te(Et,{AuthenticationCleartextPassword:()=>It,AuthenticationMD5Password:()=>Lt,AuthenticationOk:()=>Ft,AuthenticationSASL:()=>Rt,AuthenticationSASLContinue:()=>zt,AuthenticationSASLFinal:()=>Bt,BackendKeyDataMessage:()=>qt,CommandCompleteMessage:()=>Xt,CopyDataMessage:()=>Vt,CopyResponse:()=>Ht,DataRowMessage:()=>Zt,DatabaseError:()=>b,Field:()=>Ut,NoticeMessage:()=>Qt,NotificationResponseMessage:()=>Jt,ParameterDescriptionMessage:()=>Gt,ParameterStatusMessage:()=>Kt,ReadyForQueryMessage:()=>Yt,RowDescriptionMessage:()=>Wt,bindComplete:()=>Ot,closeComplete:()=>kt,copyDone:()=>Pt,emptyQuery:()=>Nt,noData:()=>At,parseComplete:()=>Dt,portalSuspended:()=>jt,replicationStart:()=>Mt}),y();var Dt={name:`parseComplete`,length:5},Ot={name:`bindComplete`,length:5},kt={name:`closeComplete`,length:5},At={name:`noData`,length:5},jt={name:`portalSuspended`,length:5},Mt={name:`replicationStart`,length:4},Nt={name:`emptyQuery`,length:4},Pt={name:`copyDone`,length:4},Ft=class{constructor(e){this.length=e,this.name=`authenticationOk`}},It=class{constructor(e){this.length=e,this.name=`authenticationCleartextPassword`}},Lt=class{constructor(e,t){this.length=e,this.salt=t,this.name=`authenticationMD5Password`}},Rt=class{constructor(e,t){this.length=e,this.mechanisms=t,this.name=`authenticationSASL`}},zt=class{constructor(e,t){this.length=e,this.data=t,this.name=`authenticationSASLContinue`}},Bt=class{constructor(e,t){this.length=e,this.data=t,this.name=`authenticationSASLFinal`}},b=class extends Error{constructor(e,t,n){super(e),this.length=t,this.name=n}},Vt=class{constructor(e,t){this.length=e,this.chunk=t,this.name=`copyData`}},Ht=class{constructor(e,t,n,r){this.length=e,this.name=t,this.binary=n,this.columnTypes=Array(r)}},Ut=class{constructor(e,t,n,r,i,a,o){this.name=e,this.tableID=t,this.columnID=n,this.dataTypeID=r,this.dataTypeSize=i,this.dataTypeModifier=a,this.format=o}},Wt=class{constructor(e,t){this.length=e,this.fieldCount=t,this.name=`rowDescription`,this.fields=Array(this.fieldCount)}},Gt=class{constructor(e,t){this.length=e,this.parameterCount=t,this.name=`parameterDescription`,this.dataTypeIDs=Array(this.parameterCount)}},Kt=class{constructor(e,t,n){this.length=e,this.parameterName=t,this.parameterValue=n,this.name=`parameterStatus`}},qt=class{constructor(e,t,n){this.length=e,this.processID=t,this.secretKey=n,this.name=`backendKeyData`}},Jt=class{constructor(e,t,n,r){this.length=e,this.processId=t,this.channel=n,this.payload=r,this.name=`notification`}},Yt=class{constructor(e,t){this.length=e,this.status=t,this.name=`readyForQuery`}},Xt=class{constructor(e,t){this.length=e,this.text=t,this.name=`commandComplete`}},Zt=class{constructor(e,t){this.length=e,this.fields=t,this.name=`dataRow`,this.fieldCount=t.length}},Qt=class{constructor(e,t){this.length=e,this.message=t,this.name=`notice`}};te({},{Parser:()=>ar,messages:()=>Et,serialize:()=>D}),y(),y(),y(),y();function $t(e){let t=e.length;for(let n=e.length-1;n>=0;n--){let r=e.charCodeAt(n);r>127&&r<=2047?t++:r>2047&&r<=65535&&(t+=2),r>=56320&&r<=57343&&n--}return t}var x,S,en,tn,nn,C,rn,w,an,on=class{constructor(e=256){this.size=e,g(this,C),g(this,x),g(this,S,5),g(this,en,!1),g(this,tn,new TextEncoder),g(this,nn,0),_(this,x,v(this,C,rn).call(this,e))}addInt32(e){return v(this,C,w).call(this,4),h(this,x).setInt32(h(this,S),e,h(this,en)),_(this,S,h(this,S)+4),this}addInt16(e){return v(this,C,w).call(this,2),h(this,x).setInt16(h(this,S),e,h(this,en)),_(this,S,h(this,S)+2),this}addCString(e){return e&&this.addString(e),v(this,C,w).call(this,1),h(this,x).setUint8(h(this,S),0),re(this,S)._++,this}addString(e=``){let t=$t(e);return v(this,C,w).call(this,t),h(this,tn).encodeInto(e,new Uint8Array(h(this,x).buffer,h(this,S))),_(this,S,h(this,S)+t),this}add(e){return v(this,C,w).call(this,e.byteLength),new Uint8Array(h(this,x).buffer).set(new Uint8Array(e),h(this,S)),_(this,S,h(this,S)+e.byteLength),this}flush(e){let t=v(this,C,an).call(this,e);return _(this,S,5),_(this,x,v(this,C,rn).call(this,this.size)),new Uint8Array(t)}};x=new WeakMap,S=new WeakMap,en=new WeakMap,tn=new WeakMap,nn=new WeakMap,C=new WeakSet,rn=function(e){return new DataView(new ArrayBuffer(e))},w=function(e){if(h(this,x).byteLength-h(this,S)<e){let t=h(this,x).buffer,n=t.byteLength+(t.byteLength>>1)+e;_(this,x,v(this,C,rn).call(this,n)),new Uint8Array(h(this,x).buffer).set(new Uint8Array(t))}},an=function(e){if(e){h(this,x).setUint8(h(this,nn),e);let t=h(this,S)-(h(this,nn)+1);h(this,x).setInt32(h(this,nn)+1,t,h(this,en))}return h(this,x).buffer.slice(e?0:5,h(this,S))};var T=new on,sn=e=>{T.addInt16(3).addInt16(0);for(let t of Object.keys(e))T.addCString(t).addCString(e[t]);T.addCString(`client_encoding`).addCString(`UTF8`);let t=T.addCString(``).flush(),n=t.byteLength+4;return new on().addInt32(n).add(t).flush()},cn=()=>{let e=new DataView(new ArrayBuffer(8));return e.setInt32(0,8,!1),e.setInt32(4,80877103,!1),new Uint8Array(e.buffer)},ln=e=>T.addCString(e).flush(112),un=(e,t)=>(T.addCString(e).addInt32($t(t)).addString(t),T.flush(112)),dn=e=>T.addString(e).flush(112),fn=e=>T.addCString(e).flush(81),pn=[],mn=e=>{let t=e.name??``;t.length>63&&(console.error(`Warning! Postgres only supports 63 characters for query names.`),console.error(`You supplied %s (%s)`,t,t.length),console.error(`This can cause conflicts and silent errors executing queries`));let n=T.addCString(t).addCString(e.text).addInt16(e.types?.length??0);return e.types?.forEach(e=>n.addInt32(e)),T.flush(80)},E=new on,hn=(e,t)=>{for(let n=0;n<e.length;n++){let r=t?t(e[n],n):e[n];if(r===null)T.addInt16(0),E.addInt32(-1);else if(r instanceof ArrayBuffer||ArrayBuffer.isView(r)){let e=ArrayBuffer.isView(r)?r.buffer.slice(r.byteOffset,r.byteOffset+r.byteLength):r;T.addInt16(1),E.addInt32(e.byteLength),E.add(e)}else T.addInt16(0),E.addInt32($t(r)),E.addString(r)}},gn=(e={})=>{let t=e.portal??``,n=e.statement??``,r=e.binary??!1,i=e.values??pn,a=i.length;return T.addCString(t).addCString(n),T.addInt16(a),hn(i,e.valueMapper),T.addInt16(a),T.add(E.flush()),T.addInt16(+!!r),T.flush(66)},_n=new Uint8Array([69,0,0,0,9,0,0,0,0,0]),vn=e=>{if(!e||!e.portal&&!e.rows)return _n;let t=e.portal??``,n=e.rows??0,r=$t(t),i=4+r+1+4,a=new DataView(new ArrayBuffer(1+i));return a.setUint8(0,69),a.setInt32(1,i,!1),new TextEncoder().encodeInto(t,new Uint8Array(a.buffer,5)),a.setUint8(r+5,0),a.setUint32(a.byteLength-4,n,!1),new Uint8Array(a.buffer)},yn=(e,t)=>{let n=new DataView(new ArrayBuffer(16));return n.setInt32(0,16,!1),n.setInt16(4,1234,!1),n.setInt16(6,5678,!1),n.setInt32(8,e,!1),n.setInt32(12,t,!1),new Uint8Array(n.buffer)},bn=(e,t)=>{let n=new on;return n.addCString(t),n.flush(e)},xn=T.addCString(`P`).flush(68),Sn=T.addCString(`S`).flush(68),Cn=e=>e.name?bn(68,`${e.type}${e.name??``}`):e.type===`P`?xn:Sn,wn=e=>bn(67,`${e.type}${e.name??``}`),Tn=e=>T.add(e).flush(100),En=e=>bn(102,e),Dn=e=>new Uint8Array([e,0,0,0,4]),On=Dn(72),kn=Dn(83),An=Dn(88),jn=Dn(99),D={startup:sn,password:ln,requestSsl:cn,sendSASLInitialResponseMessage:un,sendSCRAMClientFinalMessage:dn,query:fn,parse:mn,bind:gn,execute:vn,describe:Cn,close:wn,flush:()=>On,sync:()=>kn,end:()=>An,copyData:Tn,copyDone:()=>jn,copyFail:En,cancel:yn};y(),y();var Mn={text:0,binary:1};y();var Nn=new ArrayBuffer(0),O,k,Pn,Fn,In,Ln=class{constructor(e=0){g(this,O,new DataView(Nn)),g(this,k),g(this,Pn,`utf-8`),g(this,Fn,new TextDecoder(h(this,Pn))),g(this,In,!1),_(this,k,e)}setBuffer(e,t){_(this,k,e),_(this,O,new DataView(t))}int16(){let e=h(this,O).getInt16(h(this,k),h(this,In));return _(this,k,h(this,k)+2),e}byte(){let e=h(this,O).getUint8(h(this,k));return re(this,k)._++,e}int32(){let e=h(this,O).getInt32(h(this,k),h(this,In));return _(this,k,h(this,k)+4),e}string(e){return h(this,Fn).decode(this.bytes(e))}cstring(){let e=h(this,k),t=e;for(;h(this,O).getUint8(t++)!==0;);let n=this.string(t-e-1);return _(this,k,t),n}bytes(e){let t=h(this,O).buffer.slice(h(this,k),h(this,k)+e);return _(this,k,h(this,k)+e),new Uint8Array(t)}};O=new WeakMap,k=new WeakMap,Pn=new WeakMap,Fn=new WeakMap,In=new WeakMap;var Rn=1,zn=Rn+4,Bn=new ArrayBuffer(0),A,j,M,N,P,Vn,Hn,Un,Wn,Gn,Kn,qn,Jn,Yn,Xn,Zn,Qn,$n,er,tr,nr,rr,ir,ar=class{constructor(){g(this,P),g(this,A,new DataView(Bn)),g(this,j,0),g(this,M,0),g(this,N,new Ln)}parse(e,t){v(this,P,Hn).call(this,ArrayBuffer.isView(e)?e.buffer.slice(e.byteOffset,e.byteOffset+e.byteLength):e);let n=h(this,M)+h(this,j),r=h(this,M);for(;r+zn<=n;){let e=h(this,A).getUint8(r),i=h(this,A).getUint32(r+Rn,!1),a=Rn+i;if(a+r<=n&&i>0){let n;try{n=v(this,P,Un).call(this,r+zn,e,i,h(this,A).buffer)}catch(e){throw v(this,P,Vn).call(this),e}t(n),r+=a}else break}r===n?v(this,P,Vn).call(this):(_(this,j,n-r),_(this,M,r))}};A=new WeakMap,j=new WeakMap,M=new WeakMap,N=new WeakMap,P=new WeakSet,Vn=function(){_(this,A,new DataView(Bn)),_(this,j,0),_(this,M,0)},Hn=function(e){if(h(this,j)>0){let t=h(this,j)+e.byteLength;if(t+h(this,M)>h(this,A).byteLength){let e;if(t<=h(this,A).byteLength&&h(this,M)>=h(this,j))e=h(this,A).buffer;else{let n=h(this,A).byteLength*2;for(;t>=n;)n*=2;e=new ArrayBuffer(n)}new Uint8Array(e).set(new Uint8Array(h(this,A).buffer,h(this,M),h(this,j))),_(this,A,new DataView(e)),_(this,M,0)}new Uint8Array(h(this,A).buffer).set(new Uint8Array(e),h(this,M)+h(this,j)),_(this,j,t)}else _(this,A,new DataView(e)),_(this,M,0),_(this,j,e.byteLength)},Un=function(e,t,n,r){switch(t){case 50:return Ot;case 49:return Dt;case 51:return kt;case 110:return At;case 115:return jt;case 99:return Pt;case 87:return Mt;case 73:return Nt;case 68:return v(this,P,er).call(this,e,n,r);case 67:return v(this,P,Gn).call(this,e,n,r);case 90:return v(this,P,Wn).call(this,e,n,r);case 65:return v(this,P,Xn).call(this,e,n,r);case 82:return v(this,P,rr).call(this,e,n,r);case 83:return v(this,P,tr).call(this,e,n,r);case 75:return v(this,P,nr).call(this,e,n,r);case 69:return v(this,P,ir).call(this,e,n,r,`error`);case 78:return v(this,P,ir).call(this,e,n,r,`notice`);case 84:return v(this,P,Zn).call(this,e,n,r);case 116:return v(this,P,$n).call(this,e,n,r);case 71:return v(this,P,qn).call(this,e,n,r);case 72:return v(this,P,Jn).call(this,e,n,r);case 100:return v(this,P,Kn).call(this,e,n,r);default:return new b(`received invalid response: `+t.toString(16),n,`error`)}},Wn=function(e,t,n){return h(this,N).setBuffer(e,n),new Yt(t,h(this,N).string(1))},Gn=function(e,t,n){return h(this,N).setBuffer(e,n),new Xt(t,h(this,N).cstring())},Kn=function(e,t,n){let r=n.slice(e,e+(t-4));return new Vt(t,new Uint8Array(r))},qn=function(e,t,n){return v(this,P,Yn).call(this,e,t,n,`copyInResponse`)},Jn=function(e,t,n){return v(this,P,Yn).call(this,e,t,n,`copyOutResponse`)},Yn=function(e,t,n,r){h(this,N).setBuffer(e,n);let i=h(this,N).byte()!==0,a=h(this,N).int16(),o=new Ht(t,r,i,a);for(let e=0;e<a;e++)o.columnTypes[e]=h(this,N).int16();return o},Xn=function(e,t,n){return h(this,N).setBuffer(e,n),new Jt(t,h(this,N).int32(),h(this,N).cstring(),h(this,N).cstring())},Zn=function(e,t,n){h(this,N).setBuffer(e,n);let r=h(this,N).int16(),i=new Wt(t,r);for(let e=0;e<r;e++)i.fields[e]=v(this,P,Qn).call(this);return i},Qn=function(){return new Ut(h(this,N).cstring(),h(this,N).int32(),h(this,N).int16(),h(this,N).int32(),h(this,N).int16(),h(this,N).int32(),h(this,N).int16()===0?Mn.text:Mn.binary)},$n=function(e,t,n){h(this,N).setBuffer(e,n);let r=h(this,N).int16(),i=new Gt(t,r);for(let e=0;e<r;e++)i.dataTypeIDs[e]=h(this,N).int32();return i},er=function(e,t,n){h(this,N).setBuffer(e,n);let r=h(this,N).int16(),i=Array(r);for(let e=0;e<r;e++){let t=h(this,N).int32();i[e]=t===-1?null:h(this,N).string(t)}return new Zt(t,i)},tr=function(e,t,n){return h(this,N).setBuffer(e,n),new Kt(t,h(this,N).cstring(),h(this,N).cstring())},nr=function(e,t,n){return h(this,N).setBuffer(e,n),new qt(t,h(this,N).int32(),h(this,N).int32())},rr=function(e,t,n){h(this,N).setBuffer(e,n);let r=h(this,N).int32();switch(r){case 0:return new Ft(t);case 3:return new It(t);case 5:return new Lt(t,h(this,N).bytes(4));case 10:{let e=[];for(;;){let n=h(this,N).cstring();if(n.length===0)return new Rt(t,e);e.push(n)}}case 11:return new zt(t,h(this,N).string(t-8));case 12:return new Bt(t,h(this,N).string(t-8));default:throw Error(`Unknown authenticationOk message type `+r)}},ir=function(e,t,n,r){h(this,N).setBuffer(e,n);let i={},a=h(this,N).string(1);for(;a!==`\0`;)i[a]=h(this,N).cstring(),a=h(this,N).string(1);let o=i.M,s=r===`notice`?new Qt(t,o):new b(o,t,r);return s.severity=i.S,s.code=i.C,s.detail=i.D,s.hint=i.H,s.position=i.P,s.internalPosition=i.p,s.internalQuery=i.q,s.where=i.W,s.schema=i.s,s.table=i.t,s.column=i.c,s.dataType=i.d,s.constraint=i.n,s.file=i.F,s.line=i.L,s.routine=i.R,s},y();var or={part:`part`,container:`container`};function sr(e,t,...n){let r=e.length-1,i=n.length-1;if(i!==-1){if(i===0){e[r]=e[r]+n[0]+t;return}e[r]=e[r]+n[0],e.push(...n.slice(1,i)),e.push(n[i]+t)}}function cr(e,...t){let n=[e[0]];n.raw=[e.raw[0]];let r=[];for(let i=0;i<t.length;i++){let a=t[i],o=i+1;a?._templateType===or.part?(sr(n,e[o],a.str),sr(n.raw,e.raw[o],a.str)):a?._templateType===or.container?(sr(n,e[o],...a.strings),sr(n.raw,e.raw[o],...a.strings.raw),r.push(...a.values)):(n.push(e[o]),n.raw.push(e.raw[o]),r.push(a))}return{_templateType:`container`,strings:n,values:r}}function lr(e,...t){let{strings:n,values:r}=cr(e,...t);return{query:[n[0],...r.flatMap((e,t)=>[`$${t+1}`,n[t+1]])].join(``),params:r}}y(),y();function ur(e){let t=e.e;return t.query=e.query,t.params=e.params,t.queryOptions=e.options,t}var dr,F,I,L,fr,R,pr,mr=class{constructor(){g(this,I),this.serializers={...mt},this.parsers={...pt},g(this,dr,!1),g(this,F,!1)}async _initArrayTypes({force:e=!1}={}){if(h(this,dr)&&!e)return;_(this,dr,!0);let t=await this.query(`
      SELECT b.oid, b.typarray
      FROM pg_catalog.pg_type a
      LEFT JOIN pg_catalog.pg_type b ON b.oid = a.typelem
      WHERE a.typcategory = 'A'
      GROUP BY b.oid, b.typarray
      ORDER BY b.oid
    `);for(let e of t.rows)this.serializers[e.typarray]=t=>bt(t,this.serializers[e.oid],e.typarray),this.parsers[e.typarray]=t=>St(t,this.parsers[e.oid],e.typarray)}async refreshArrayTypes(){await this._initArrayTypes({force:!0})}async query(e,t,n){return await this._checkReady(),await this._runExclusiveTransaction(async()=>await v(this,I,fr).call(this,e,t,n))}async sql(e,...t){let{query:n,params:r}=lr(e,...t);return await this.query(n,r)}async exec(e,t){return await this._checkReady(),await this._runExclusiveTransaction(async()=>await v(this,I,R).call(this,e,t))}async describeQuery(e,t){let n=[];try{await v(this,I,L).call(this,D.parse({text:e,types:t?.paramTypes}),t),n=await v(this,I,L).call(this,D.describe({type:`S`}),t)}catch(n){throw n instanceof b?ur({e:n,options:t,params:void 0,query:e}):n}finally{n.push(...await v(this,I,L).call(this,D.sync(),t))}let r=n.find(e=>e.name===`parameterDescription`),i=n.find(e=>e.name===`rowDescription`);return{queryParams:r?.dataTypeIDs.map(e=>({dataTypeID:e,serializer:this.serializers[e]}))??[],resultFields:i?.fields.map(e=>({name:e.name,dataTypeID:e.dataTypeID,parser:this.parsers[e.dataTypeID]}))??[]}}async transaction(e){return await this._checkReady(),await this._runExclusiveTransaction(async()=>{await v(this,I,R).call(this,`BEGIN`),_(this,F,!0);let t=!1,n=()=>{if(t)throw Error(`Transaction is closed`)},r={query:async(e,t,r)=>(n(),await v(this,I,fr).call(this,e,t,r)),sql:async(e,...t)=>{n();let{query:r,params:i}=lr(e,...t);return await v(this,I,fr).call(this,r,i)},exec:async(e,t)=>(n(),await v(this,I,R).call(this,e,t)),rollback:async()=>{n(),await v(this,I,R).call(this,`ROLLBACK`),t=!0},listen:async(e,t)=>(n(),await this.listen(e,t,r)),get closed(){return t}};try{let n=await e(r);return t||(t=!0,await v(this,I,R).call(this,`COMMIT`)),_(this,F,!1),n}catch(e){throw t||(t=!0,await v(this,I,R).call(this,`ROLLBACK`)),_(this,F,!1),e}})}async runExclusive(e){return await this._runExclusiveQuery(e)}};dr=new WeakMap,F=new WeakMap,I=new WeakSet,L=async function(e,t={}){return await this.execProtocolStream(e,{...t,syncToFs:!1})},fr=async function(e,t=[],n){return await this._runExclusiveQuery(async()=>{v(this,I,pr).call(this,`runQuery`,e,t,n),await this._handleBlob(n?.blob);let r=[];try{let i=await v(this,I,L).call(this,D.parse({text:e,types:n?.paramTypes}),n),a=Tt(await v(this,I,L).call(this,D.describe({type:`S`}),n)),o=t.map((e,t)=>{let r=a[t];if(e==null)return null;let i=n?.serializers?.[r]??this.serializers[r];return i?i(e):e.toString()});r=[...i,...await v(this,I,L).call(this,D.bind({values:o}),n),...await v(this,I,L).call(this,D.describe({type:`P`}),n),...await v(this,I,L).call(this,D.execute({}),n)]}catch(r){throw r instanceof b?ur({e:r,options:n,params:t,query:e}):r}finally{r.push(...await v(this,I,L).call(this,D.sync(),n))}await this._cleanupBlob(),h(this,F)||await this.syncToFs();let i=await this._getWrittenBlob();return wt(r,this.parsers,n,i)[0]})},R=async function(e,t){return await this._runExclusiveQuery(async()=>{v(this,I,pr).call(this,`runExec`,e,t),await this._handleBlob(t?.blob);let n=[];try{n=await v(this,I,L).call(this,D.query(e),t)}catch(n){throw n instanceof b?ur({e:n,options:t,params:void 0,query:e}):n}finally{n.push(...await v(this,I,L).call(this,D.sync(),t))}this._cleanupBlob(),h(this,F)||await this.syncToFs();let r=await this._getWrittenBlob();return wt(n,this.parsers,t,r)})},pr=function(...e){this.debug>0&&console.log(...e)},y();var hr=Object.defineProperty,gr=(e,t)=>{for(var n in t)hr(e,n,{get:t[n],enumerable:!0})},_r={};gr(_r,{IN_NODE:()=>yr,WASM_PREFIX:()=>br,getFsBundle:()=>Er,instantiateWasm:()=>Tr,pgliteProc:()=>xr,rmdirRecursive:()=>kr,startArtifactDownload:()=>Cr,toPostgresName:()=>Or,uuid:()=>Dr});function vr(){let e=process.type;return e===`renderer`||e===`worker`||e===`service-worker`}var yr=typeof process==`object`&&typeof process.versions==`object`&&typeof process.versions.node==`string`&&!vr(),br=`/pglite`,xr=globalThis&&typeof globalThis.process<`u`?globalThis.process:{exitCode:void 0},Sr=new Map;async function Cr(e){yr||Sr.has(e.toString())||Sr.set(e.toString(),fetch(e))}var wr=new Map;async function Tr(n,r,i){if(i||wr.has(r.toString())){let e=i||wr.get(r.toString());return{instance:await WebAssembly.instantiate(e,n),module:e}}if(yr){let i=await(await t(async()=>{let{readFile:t}=await import(`./vite-browser-external-Cn0MOYvd.js`).then(t=>e(t.default,1));return{readFile:t}},__vite__mapDeps([0,1]))).readFile(r),{module:a,instance:o}=await WebAssembly.instantiate(i,n);return wr.set(r.toString(),a),{instance:o,module:a}}{Sr.has(r.toString())||Cr(r);let e=await Sr.get(r.toString()),{module:t,instance:i}=await WebAssembly.instantiateStreaming(e.clone(),n);return wr.set(r.toString(),t),{instance:i,module:t}}}async function Er(n){return yr?(await(await t(async()=>{let{readFile:t}=await import(`./vite-browser-external-Cn0MOYvd.js`).then(t=>e(t.default,1));return{readFile:t}},__vite__mapDeps([0,1]))).readFile(n)).buffer:(Cr(n),(await Sr.get(n.toString())).clone().arrayBuffer())}var Dr=()=>{if(globalThis.crypto?.randomUUID)return globalThis.crypto.randomUUID();let e=new Uint8Array(16);if(globalThis.crypto?.getRandomValues)globalThis.crypto.getRandomValues(e);else for(let t=0;t<e.length;t++)e[t]=Math.floor(Math.random()*256);e[6]=e[6]&15|64,e[8]=e[8]&63|128;let t=[];return e.forEach(e=>{t.push(e.toString(16).padStart(2,`0`))}),t.slice(0,4).join(``)+`-`+t.slice(4,6).join(``)+`-`+t.slice(6,8).join(``)+`-`+t.slice(8,10).join(``)+`-`+t.slice(10).join(``)};function Or(e){let t;return t=e.startsWith(`"`)&&e.endsWith(`"`)?e.substring(1,e.length-1):e.toLowerCase(),t}function kr(e,t){try{let n=e.readdir(t).filter(e=>e!==`.`&&e!==`..`);for(let r of n){let n=t+`/`+r;try{e.readdir(n),kr(e,n)}catch{e.unlink(n)}}e.rmdir(t)}catch{try{e.unlink(t)}catch{}}}y();var Ar,jr,Mr,Nr,Pr,z,B,V,H,Fr,Ir,Lr,U,W,Rr,G,K,zr,Br,q,Vr,Hr,J,Ur,Wr=class e extends mr{constructor(e,t){super(),g(this,q),g(this,Ar),g(this,jr,0),g(this,Mr,!1),g(this,Nr,!1),g(this,Pr,!1),g(this,z,new EventTarget),g(this,B),g(this,V,!1),g(this,H),g(this,Fr),g(this,Ir),g(this,Lr),g(this,U),g(this,W),g(this,Rr),g(this,G,new Map),g(this,K,new Set),g(this,zr),g(this,Br,[]),_(this,H,e),_(this,B,_r.uuid()),_(this,zr,t?.extensions??{}),_(this,Ir,new Promise(e=>{h(this,H).addEventListener(`message`,t=>{if(t.data.type===`here`)e();else throw Error(`Invalid message`)},{once:!0})})),_(this,Lr,new Promise(e=>{let t=n=>{n.data.type===`ready`&&(_(this,Fr,n.data.id),h(this,H).removeEventListener(`message`,t),e())};h(this,H).addEventListener(`message`,t)})),_(this,Ar,v(this,q,Vr).call(this,t))}static async create(t,n){let r=new e(t,n);return await h(r,Ar),r}get waitReady(){return new Promise(e=>{h(this,Ar).then(()=>{h(this,V)?e():e(new Promise(e=>{h(this,z).addEventListener(`connected`,()=>{e()})}))})})}get debug(){return h(this,jr)}get ready(){return h(this,Mr)}get closed(){return h(this,Nr)}get isLeader(){return h(this,Pr)}async close(){var e;h(this,Nr)||(_(this,Nr,!0),h(this,U)?.close(),h(this,W)?.close(),(e=h(this,Rr))==null||e.call(this),h(this,H).terminate())}async[Symbol.asyncDispose](){await this.close()}async execProtocolRaw(e){return await v(this,q,J).call(this,`execProtocolRaw`,e)}async execProtocol(e){return await v(this,q,J).call(this,`execProtocol`,e)}async execProtocolStream(e){return await v(this,q,J).call(this,`execProtocolStream`,e)}async execProtocolRawStream(e,t){await v(this,q,J).call(this,`execProtocolRawStream`,e,t)}async syncToFs(){await v(this,q,J).call(this,`syncToFs`)}async listen(e,t,n){let r=_r.toPostgresName(e),i=n??this;return h(this,G).has(r)||h(this,G).set(r,new Set),h(this,G).get(r).add(t),await i.exec(`LISTEN ${e}`),async e=>{await this.unlisten(r,t,e)}}async unlisten(e,t,n){await this.waitReady;let r=n??this;t?h(this,G).get(e)?.delete(t):h(this,G).delete(e),h(this,G).get(e)?.size===0&&await r.exec(`UNLISTEN ${e}`)}onNotification(e){return h(this,K).add(e),()=>{h(this,K).delete(e)}}offNotification(e){h(this,K).delete(e)}async dumpDataDir(e){return await v(this,q,J).call(this,`dumpDataDir`,e)}onLeaderChange(e){return h(this,z).addEventListener(`leader-change`,e),()=>{h(this,z).removeEventListener(`leader-change`,e)}}offLeaderChange(e){h(this,z).removeEventListener(`leader-change`,e)}async _handleBlob(e){await v(this,q,J).call(this,`_handleBlob`,e)}async _getWrittenBlob(){return await v(this,q,J).call(this,`_getWrittenBlob`)}async _cleanupBlob(){await v(this,q,J).call(this,`_cleanupBlob`)}async _checkReady(){await this.waitReady}async _runExclusiveQuery(e){await v(this,q,J).call(this,`_acquireQueryLock`);try{return await e()}finally{await v(this,q,J).call(this,`_releaseQueryLock`)}}async _runExclusiveTransaction(e){await v(this,q,J).call(this,`_acquireTransactionLock`);try{return await e()}finally{await v(this,q,J).call(this,`_releaseTransactionLock`)}}};Ar=new WeakMap,jr=new WeakMap,Mr=new WeakMap,Nr=new WeakMap,Pr=new WeakMap,z=new WeakMap,B=new WeakMap,V=new WeakMap,H=new WeakMap,Fr=new WeakMap,Ir=new WeakMap,Lr=new WeakMap,U=new WeakMap,W=new WeakMap,Rr=new WeakMap,G=new WeakMap,K=new WeakMap,zr=new WeakMap,Br=new WeakMap,q=new WeakSet,Vr=async function(e={}){for(let[e,t]of Object.entries(h(this,zr))){if(t instanceof URL)throw Error(`URL extensions are not supported on the client side of a worker`);{let n=await t.setup(this,{},!0);if(n.emscriptenOpts&&console.warn(`PGlite extension ${e} returned emscriptenOpts, these are not supported on the client side of a worker`),n.namespaceObj){let t=this;t[e]=n.namespaceObj}n.bundlePath&&console.warn(`PGlite extension ${e} returned bundlePath, this is not supported on the client side of a worker`),n.init&&await n.init(),n.close&&h(this,Br).push(n.close)}}await h(this,Ir);let{extensions:t,...n}=e;h(this,H).postMessage({type:`init`,options:n}),await h(this,Lr);let r=`pglite-tab-close:${h(this,B)}`;_(this,Rr,await qr(r));let i=`pglite-broadcast:${h(this,Fr)}`;_(this,U,new BroadcastChannel(i));let a=`pglite-tab:${h(this,B)}`;_(this,W,new BroadcastChannel(a)),h(this,U).addEventListener(`message`,async e=>{e.data.type===`leader-here`?(_(this,V,!1),h(this,z).dispatchEvent(new Event(`leader-change`)),v(this,q,Hr).call(this)):e.data.type===`notify`&&v(this,q,Ur).call(this,e.data.channel,e.data.payload)}),h(this,W).addEventListener(`message`,async e=>{e.data.type===`connected`&&(_(this,V,!0),h(this,z).dispatchEvent(new Event(`connected`)),_(this,jr,await v(this,q,J).call(this,`getDebugLevel`)),_(this,Mr,!0))}),h(this,H).addEventListener(`message`,async e=>{e.data.type===`leader-now`&&(_(this,Pr,!0),h(this,z).dispatchEvent(new Event(`leader-change`)))}),v(this,q,Hr).call(this),this._initArrayTypes()},Hr=async function(){h(this,V)||(h(this,U).postMessage({type:`tab-here`,id:h(this,B)}),setTimeout(()=>v(this,q,Hr).call(this),16))},J=async function(e,...t){let n=_r.uuid(),r={type:`rpc-call`,callId:n,method:e,args:t};return h(this,W).postMessage(r),await new Promise((e,t)=>{let r=r=>{if(r.data.callId!==n)return;a();let i=r.data;if(i.type===`rpc-return`)e(i.result);else if(i.type===`rpc-error`){let e=Error(i.error.message);Object.assign(e,i.error),t(e)}else t(Error(`Invalid message`))},i=()=>{a(),t(new Kr)},a=()=>{h(this,W).removeEventListener(`message`,r),h(this,z).removeEventListener(`leader-change`,i)};h(this,z).addEventListener(`leader-change`,i),h(this,W).addEventListener(`message`,r)})},Ur=function(e,t){let n=h(this,G).get(e);if(n)for(let e of n)queueMicrotask(()=>e(t));for(let n of h(this,K))queueMicrotask(()=>n(e,t))};var Gr=Wr,Kr=class extends Error{constructor(){super(`Leader changed, pending operation in indeterminate state`)}};async function qr(e){let t;return await new Promise(n=>{navigator.locks.request(e,()=>new Promise(e=>{t=e,n()}))}),t}var Jr=`
insert into public.tables (label, seats, sort_order) select 'Mesa ' || n, 4, n from generate_series(1, 8) n;
insert into public.delivery_zones (name, fee_cents, min_order_cents, estimate_minutes, sort_order) values
  ('Centro (demo)', 500, 2000, 40, 1), ('Jardim América (demo)', 800, 3000, 50, 2), ('Vila Nova (demo)', 1000, 3000, 60, 3);
update public.store_settings set
  delivery_enabled = true,
  menu_notice = 'Demonstração — produtos e preços fictícios.',
  address = 'Endereço de demonstração', phone = '(00) 0000-0000', tagline = 'Espetaria — cardápio digital',
  opening_hours = '{"mon":[["11:00","23:00"]],"tue":[["11:00","23:00"]],"wed":[["11:00","23:00"]],"thu":[["11:00","23:00"]],"fri":[["11:00","02:00"]],"sat":[["11:00","02:00"]],"sun":[["11:00","22:00"]]}'
where id = 1;
`,Yr=`select c.relname as name from pg_publication_rel pr
  join pg_publication p on p.oid = pr.prpubid join pg_class c on c.oid = pr.prrelid
  where p.pubname = 'supabase_realtime'`;async function Xr(e){await e.exec(`
    alter table auth.users
      add column if not exists encrypted_password text,
      add column if not exists last_sign_in_at timestamptz,
      add column if not exists banned_until timestamptz,
      add column if not exists email_confirmed_at timestamptz default now();
    create table if not exists auth.dev_refresh_tokens (
      token text primary key,
      user_id uuid not null references auth.users (id) on delete cascade,
      created_at timestamptz not null default now()
    );
    create table if not exists private.dev_files (
      name text primary key,
      mime text not null,
      data bytea not null,
      created_at timestamptz not null default now()
    );
    create or replace function private.dev_notify_change() returns trigger language plpgsql as $$
    begin
      perform pg_notify('espeteks_dev_changes', json_build_object('table', tg_table_name, 'type', tg_op)::text);
      return null;
    end $$;
  `);let t=(await e.query(Yr)).rows.map(e=>e.name);for(let n of t)await e.exec(`
      drop trigger if exists dev_notify_${n} on public.${n};
      create trigger dev_notify_${n} after insert or update or delete on public.${n}
        for each statement execute function private.dev_notify_change();`)}async function Zr(e,t){let n=(await e.query(`select to_regclass('public.orders') is null as missing`)).rows[0].missing;n&&await e.exec(t.stubsSql);let r=[...t.migrations].sort((e,t)=>e.name.localeCompare(t.name));if(!(await e.query(`select to_regclass('supabase_migrations.schema_migrations') is not null as ok`)).rows[0].ok&&(await e.exec(`create schema if not exists supabase_migrations;
      create table supabase_migrations.schema_migrations (version text primary key, applied_at timestamptz default now());`),!n))for(let t of r.filter(e=>e.name<`20261013`))await e.query(`insert into supabase_migrations.schema_migrations (version) values ($1)`,[t.name]);let i=new Set((await e.query(`select version from supabase_migrations.schema_migrations`)).rows.map(e=>e.version));for(let n of r)i.has(n.name)||(await e.exec(n.sql),await e.query(`insert into supabase_migrations.schema_migrations (version) values ($1)`,[n.name]),t.log?.(`migração aplicada: ${n.name}`));if(await Xr(e),n){for(let n of t.users??[]){let r=await e.query(`insert into auth.users (email, encrypted_password, raw_user_meta_data) values ($1, $2, $3) returning id`,[n.email.toLowerCase(),await t.hashPassword(t.password??``),JSON.stringify({full_name:n.name})]);await e.query(`update public.profiles set role_key = $1, active = true, full_name = $2 where id = $3`,[n.role,n.name,r.rows[0].id])}t.seedSql&&await e.exec(t.seedSql),t.extraSql&&await e.exec(t.extraSql),t.log?.(`banco criado com migrações + dados de demonstração.`)}return{fresh:n}}var Y=class extends Error{status;body;constructor(e,t){super(String(t.message??`error`)),this.status=e,this.body=t}},X=/^[a-z_][a-z0-9_]*$/;async function Qr(e){let t=await e.query(`
    select c.relname as tbl, a.attname as col, format_type(a.atttypid, a.atttypmod) as type
    from pg_attribute a join pg_class c on c.oid = a.attrelid join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relkind in ('r', 'v') and a.attnum > 0 and not a.attisdropped`),n=new Map;for(let e of t.rows)n.has(e.tbl)||n.set(e.tbl,new Map),n.get(e.tbl).set(e.col,e.type);let r=await e.query(`
    select c.conname as name, cl.relname as tbl, rcl.relname as ref,
      array(select a.attname::text from unnest(c.conkey) with ordinality k(n, o)
            join pg_attribute a on a.attrelid = c.conrelid and a.attnum = k.n order by k.o) as cols,
      array(select a.attname::text from unnest(c.confkey) with ordinality k(n, o)
            join pg_attribute a on a.attrelid = c.confrelid and a.attnum = k.n order by k.o) as refcols
    from pg_constraint c
    join pg_class cl on cl.oid = c.conrelid join pg_namespace n on n.oid = cl.relnamespace
    join pg_class rcl on rcl.oid = c.confrelid join pg_namespace rn on rn.oid = rcl.relnamespace
    where c.contype = 'f' and n.nspname = 'public' and rn.nspname = 'public'`),i=await e.query(`
    select p.proname as name, p.proargnames as argnames,
      array(select format_type(t, null) from unnest(p.proargtypes) t) as argtypes
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public'`),a=new Map;for(let e of i.rows)a.set(e.name,(e.argtypes??[]).map((t,n)=>({name:e.argnames?.[n]??`arg${n}`,type:t})));return{columns:n,fks:r.rows.map(e=>({name:e.name,table:e.tbl,cols:e.cols,ref:e.ref,refCols:e.refcols})),functions:a}}async function $r(e,t,n){return e.transaction(async e=>(await e.exec(`set local role ${t.role}`),await e.query(`select set_config('request.jwt.claims', $1, true), set_config('request.headers', $2, true)`,[JSON.stringify(t.claims),JSON.stringify({"cf-connecting-ip":t.ip})]),n(e)))}function ei(e){let t=[],n=0,r=``,i=!1;for(let a of e)a===`"`&&(i=!i),!i&&a===`(`&&n++,!i&&a===`)`&&n--,!i&&a===`,`&&n===0?(t.push(r),r=``):r+=a;return r.trim()&&t.push(r),t.map(e=>e.trim()).filter(Boolean)}function ti(e){return ei(e.replace(/\s+/g,``)).map(e=>{if(e===`*`)return{kind:`star`};let t=e.indexOf(`(`);if(t>=0){let n=e.slice(0,t),r=e.slice(t+1,e.lastIndexOf(`)`)),i=null;n.includes(`:`)&&([i,n]=n.split(`:`));let[a,o=null]=n.split(`!`);return{kind:`embed`,rel:a,hint:o,alias:i??a,children:ti(r)}}let[n,r]=e.includes(`:`)?e.split(`:`):[e,e];return{kind:`col`,alias:n,name:r}})}var ni=0;function ri(e,t,n,r){let i=e.columns.get(t);if(!i)throw new Y(404,{code:`42P01`,message:`relation ${t} does not exist`});let a=[n.some(e=>e.kind===`star`)?`to_jsonb(${r})`:`'{}'::jsonb`];for(let o of n)if(o.kind===`col`){if(!i.has(o.name)||!X.test(o.alias))throw new Y(400,{code:`42703`,message:`column ${t}.${o.name} does not exist`});a.push(`jsonb_build_object('${o.alias}', ${r}."${o.name}")`)}else o.kind===`embed`&&a.push(`jsonb_build_object('${o.alias}', ${ii(e,t,o,r)})`);return a.join(` || `)}function ii(e,t,n,r){if(!X.test(n.rel)||!X.test(n.alias))throw new Y(400,{code:`PGRST100`,message:`invalid embed`});let i=e.fks.filter(e=>e.table===t&&e.ref===n.rel||e.table===n.rel&&e.ref===t);n.hint&&(i=i.filter(e=>e.name===n.hint||e.cols.includes(n.hint)));let a=i[0];if(!a)throw new Y(400,{code:`PGRST200`,message:`no relationship between ${t} and ${n.rel}`});let o=`t${++ni}`,s=ri(e,n.rel,n.children,o);if(a.table===t&&a.ref===n.rel){let e=a.cols.map((e,t)=>`${o}."${a.refCols[t]}" = ${r}."${e}"`).join(` and `);return`(select ${s} from public."${n.rel}" ${o} where ${e})`}let c=a.cols.map((e,t)=>`${o}."${e}" = ${r}."${a.refCols[t]}"`).join(` and `);return`coalesce((select jsonb_agg(${s}) from public."${n.rel}" ${o} where ${c}), '[]'::jsonb)`}function ai(e){return`{${e.map(e=>e===null?`NULL`:`"${String(e).replace(/\\/g,`\\\\`).replace(/"/g,`\\"`)}"`).join(`,`)}}`}function oi(e){return ei(e.replace(/^\(/,``).replace(/\)$/,``)).map(e=>e.replace(/^"(.*)"$/,`$1`))}function si(e,t,n,r,i,a){let o=e.columns.get(t)?.get(r);if(!o)throw new Y(400,{code:`42703`,message:`column ${t}.${r} does not exist`});let s=!1,c=i;c.startsWith(`not.`)&&(s=!0,c=c.slice(4));let l=c.indexOf(`.`),u=c.slice(0,l),d=c.slice(l+1),f=`${n}."${r}"`,p,m=e=>(a.push(e),`$${a.length}`);switch(u){case`eq`:p=`${f} = ${m(d)}::${o}`;break;case`neq`:p=`${f} <> ${m(d)}::${o}`;break;case`gt`:p=`${f} > ${m(d)}::${o}`;break;case`gte`:p=`${f} >= ${m(d)}::${o}`;break;case`lt`:p=`${f} < ${m(d)}::${o}`;break;case`lte`:p=`${f} <= ${m(d)}::${o}`;break;case`like`:p=`${f}::text like ${m(d.replace(/\*/g,`%`))}`;break;case`ilike`:p=`${f}::text ilike ${m(d.replace(/\*/g,`%`))}`;break;case`is`:if(![`null`,`true`,`false`].includes(d))throw new Y(400,{code:`PGRST100`,message:`invalid is`});p=`${f} is ${d}`;break;case`in`:p=`${f} = any(${m(ai(oi(d)))}::${o}[])`;break;default:throw new Y(400,{code:`PGRST100`,message:`operator ${u} not supported`})}return s?`not (${p})`:p}var ci=new Set([`select`,`order`,`limit`,`offset`,`columns`,`on_conflict`]);function li(e,t,n,r,i){let a=[];for(let[o,s]of r.entries())if(!ci.has(o)){if(o===`or`||o===`and`){let r=ei(s.replace(/^\(/,``).replace(/\)$/,``)).map(r=>{let a=r.indexOf(`.`);return si(e,t,n,r.slice(0,a),r.slice(a+1),i)});a.push(`(${r.join(o===`or`?` or `:` and `)})`)}else{if(!X.test(o))throw new Y(400,{code:`PGRST100`,message:`invalid filter`});a.push(si(e,t,n,o,s,i))}}return a.length?`where ${a.join(` and `)}`:``}function ui(e,t,n,r){return r?`order by ${r.split(`,`).map(r=>{let[i,...a]=r.split(`.`);if(!e.columns.get(t)?.has(i))throw new Y(400,{code:`42703`,message:`column ${i} does not exist`});return`${n}."${i}" ${a.includes(`desc`)?`desc`:`asc`}${a.includes(`nullsfirst`)?` nulls first`:a.includes(`nullslast`)?` nulls last`:``}`}).join(`, `)}`:``}function di(e,t){return e==null?null:t.endsWith(`[]`)&&Array.isArray(e)?ai(e):t===`jsonb`||t===`json`||typeof e==`object`?JSON.stringify(e):String(e)}async function fi(e,t,n,r,i,a,o,s){if(!X.test(i)||!t.columns.has(i))throw new Y(404,{code:`42P01`,message:`relation public.${i} does not exist`});let c=o.prefer??``,l=(o.accept??``).includes(`vnd.pgrst.object`),u=ti(a.get(`select`)??`*`),d=[];return $r(e,n,async e=>{if(r===`GET`||r===`HEAD`){let n=li(t,i,`t0`,a,d),o=a.get(`limit`)?`limit ${Number(a.get(`limit`))}`:``,s=a.get(`offset`)?`offset ${Number(a.get(`offset`))}`:``,f=r===`HEAD`?[]:(await e.query(`select ${ri(t,i,u,`t0`)} as j from public."${i}" t0 ${n} ${ui(t,i,`t0`,a.get(`order`))} ${o} ${s}`,d)).rows.map(e=>e.j),p={};if(c.includes(`count=exact`)){let t=await e.query(`select count(*)::int as n from public."${i}" t0 ${n}`,d);p[`content-range`]=`${f.length?`0-${f.length-1}`:`*`}/${t.rows[0].n}`}else p[`content-range`]=`${f.length?`0-${f.length-1}`:`*`}/*`;if(l){if(f.length!==1)throw new Y(406,{code:`PGRST116`,message:`JSON object requested, multiple (or no) rows returned`,details:`The result contains ${f.length} rows`});return{status:200,body:f[0],headers:p}}return{status:200,body:r===`HEAD`?void 0:f,headers:p}}let n=c.includes(`return=representation`),o=t.columns.get(i),f=n?`returning ${ri(t,i,u,`t0`)} as j`:``;if(r===`POST`){let t=Array.isArray(s)?s:[s],r=[];for(let n of t){let t=Object.keys(n);for(let e of t)if(!o.has(e))throw new Y(400,{code:`PGRST204`,message:`column ${e} not found`});let a=t.map(e=>di(n[e],o.get(e))),s=t.length?`insert into public."${i}" as t0 (${t.map(e=>`"${e}"`).join(`, `)}) values (${t.map((e,t)=>`$${t+1}::${o.get(e)}`).join(`, `)}) ${f}`:`insert into public."${i}" as t0 default values ${f}`,c=await e.query(s,a);r.push(...c.rows.map(e=>e.j))}return n?{status:201,body:l?r[0]:r}:{status:201}}if(r===`PATCH`){let r=s,c=Object.keys(r);for(let e of c)if(!o.has(e))throw new Y(400,{code:`PGRST204`,message:`column ${e} not found`});let u=c.map(e=>(d.push(di(r[e],o.get(e))),`"${e}" = $${d.length}::${o.get(e)}`)),p=li(t,i,`t0`,a,d),m=await e.query(`update public."${i}" as t0 set ${u.join(`, `)} ${p} ${f}`,d);if(!n)return{status:204};let ee=m.rows.map(e=>e.j);return{status:200,body:l?ee[0]:ee}}if(r===`DELETE`){let r=li(t,i,`t0`,a,d),o=await e.query(`delete from public."${i}" as t0 ${r} ${f}`,d);return n?{status:200,body:o.rows.map(e=>e.j)}:{status:204}}throw new Y(405,{code:`PGRST`,message:`method not allowed`})})}async function pi(e,t,n,r,i){let a=t.functions.get(r);if(!X.test(r)||!a)throw new Y(404,{code:`PGRST202`,message:`function public.${r} not found`});let o=[],s=[];for(let[e,t]of Object.entries(i??{})){let n=a.find(t=>t.name===e);if(!n)throw new Y(404,{code:`PGRST202`,message:`function public.${r}(${e}) not found`});o.push(di(t,n.type)),s.push(`"${e}" => $${o.length}::${n.type}`)}return $r(e,n,async e=>{let t=(await e.query(`select public."${r}"(${s.join(`, `)}) as result`,o)).rows[0]?.result;return{status:200,body:t===void 0||t===``?null:t instanceof Date?t.toISOString():t}})}function mi(e,t){if(e instanceof Y)return e;let n=e,r=n.code??`XX000`;return new Y(r===`42501`?t.role===`anon`?401:403:r===`23505`||r===`23503`?409:(r.startsWith(`P0`)||r.startsWith(`22`)||r.startsWith(`23`),400),{code:r,message:n.message??`erro`,details:n.detail??null,hint:n.hint??null})}function hi(e){let t=``;for(let n of e)t+=String.fromCharCode(n);return btoa(t).replace(/\+/g,`-`).replace(/\//g,`_`).replace(/=+$/,``)}function gi(e){let t=atob(e.replace(/-/g,`+`).replace(/_/g,`/`)+`===`.slice((e.length+3)%4));return Uint8Array.from(t,e=>e.charCodeAt(0))}var _i=e=>hi(new TextEncoder().encode(e));function vi(e=24){return hi(crypto.getRandomValues(new Uint8Array(e)))}async function yi(e){return crypto.subtle.importKey(`raw`,new TextEncoder().encode(e),{name:`HMAC`,hash:`SHA-256`},!1,[`sign`,`verify`])}async function bi(e,t){let n=`${_i(JSON.stringify({alg:`HS256`,typ:`JWT`}))}.${_i(JSON.stringify(t))}`;return`${n}.${hi(new Uint8Array(await crypto.subtle.sign(`HMAC`,await yi(e),new TextEncoder().encode(n))))}`}async function xi(e,t){let[n,r,i]=t.split(`.`);if(!n||!r||!i||!await crypto.subtle.verify(`HMAC`,await yi(e),gi(i),new TextEncoder().encode(`${n}.${r}`)))return null;let a=JSON.parse(new TextDecoder().decode(gi(r)));return typeof a.exp==`number`&&a.exp*1e3<Date.now()?null:a}var Z=e=>e?new Date(e).toISOString():null;function Si(e){return{id:e.id,aud:`authenticated`,role:`authenticated`,email:e.email,email_confirmed_at:Z(e.email_confirmed_at),confirmed_at:Z(e.email_confirmed_at),last_sign_in_at:Z(e.last_sign_in_at),phone:``,app_metadata:{provider:`email`,providers:[`email`]},user_metadata:e.raw_user_meta_data??{},identities:[],created_at:Z(e.created_at),updated_at:new Date().toISOString()}}var Ci=e=>!!(e.banned_until&&new Date(e.banned_until).getTime()>Date.now());function Q(e,t,n={}){return t===void 0||e===204?new Response(null,{status:e,headers:n}):new Response(JSON.stringify(t),{status:e,headers:{"Content-Type":`application/json; charset=utf-8`,...n}})}var $=(e,t,n)=>new Y(e,{code:e,error_code:t,msg:n,message:n});async function wi(e){let t=await e.text();if(!t)return{};try{return JSON.parse(t)}catch{throw new Y(400,{code:`PGRST102`,message:`Invalid JSON`})}}var Ti=[`image/jpeg`,`image/png`,`image/webp`];function Ei(e){let{db:t,meta:n}=e;async function r(e){return(await t.query(`select * from auth.users where id = $1`,[e])).rows[0]??null}async function i(t,n){let i=t.headers.get(`authorization`)??``,a=i.startsWith(`Bearer `)?i.slice(7):``;if(a.split(`.`).length===3){let t=await xi(e.jwtSecret,a);if(!t)throw new Y(401,{code:`PGRST301`,message:`JWT expired`});if(t.role===`authenticated`){let e=await r(String(t.sub));if(!e||Ci(e))throw new Y(401,{code:`PGRST301`,message:`JWT invalid`});return{role:`authenticated`,claims:t,ip:n}}}return{role:`anon`,claims:{role:`anon`},ip:n}}async function a(n){let r=3600,i=Math.floor(Date.now()/1e3)+r,a=await bi(e.jwtSecret,{sub:n.id,email:n.email,role:`authenticated`,aud:`authenticated`,exp:i,session_id:crypto.randomUUID()}),o=vi();return await t.query(`insert into auth.dev_refresh_tokens (token, user_id) values ($1, $2)`,[o,n.id]),await t.query(`update auth.users set last_sign_in_at = now() where id = $1`,[n.id]),{access_token:a,token_type:`bearer`,expires_in:r,expires_at:i,refresh_token:o,user:Si(n)}}async function o(n,o,s){let c=o.pathname.replace(/^.*\/auth\/v1/,``);if(c===`/token`){let i=await wi(n),s=null;if(o.searchParams.get(`grant_type`)===`password`){if(s=(await t.query(`select * from auth.users where lower(email) = lower($1)`,[String(i.email??``)])).rows[0]??null,!s||!await e.verifyPassword(String(i.password??``),s.encrypted_password))throw $(400,`invalid_credentials`,`Invalid login credentials`)}else if(o.searchParams.get(`grant_type`)===`refresh_token`){let e=await t.query(`delete from auth.dev_refresh_tokens where token = $1 returning user_id`,[String(i.refresh_token??``)]);if(!e.rows[0])throw $(400,`refresh_token_not_found`,`Invalid Refresh Token: Refresh Token Not Found`);s=await r(e.rows[0].user_id)}if(!s)throw $(400,`invalid_grant`,`invalid grant`);if(Ci(s))throw $(400,`user_banned`,`User is banned`);return Q(200,await a(s))}let l=await i(n,s).catch(()=>null),u=l?.role===`authenticated`?String(l.claims.sub):null;if(c===`/user`&&n.method===`GET`){let e=u?await r(u):null;if(!e)throw $(401,`bad_jwt`,`invalid JWT`);return Q(200,Si(e))}if(c===`/user`&&n.method===`PUT`){let i=u?await r(u):null;if(!i)throw $(401,`bad_jwt`,`invalid JWT`);let a=await wi(n);if(typeof a.password==`string`){if(a.password.length<10)throw $(422,`weak_password`,`Password should be at least 10 characters.`);if(await e.verifyPassword(a.password,i.encrypted_password))throw $(422,`same_password`,`New password should be different from the old password.`);await t.query(`update auth.users set encrypted_password = $1 where id = $2`,[await e.hashPassword(a.password),i.id])}return Q(200,Si(await r(i.id)))}if(c===`/logout`)return u&&await t.query(`delete from auth.dev_refresh_tokens where user_id = $1`,[u]),Q(204);if(c===`/recover`)return e.log?.(`recuperação de senha solicitada (e-mail não é enviado no emulador).`),Q(200,{});throw $(404,`not_found`,`not found`)}async function s(n,r,a){let o=r.pathname.match(/\/storage\/v1\/object\/public\/menu-images\/(.+)$/);if(o&&n.method===`GET`){let t=await e.storage.read(decodeURIComponent(o[1]));return t?new Response(t.body,{status:200,headers:{"Content-Type":t.type,"Cache-Control":`public, max-age=3600`}}):Q(404,{message:`Object not found`})}let s=r.pathname.match(/\/storage\/v1\/object\/menu-images\/(.+)$/);if(s&&n.method===`POST`){let r=decodeURIComponent(s[1]);if(!/^[a-z]+\/[A-Za-z0-9._-]+$/.test(r))throw new Y(400,{message:`invalid key`});let o=await i(n,a),c=[...(await n.formData()).values()].find(e=>typeof e!=`string`);if(!c)throw new Y(400,{message:`missing file`});if(!Ti.includes(c.type)||c.size>5242880)throw new Y(400,{message:`invalid mime type or size`});return await $r(t,o,e=>e.query(`insert into storage.objects (bucket_id, name, owner) values ('menu-images', $1, auth.uid())`,[r])).catch(e=>{throw new Y(403,{statusCode:`403`,error:`Unauthorized`,message:e.message})}),await e.storage.save(r,c),Q(200,{Key:`menu-images/${r}`,Id:crypto.randomUUID()})}throw new Y(404,{message:`not found`})}async function c(r,a){let o=(e,t,n)=>Q(e,{error:{code:t,detail:n}}),s=await i(r,a).catch(()=>null);if(!s||s.role!==`authenticated`)return o(401,`UNAUTHORIZED`,`Sessão ausente.`);let c=await $r(t,s,async e=>(await e.query(`select public.my_access() as a`)).rows[0].a);if(!c.active||!c.permissions.includes(`staff.manage`))return o(403,`FORBIDDEN`,`Você não tem permissão para gerenciar funcionários.`);let l=await wi(r),u=(e,r)=>pi(t,n,s,e,r);if(l.action===`list`)return Q(200,{users:(await t.query(`select * from auth.users order by created_at`)).rows.map(e=>({id:e.id,email:e.email,last_sign_in_at:Z(e.last_sign_in_at),email_confirmed_at:Z(e.email_confirmed_at),banned_until:Z(e.banned_until),created_at:Z(e.created_at)}))});if(l.action===`create`){let n=String(l.email??``).trim().toLowerCase(),r=String(l.role_key??``);if(!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(n))return o(400,`INVALID_INPUT`,`E-mail inválido.`);if(r===`admin`&&c.role_key!==`admin`)return o(403,`FORBIDDEN`,`Somente administradores podem criar administradores.`);if((await t.query(`select 1 from auth.users where lower(email) = $1`,[n])).rows.length)return o(409,`ALREADY_EXISTS`,`Já existe uma conta com este e-mail.`);let i=l.password?String(l.password):vi(9),a=(await t.query(`insert into auth.users (email, encrypted_password, raw_user_meta_data) values ($1, $2, $3) returning id`,[n,await e.hashPassword(i),JSON.stringify({full_name:String(l.full_name??``)})])).rows[0].id;try{await u(`set_staff_access`,{p_user_id:a,p_role_key:r,p_active:!0,p_full_name:String(l.full_name??``)})}catch(e){await t.query(`update auth.users set banned_until = 'infinity' where id = $1`,[a]);let n=mi(e,s);return o(400,String(n.body.message),String(n.body.details??`Falha ao definir o cargo.`))}return l.password||e.log?.(`convite simulado para ${n} (e-mail não é enviado no emulador).`),Q(200,{user_id:a,invited:!l.password})}if(l.action===`set_active`){let e=await t.query(`select role_key from public.profiles where id = $1`,[String(l.user_id)]);if(!e.rows[0])return o(404,`NOT_FOUND`,`Funcionário não encontrado.`);try{await u(`set_staff_access`,{p_user_id:l.user_id,p_role_key:l.role_key??e.rows[0].role_key,p_active:l.active===!0})}catch(e){let t=mi(e,s);return o(400,String(t.body.message),String(t.body.details??`Operação recusada.`))}return await t.query(`update auth.users set banned_until = $1 where id = $2`,[l.active===!0?null:`infinity`,String(l.user_id)]),Q(200,{ok:!0})}return l.action===`reset_password`?(e.log?.(`redefinição de senha simulada (e-mail não é enviado no emulador).`),Q(200,{ok:!0})):o(400,`INVALID_INPUT`,`Ação desconhecida.`)}return async function(r,a=`127.0.0.1`){let l=new URL(r.url),u={role:`anon`,claims:{},ip:a};try{if(l.pathname.includes(`/auth/v1/`))return await o(r,l,a);if(l.pathname.includes(`/storage/v1/`))return await s(r,l,a);if(l.pathname.endsWith(`/functions/v1/admin-users`))return await c(r,a);if(l.pathname.endsWith(`/health`))return Q(200,{ok:!0});u=await i(r,a);let e=l.pathname.match(/\/rest\/v1\/rpc\/([a-z_0-9]+)$/);if(e){let i=await pi(t,n,u,e[1],await wi(r));return Q(i.status,i.body,i.headers)}let d=l.pathname.match(/\/rest\/v1\/([a-z_0-9]+)$/);if(d){let e={};r.headers.forEach((t,n)=>e[n]=t);let i=r.method===`GET`||r.method===`HEAD`?``:await r.text(),a=await fi(t,n,u,r.method,d[1],l.searchParams,e,i?JSON.parse(i):void 0);return Q(a.status,r.method===`HEAD`?void 0:a.body,a.headers)}return Q(404,{message:`not found`})}catch(t){let n=mi(t,u);return n.status>=500&&e.log?.(String(t)),Q(n.status,n.body)}}}var Di=`-- =============================================================================
-- DADOS DE DEMONSTRAÇÃO (opcional). NÃO são produtos/preços reais da Espeteks.
-- Todos marcados com is_demo = true e removíveis em Cardápio > "Remover dados de demonstração".
-- Uso em produção: NÃO aplicar (ou aplicar só para treinamento e remover depois).
-- =============================================================================

insert into public.categories (name, description, sort_order, is_demo) values
  ('Espetos bovinos',          'Itens de demonstração',  10, true),
  ('Espetos de frango',        'Itens de demonstração',  20, true),
  ('Espetos suínos',           'Itens de demonstração',  30, true),
  ('Espetos especiais',        'Itens de demonstração',  40, true),
  ('Queijos e acompanhamentos','Itens de demonstração',  50, true),
  ('Porções',                  'Itens de demonstração',  60, true),
  ('Bebidas',                  'Itens de demonstração',  70, true),
  ('Combos',                   'Itens de demonstração',  80, true);

with c as (select id, name from public.categories where is_demo)
insert into public.products (category_id, name, description, price_cents, featured, requires_kitchen, sort_order, is_demo)
select c.id, p.name, p.description, p.price_cents, p.featured, p.kitchen, p.sort, true
from c join (values
  ('Espetos bovinos',          'Alcatra (demo)',            'Exemplo de produto — preço fictício.', 1400, true,  true, 1),
  ('Espetos bovinos',          'Fraldinha (demo)',          'Exemplo de produto — preço fictício.', 1500, false, true, 2),
  ('Espetos bovinos',          'Kafta (demo)',              'Exemplo de produto — preço fictício.', 1200, false, true, 3),
  ('Espetos de frango',        'Coração (demo)',            'Exemplo de produto — preço fictício.', 1100, true,  true, 1),
  ('Espetos de frango',        'Frango com bacon (demo)',   'Exemplo de produto — preço fictício.', 1200, false, true, 2),
  ('Espetos suínos',           'Linguiça toscana (demo)',   'Exemplo de produto — preço fictício.', 1000, false, true, 1),
  ('Espetos suínos',           'Panceta (demo)',            'Exemplo de produto — preço fictício.', 1300, false, true, 2),
  ('Espetos especiais',        'Medalhão (demo)',           'Exemplo de produto — preço fictício.', 1800, true,  true, 1),
  ('Queijos e acompanhamentos','Queijo coalho (demo)',      'Exemplo de produto — preço fictício.', 1000, false, true, 1),
  ('Queijos e acompanhamentos','Pão de alho (demo)',        'Exemplo de produto — preço fictício.',  800, false, true, 2),
  ('Porções',                  'Mandioca frita (demo)',     'Exemplo de produto — preço fictício.', 2500, false, true, 1),
  ('Bebidas',                  'Refrigerante lata (demo)',  'Exemplo de produto — preço fictício.',  600, false, false, 1),
  ('Bebidas',                  'Água mineral (demo)',       'Exemplo de produto — preço fictício.',  400, false, false, 2),
  ('Combos',                   'Combo da casa (demo)',      'Exemplo com opções de tamanho.',          0, true,  true, 1)
) as p(category, name, description, price_cents, featured, kitchen, sort) on p.category = c.name;

-- variações do combo
insert into public.product_variants (product_id, name, price_cents, sort_order)
select p.id, v.name, v.price, v.sort
from public.products p, (values ('Individual', 3500, 1), ('Para dois', 6500, 2)) v(name, price, sort)
where p.is_demo and p.name = 'Combo da casa (demo)';
update public.products set price_cents = 3500 where is_demo and name = 'Combo da casa (demo)';

-- adicionais
insert into public.add_ons (name, price_cents, is_demo, sort_order) values
  ('Farofa (demo)', 200, true, 1),
  ('Vinagrete (demo)', 300, true, 2),
  ('Molho de alho (demo)', 200, true, 3);

insert into public.product_add_ons (product_id, add_on_id, max_quantity)
select p.id, a.id, case when a.name like 'Farofa%' then 2 else 1 end
from public.products p cross join public.add_ons a
where p.is_demo and a.is_demo and p.requires_kitchen and p.name not like 'Combo%';

-- custos de exemplo (para o relatório de margem)
insert into public.product_costs (product_id, cost_cents)
select id, (price_cents * 0.45)::int from public.products where is_demo and price_cents > 0;
`,Oi=`-- Stubs mínimos do ambiente Supabase para rodar as migrações reais no PGlite (testes).
-- Reproduz: roles anon/authenticated/service_role, auth.users, auth.uid() a partir de
-- request.jwt.claims (como o PostgREST faz), schema storage com buckets/objects e
-- storage.foldername(). NÃO é usado em produção.

create role anon nologin noinherit;
create role authenticated nologin noinherit;
create role service_role nologin noinherit bypassrls;

create schema auth;
create table auth.users (
  id uuid primary key default gen_random_uuid(),
  email text unique,
  raw_user_meta_data jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create function auth.uid() returns uuid
language sql stable
as $$
  select nullif(
    coalesce(current_setting('request.jwt.claim.sub', true),
             (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub')),
    '')::uuid
$$;

create function auth.jwt() returns jsonb
language sql stable
as $$
  select coalesce(nullif(current_setting('request.jwt.claims', true), ''), '{}')::jsonb
$$;

grant usage on schema auth to anon, authenticated, service_role;
grant execute on all functions in schema auth to anon, authenticated, service_role;

create schema storage;
create table storage.buckets (
  id text primary key,
  name text not null,
  public boolean default false,
  file_size_limit bigint,
  allowed_mime_types text[]
);
create table storage.objects (
  id uuid primary key default gen_random_uuid(),
  bucket_id text references storage.buckets (id),
  name text not null,
  owner uuid,
  created_at timestamptz default now()
);
alter table storage.objects enable row level security;
create function storage.foldername(name text) returns text[]
language plpgsql immutable
as $$
declare
  _parts text[];
begin
  select string_to_array(name, '/') into _parts;
  return _parts[1 : array_length(_parts, 1) - 1];
end
$$;
grant usage on schema storage to anon, authenticated, service_role;
grant select, insert, update, delete on storage.objects to authenticated;
grant select on storage.buckets to anon, authenticated;

create schema extensions;
`,ki=`espeteks-demo-v1`,Ai=`espeteks-demo:db`,ji=typeof BroadcastChannel>`u`?null:new BroadcastChannel(`espeteks-demo`);function Mi(){try{return localStorage.getItem(Ai)??ki}catch{return ki}}ji?.addEventListener(`message`,e=>{e.data?.type===`reset`&&window.location.assign(`/espeteks/`)});var Ni=Object.assign({"../../supabase/migrations/20261012000100_core_schema.sql":a,"../../supabase/migrations/20261012000200_auth_permissions.sql":o,"../../supabase/migrations/20261012000300_business_logic.sql":s,"../../supabase/migrations/20261012000400_rls_policies.sql":c,"../../supabase/migrations/20261012000500_realtime_storage.sql":l,"../../supabase/migrations/20261012000600_reports.sql":u,"../../supabase/migrations/20261013000700_service_requests_ratings.sql":d,"../../supabase/migrations/20261013000800_branding.sql":f});async function Pi(e,t){let n=await crypto.subtle.importKey(`raw`,new TextEncoder().encode(e),`PBKDF2`,!1,[`deriveBits`]);return new Uint8Array(await crypto.subtle.deriveBits({name:`PBKDF2`,salt:t,iterations:6e4,hash:`SHA-256`},n,256))}var Fi=e=>[...e].map(e=>e.toString(16).padStart(2,`0`)).join(``),Ii=e=>Uint8Array.from(e.match(/../g)??[],e=>parseInt(e,16));async function Li(e){let t=crypto.getRandomValues(new Uint8Array(16));return`pbkdf2$${Fi(t)}$${Fi(await Pi(e,t))}`}async function Ri(e,t){if(!t?.startsWith(`pbkdf2$`))return!1;let[,n,r]=t.split(`$`);return Fi(await Pi(e,Ii(n)))===r}var zi=new Set,Bi=null;function Vi(e){return Bi??=Hi(e),Bi}async function Hi(e){e?.(`Iniciando o banco de dados…`);let t=Mi(),a=await Gr.create(new Worker(new URL(`/espeteks/assets/pglite.worker-CGeoahlW.js`,``+import.meta.url),{type:`module`}),{dataDir:`idb://${t}`});Gi(t),await navigator.locks.request(`espeteks-demo-init`,async()=>{e?.(`Preparando cardápio e permissões…`),await Zr(a,{stubsSql:Oi,migrations:Object.entries(Ni).map(([e,t])=>({name:e.split(`/`).pop(),sql:t})),seedSql:Di,extraSql:`${Jr}
        update public.store_settings set public_order_limit_per_10min = 200, max_pending_orders_per_table = 20,
          enforce_opening_hours = false where id = 1;`,users:n,password:i,hashPassword:Li})});let o=await a.query(`select name, mime, data from private.dev_files`);for(let e of o.rows)r(e.name,new Blob([e.data],{type:e.mime}));let s=Ei({db:a,meta:await Qr(a),jwtSecret:`espeteks-demo-somente-no-navegador`,hashPassword:Li,verifyPassword:Ri,storage:{async save(e,t){let n=new Uint8Array(await t.arrayBuffer());await a.query(`insert into private.dev_files (name, mime, data) values ($1, $2, $3)
           on conflict (name) do update set mime = excluded.mime, data = excluded.data`,[e,t.type,n]),r(e,t)},async read(e){let t=await a.query(`select mime, data from private.dev_files where name = $1`,[e]);return t.rows[0]?{body:t.rows[0].data,type:t.rows[0].mime}:null}},log:e=>console.warn(`[demo] ${e}`)});return await a.listen(`espeteks_dev_changes`,e=>{try{let{table:t}=JSON.parse(e);zi.forEach(e=>e(t))}catch{}}),{handle:s,pg:a}}async function Ui(e,t){let{handle:n}=await Vi();return n(new Request(e,t),`demo-browser`)}function Wi(e){return zi.add(e),()=>zi.delete(e)}async function Gi(e){try{let t=await indexedDB.databases();for(let{name:n}of t)n?.startsWith(`/pglite/${ki}`)&&n!==`/pglite/${e}`&&indexedDB.deleteDatabase(n)}catch{}}async function Ki(){try{await(await Bi)?.pg.close()}catch{}try{for(let e of Object.keys(localStorage))(e.startsWith(`sb-`)||e.startsWith(`espeteks:`))&&localStorage.removeItem(e);localStorage.setItem(Ai,`${ki}-${Date.now().toString(36)}`),sessionStorage.clear()}catch{}ji?.postMessage({type:`reset`})}export{Ui as demoFetch,Vi as initDemo,Wi as onDemoChange,Ki as resetDemo};