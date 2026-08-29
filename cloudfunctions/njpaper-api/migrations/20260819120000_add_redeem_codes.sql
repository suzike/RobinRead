-- 激活码兑换：redeem_codes 表（月卡 / 终身；status 状态机 unused→redeemed）
-- 安全：RLS 开启 + 零策略 + 收回 anon/authenticated → 仅服务端（API Key=service_role）可访问
CREATE TABLE public.redeem_codes (
  code         TEXT PRIMARY KEY,
  plan         TEXT NOT NULL CHECK (plan IN ('monthly', 'lifetime')),
  status       TEXT NOT NULL DEFAULT 'unused' CHECK (status IN ('unused', 'redeemed', 'disabled')),
  redeemed_by  TEXT,
  redeemed_at  TIMESTAMPTZ,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.redeem_codes ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.redeem_codes FROM anon, authenticated;
