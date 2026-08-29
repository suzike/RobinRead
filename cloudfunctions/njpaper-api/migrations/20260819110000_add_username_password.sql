-- 账号密码登录：users 增加 username + password_hash
-- unionid/openid 改为可空 —— 账号密码用户没有微信标识；微信用户不受影响
ALTER TABLE users ADD COLUMN username TEXT;
ALTER TABLE users ADD COLUMN password_hash TEXT;
CREATE UNIQUE INDEX idx_users_username ON users (username) WHERE username IS NOT NULL;
ALTER TABLE users ALTER COLUMN unionid DROP NOT NULL;
ALTER TABLE users ALTER COLUMN openid DROP NOT NULL;
