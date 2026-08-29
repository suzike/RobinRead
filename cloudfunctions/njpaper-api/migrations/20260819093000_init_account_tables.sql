-- RobinRead 账号与会员：初始表结构（users / orders / membership_events）
-- member_until 约定：NULL=未购买 | 'lifetime'=终身 | ISO 字符串=月卡到期
-- 安全：开启 RLS 且零策略 + 收回 anon/authenticated 权限 → 仅服务端（API Key=service_role）可访问
CREATE TABLE users (
  id            TEXT PRIMARY KEY,
  unionid       TEXT UNIQUE NOT NULL,
  openid        TEXT NOT NULL,
  nickname      TEXT,
  avatar_url    TEXT,
  member_until  TEXT,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE orders (
  out_trade_no  TEXT PRIMARY KEY,
  user_id       TEXT NOT NULL,
  plan          TEXT NOT NULL CHECK (plan IN ('monthly', 'lifetime')),
  amount_fen    INTEGER NOT NULL,
  status        TEXT NOT NULL DEFAULT 'created' CHECK (status IN ('created', 'paid', 'closed', 'refunded')),
  channel       TEXT NOT NULL DEFAULT 'wxpay_native',
  transaction_id TEXT,
  paid_at       TIMESTAMPTZ,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_orders_status_created ON orders (status, created_at);
CREATE INDEX idx_orders_user ON orders (user_id);

CREATE TABLE membership_events (
  id                   TEXT PRIMARY KEY,
  user_id              TEXT NOT NULL,
  out_trade_no         TEXT,
  type                 TEXT NOT NULL,
  member_until_before  TEXT,
  member_until_after   TEXT,
  created_at           TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_events_user ON membership_events (user_id);

ALTER TABLE users ENABLE ROW LEVEL SECURITY;
ALTER TABLE orders ENABLE ROW LEVEL SECURITY;
ALTER TABLE membership_events ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON users, orders, membership_events FROM anon, authenticated;
