-- Remove seeded users 希姆 and 方良
DELETE FROM drafts WHERE username IN ('希姆', '方良');
DELETE FROM availability WHERE username IN ('希姆', '方良');
DELETE FROM users WHERE username IN ('希姆', '方良');
