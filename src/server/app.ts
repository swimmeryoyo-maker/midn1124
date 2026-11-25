import { Hono } from 'hono';
import { getCookie, setCookie, deleteCookie } from 'hono/cookie';
import {
  createSessionToken,
  hashPassword,
  verifyPassword,
  verifySessionToken,
  type SessionPayload,
} from '../lib/auth';
import {
  getAvailabilityForWeek,
  getMemberList,
  getProjects,
  getSegmentDistribution,
} from '../lib/db';
import {
  formatTwFull,
  formatTwIso,
  formatTwShort,
  formatTwTimeOnly,
  getWeekDates,
  getWeekKey,
  getWeekOffset,
} from '../lib/time';

export type AppEnv = {
  Bindings: Env;
  Variables: {
    user: SessionPayload;
  };
};

const SESSION_COOKIE = 'stagesync_session';

function parseNamesList(val: unknown): string[] {
  if (Array.isArray(val)) {
    return val.map((x) => String(x).trim()).filter(Boolean);
  }
  if (typeof val === 'string') {
    return val
      .replace(/、/g, ',')
      .split(',')
      .map((x) => x.trim())
      .filter(Boolean);
  }
  return [];
}

function getTimeMeta() {
  const thisWeek = getWeekDates(0);
  const nextWeek = getWeekDates(1);
  return {
    twFull: formatTwFull(),
    twShort: formatTwShort(),
    twTimeOnly: formatTwTimeOnly(),
    thisWeekRange: `${thisWeek[0].slice(5)}～${thisWeek[6].slice(5)}`,
    nextWeekRange: `${nextWeek[0].slice(5)}～${nextWeek[6].slice(5)}`,
    thisWeekDates: thisWeek,
    nextWeekDates: nextWeek,
  };
}

export const app = new Hono<AppEnv>().basePath('/api');

app.get('/health', async (c) => {
  try {
    await c.env.DB.prepare('SELECT 1').first();
    return c.json({ ok: true, db: 'connected', time: formatTwFull() });
  } catch (err) {
    return c.json({ ok: false, error: String(err) }, 500);
  }
});

app.get('/meta/time', (c) => {
  return c.json(getTimeMeta());
});

// Auth endpoints
app.post('/auth/login', async (c) => {
  const body = await c.req.json<{
    username?: string;
    password?: string;
    loginType?: string;
  }>();

  const username = (body.username || '').trim();
  const password = (body.password || '').trim();
  const loginType = body.loginType || '一般登入';

  if (!username || !password) {
    return c.json({ ok: false, error: '密碼或名稱錯誤' }, 400);
  }

  const user = await c.env.DB.prepare(
    'SELECT username, password_hash, role FROM users WHERE username = ?'
  )
    .bind(username)
    .first<{ username: string; password_hash: string; role: 'admin' | 'user' }>();

  if (!user || !(await verifyPassword(password, user.password_hash))) {
    return c.json({ ok: false, error: '密碼或名稱錯誤' }, 401);
  }

  if (loginType === '管理者登入' && user.role !== 'admin') {
    return c.json({ ok: false, error: '密碼或名稱錯誤' }, 403);
  }

  const token = await createSessionToken(
    { username: user.username, role: user.role },
    c.env.SESSION_SECRET
  );
  setCookie(c, SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: 'Lax',
    path: '/',
    maxAge: 60 * 60 * 24 * 14,
  });

  return c.json({
    ok: true,
    message: `✅ ${user.username} 登入成功！`,
    user: { username: user.username, role: user.role },
  });
});

app.post('/auth/register', async (c) => {
  const body = await c.req.json<{
    username?: string;
    password?: string;
  }>();

  const username = (body.username || '').trim();
  const password = (body.password || '').trim();

  if (!username || !password) {
    return c.json({ ok: false, error: '密碼或名稱錯誤' }, 400);
  }

  const existing = await c.env.DB.prepare('SELECT username FROM users WHERE username = ?')
    .bind(username)
    .first();

  if (existing) {
    return c.json(
      { ok: false, error: '⚠️ 此姓名已註冊過，請直接點擊「🚀 登入系統」！' },
      409
    );
  }

  const passwordHash = await hashPassword(password);
  const nowIso = formatTwIso();

  await c.env.DB.prepare(
    'INSERT INTO users (username, password_hash, role, created_at) VALUES (?, ?, ?, ?)'
  )
    .bind(username, passwordHash, 'user', nowIso)
    .run();

  const token = await createSessionToken(
    { username, role: 'user' },
    c.env.SESSION_SECRET
  );
  setCookie(c, SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: 'Lax',
    path: '/',
    maxAge: 60 * 60 * 24 * 14,
  });

  return c.json({
    ok: true,
    message: '註冊完成',
    user: { username, role: 'user' },
  });
});

app.post('/auth/logout', (c) => {
  deleteCookie(c, SESSION_COOKIE, { path: '/' });
  return c.json({ ok: true });
});

app.get('/auth/me', async (c) => {
  const token = getCookie(c, SESSION_COOKIE);
  const session = await verifySessionToken(token, c.env.SESSION_SECRET);
  if (!session) {
    return c.json({ ok: false, user: null }, 401);
  }
  return c.json({
    ok: true,
    user: { username: session.username, role: session.role },
  });
});

// Auth middleware for all protected routes below
const PUBLIC_PATHS = new Set([
  '/api/health',
  '/api/meta/time',
  '/api/auth/login',
  '/api/auth/register',
  '/api/auth/logout',
  '/api/auth/me',
]);

app.use('/*', async (c, next) => {
  if (PUBLIC_PATHS.has(c.req.path)) {
    return next();
  }

  const token = getCookie(c, SESSION_COOKIE);
  const session = await verifySessionToken(token, c.env.SESSION_SECRET);
  if (!session) {
    return c.json({ ok: false, error: '⚠️ 請先登入' }, 401);
  }
  c.set('user', session);
  return next();
});

// Bootstrap full state
app.get('/bootstrap', async (c) => {
  const user = c.get('user');
  const category = c.req.query('category') || '全部';
  const weekType = c.req.query('weekType') || '下週調查表';
  const distWeekType = c.req.query('distWeekType') || '下週調查表';
  const selectedProjectId = c.req.query('projectId') || '';

  const [members, todosRow, projects, availData, draftRows] = await Promise.all([
    getMemberList(c.env.DB),
    c.env.DB.prepare("SELECT value FROM settings WHERE key = 'todos'").first<{
      value: string;
    }>(),
    getProjects(c.env.DB, category),
    getAvailabilityForWeek(c.env.DB, weekType),
    c.env.DB.prepare('SELECT draft_type, payload FROM drafts WHERE username = ?')
      .bind(user.username)
      .all<{ draft_type: string; payload: string }>(),
  ]);

  const drafts: Record<string, unknown> = {};
  for (const row of draftRows.results) {
    try {
      drafts[row.draft_type] = JSON.parse(row.payload);
    } catch {
      // ignore malformed draft
    }
  }

  const targetProjId =
    selectedProjectId && projects.some((p) => p.id === selectedProjectId)
      ? selectedProjectId
      : projects[0]?.id || '';

  const distribution = targetProjId
    ? await getSegmentDistribution(c.env.DB, targetProjId, distWeekType)
    : [];

  const mySubmitted = availData.records.find((r) => r.username === user.username);
  const availDraft = drafts.avail_draft as
    | { days?: string[]; absent?: boolean; note?: string }
    | undefined;

  const myAvailForm = mySubmitted
    ? {
        days: mySubmitted.days.filter((d) => availData.weekDates.includes(d)),
        absent: mySubmitted.absent,
        note: mySubmitted.note,
        hasSubmitted: true,
      }
    : availDraft
      ? {
          days: (availDraft.days || []).filter((d) => availData.weekDates.includes(d)),
          absent: Boolean(availDraft.absent),
          note: availDraft.note || '',
          hasSubmitted: false,
        }
      : { days: [], absent: false, note: '', hasSubmitted: false };

  return c.json({
    ok: true,
    user: { username: user.username, role: user.role },
    time: getTimeMeta(),
    members,
    todos: todosRow?.value ?? '',
    projects,
    selectedProjectId: targetProjId,
    distribution,
    availability: availData,
    myAvailForm,
    projectDraft: drafts.project_draft ?? null,
  });
});

// Todos
app.put('/todos', async (c) => {
  const body = await c.req.json<{ todos?: string }>();
  const todos = body.todos ?? '';
  const nowIso = formatTwIso();

  await c.env.DB.prepare(
    `INSERT INTO settings (key, value, updated_at) VALUES ('todos', ?, ?)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`
  )
    .bind(todos, nowIso)
    .run();

  return c.json({
    ok: true,
    message: `✅ [${formatTwTimeOnly()}] 已同步更新！`,
  });
});

// Projects
app.get('/projects', async (c) => {
  const category = c.req.query('category') || '全部';
  const projects = await getProjects(c.env.DB, category);
  return c.json({ ok: true, projects });
});

app.post('/projects', async (c) => {
  const user = c.get('user');
  const body = await c.req.json<{
    category?: string;
    title?: string;
    main_leader?: string;
    sub_leader?: string;
    song?: string;
    members?: string[] | string;
    shoot_date?: string;
    stick_info?: string;
    a_melo?: string[] | string;
    b_melo?: string[] | string;
    c_melo?: string[] | string;
    last?: string[] | string;
  }>();

  const title = (body.title || '').trim();
  const mainLeader = (body.main_leader || '').trim();
  const category = (body.category || '企劃').trim();

  if (!title || !mainLeader) {
    return c.json({ ok: false, error: '❌ 「名稱」與「總負責人」為必填！' }, 400);
  }

  const { results: existingIds } = await c.env.DB.prepare(
    'SELECT id, sort_order FROM projects'
  ).all<{ id: string; sort_order: number }>();

  let maxNum = 0;
  let maxOrder = 0;
  for (const row of existingIds) {
    if (row.id.startsWith('P')) {
      const n = parseInt(row.id.slice(1), 10);
      if (!Number.isNaN(n) && n > maxNum) maxNum = n;
    }
    if (row.sort_order > maxOrder) maxOrder = row.sort_order;
  }

  const newId = `P${String(maxNum + 1).padStart(3, '0')}`;
  const nowIso = formatTwIso();
  const cleanSub = !body.sub_leader || body.sub_leader === '（無）' ? '' : body.sub_leader.trim();

  await c.env.DB.prepare(
    `INSERT INTO projects (
      id, category, title, main_leader, sub_leader, song, members,
      shoot_date, stick_info, a_melo, b_melo, c_melo, last_melo,
      pinned, sort_order, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?, ?)`
  )
    .bind(
      newId,
      category,
      title,
      mainLeader,
      cleanSub,
      (body.song || '').trim(),
      JSON.stringify(parseNamesList(body.members)),
      (body.shoot_date || '').trim(),
      (body.stick_info || '').trim(),
      JSON.stringify(parseNamesList(body.a_melo)),
      JSON.stringify(parseNamesList(body.b_melo)),
      JSON.stringify(parseNamesList(body.c_melo)),
      JSON.stringify(parseNamesList(body.last)),
      maxOrder + 1,
      nowIso,
      nowIso
    )
    .run();

  await c.env.DB.prepare(
    "DELETE FROM drafts WHERE username = ? AND draft_type = 'project_draft'"
  )
    .bind(user.username)
    .run();

  return c.json({
    ok: true,
    id: newId,
    message: `✅ [${formatTwTimeOnly()}] 已新增【${category}】「${title}」(${newId})！`,
  });
});

app.put('/projects/:id', async (c) => {
  const user = c.get('user');
  const id = c.req.param('id');
  const body = await c.req.json<{
    category?: string;
    title?: string;
    main_leader?: string;
    sub_leader?: string;
    song?: string;
    members?: string[] | string;
    shoot_date?: string;
    stick_info?: string;
    a_melo?: string[] | string;
    b_melo?: string[] | string;
    c_melo?: string[] | string;
    last?: string[] | string;
  }>();

  const title = (body.title || '').trim();
  const mainLeader = (body.main_leader || '').trim();
  const category = (body.category || '企劃').trim();

  if (!title || !mainLeader) {
    return c.json({ ok: false, error: '❌ 「名稱」與「總負責人」為必填！' }, 400);
  }

  const existing = await c.env.DB.prepare('SELECT id FROM projects WHERE id = ?')
    .bind(id)
    .first();
  if (!existing) {
    return c.json({ ok: false, error: `❌ 找不到編號 ${id}！` }, 404);
  }

  const cleanSub = !body.sub_leader || body.sub_leader === '（無）' ? '' : body.sub_leader.trim();
  const nowIso = formatTwIso();

  await c.env.DB.prepare(
    `UPDATE projects SET
      category = ?, title = ?, main_leader = ?, sub_leader = ?,
      song = ?, members = ?, shoot_date = ?, stick_info = ?,
      a_melo = ?, b_melo = ?, c_melo = ?, last_melo = ?, updated_at = ?
     WHERE id = ?`
  )
    .bind(
      category,
      title,
      mainLeader,
      cleanSub,
      (body.song || '').trim(),
      JSON.stringify(parseNamesList(body.members)),
      (body.shoot_date || '').trim(),
      (body.stick_info || '').trim(),
      JSON.stringify(parseNamesList(body.a_melo)),
      JSON.stringify(parseNamesList(body.b_melo)),
      JSON.stringify(parseNamesList(body.c_melo)),
      JSON.stringify(parseNamesList(body.last)),
      nowIso,
      id
    )
    .run();

  await c.env.DB.prepare(
    "DELETE FROM drafts WHERE username = ? AND draft_type = 'project_draft'"
  )
    .bind(user.username)
    .run();

  return c.json({
    ok: true,
    id,
    message: `✅ [${formatTwTimeOnly()}] 已更新【${category}】「${title}」！`,
  });
});

app.post('/projects/:id/pin', async (c) => {
  const id = c.req.param('id');
  const proj = await c.env.DB.prepare('SELECT id, title, pinned FROM projects WHERE id = ?')
    .bind(id)
    .first<{ id: string; title: string; pinned: number }>();

  if (!proj) {
    return c.json({ ok: false, error: `找不到項目 ${id}` }, 404);
  }

  const nextPinned = proj.pinned ? 0 : 1;
  await c.env.DB.prepare('UPDATE projects SET pinned = ?, updated_at = ? WHERE id = ?')
    .bind(nextPinned, formatTwIso(), id)
    .run();

  const statusText = nextPinned ? '釘選置頂' : '取消釘選';
  return c.json({
    ok: true,
    pinned: Boolean(nextPinned),
    message: `📌 已將「${proj.title}」${statusText}！`,
  });
});

app.delete('/projects/:id', async (c) => {
  const id = c.req.param('id');
  await c.env.DB.prepare('DELETE FROM projects WHERE id = ?').bind(id).run();
  return c.json({
    ok: true,
    message: `🗑️ 已刪除項目 ${id}！`,
  });
});

app.get('/projects/:id/distribution', async (c) => {
  const id = c.req.param('id');
  const weekType = c.req.query('weekType') || '下週調查表';
  const distribution = await getSegmentDistribution(c.env.DB, id, weekType);
  return c.json({ ok: true, distribution });
});

// Availability
app.get('/availability', async (c) => {
  const weekType = c.req.query('weekType') || '下週調查表';
  const data = await getAvailabilityForWeek(c.env.DB, weekType);
  return c.json({ ok: true, ...data, time: getTimeMeta() });
});

app.get('/availability/user', async (c) => {
  const user = c.get('user');
  const weekType = c.req.query('weekType') || '下週調查表';
  const overrideUser = (c.req.query('targetUser') || '').trim();

  if (overrideUser && user.role !== 'admin') {
    return c.json({ ok: false, error: '⛔ 僅管理者可修改他人紀錄！' }, 403);
  }

  const targetUser = overrideUser && user.role === 'admin' ? overrideUser : user.username;
  const offset = getWeekOffset(weekType);
  const weekDates = getWeekDates(offset);
  const weekKey = getWeekKey(offset);

  const submitted = await c.env.DB.prepare(
    'SELECT days, absent, note FROM availability WHERE week_key = ? AND username = ?'
  )
    .bind(weekKey, targetUser)
    .first<{ days: string; absent: number; note: string }>();

  if (submitted) {
    let parsedDays: string[] = [];
    try {
      parsedDays = JSON.parse(submitted.days);
    } catch {
      parsedDays = [];
    }
    return c.json({
      ok: true,
      targetUser,
      hasSubmitted: true,
      weekDates,
      days: parsedDays.filter((d) => weekDates.includes(d)),
      absent: Boolean(submitted.absent),
      note: submitted.note || '',
      message: `✏️ 已載入【${targetUser}】的紀錄，修改後請點擊送出。`,
    });
  }

  return c.json({
    ok: true,
    targetUser,
    hasSubmitted: false,
    weekDates,
    days: [],
    absent: false,
    note: '',
    message: `ℹ️ 【${targetUser}】尚無該週紀錄。`,
  });
});

app.put('/availability', async (c) => {
  const user = c.get('user');
  const body = await c.req.json<{
    weekType?: string;
    targetUser?: string;
    days?: string[];
    absent?: boolean;
    note?: string;
  }>();

  const overrideUser = (body.targetUser || '').trim();
  if (overrideUser && user.role !== 'admin') {
    return c.json({ ok: false, error: '⛔ 一般成員僅能修改自己的資料！' }, 403);
  }

  const targetUser = overrideUser && user.role === 'admin' ? overrideUser : user.username;
  const weekType = body.weekType || '下週調查表';
  const offset = getWeekOffset(weekType);
  const weekKey = getWeekKey(offset);
  const absent = Boolean(body.absent);
  const days = absent ? [] : Array.isArray(body.days) ? body.days : [];
  const note = (body.note || '').trim();
  const updatedAt = formatTwShort();

  await c.env.DB.prepare(
    `INSERT INTO availability (week_key, username, days, absent, note, updated_at)
     VALUES (?, ?, ?, ?, ?, ?)
     ON CONFLICT(week_key, username) DO UPDATE SET
       days = excluded.days,
       absent = excluded.absent,
       note = excluded.note,
       updated_at = excluded.updated_at`
  )
    .bind(weekKey, targetUser, JSON.stringify(days), absent ? 1 : 0, note, updatedAt)
    .run();

  await c.env.DB.prepare(
    "DELETE FROM drafts WHERE username = ? AND draft_type = 'avail_draft'"
  )
    .bind(user.username)
    .run();

  return c.json({
    ok: true,
    message: `✅ [${updatedAt}] 已更新【${targetUser}】的人力並同步至人力表總覽！`,
  });
});

// Drafts
app.put('/drafts/:type', async (c) => {
  const user = c.get('user');
  const draftType = c.req.param('type');
  if (draftType !== 'project_draft' && draftType !== 'avail_draft') {
    return c.json({ ok: false, error: '不支援的草稿類型' }, 400);
  }

  const payload = await c.req.json<Record<string, unknown>>();
  await c.env.DB.prepare(
    `INSERT INTO drafts (username, draft_type, payload, updated_at)
     VALUES (?, ?, ?, ?)
     ON CONFLICT(username, draft_type) DO UPDATE SET
       payload = excluded.payload,
       updated_at = excluded.updated_at`
  )
    .bind(user.username, draftType, JSON.stringify(payload), formatTwIso())
    .run();

  const msg =
    draftType === 'project_draft'
      ? `💾 [${formatTwTimeOnly()}] 草稿已暫存！下次登入自動保留。`
      : `💾 [${formatTwTimeOnly()}] 調查進度已暫存！`;

  return c.json({ ok: true, message: msg });
});

// Self password change (any logged-in user)
app.post('/auth/change-password', async (c) => {
  const user = c.get('user');
  const body = await c.req.json<{
    currentPassword?: string;
    newPassword?: string;
  }>();

  const currentPassword = (body.currentPassword || '').trim();
  const newPassword = (body.newPassword || '').trim();

  if (!currentPassword || !newPassword) {
    return c.json({ ok: false, error: '⚠️ 請輸入目前密碼與新密碼！' }, 400);
  }

  const row = await c.env.DB.prepare(
    'SELECT password_hash FROM users WHERE username = ?'
  )
    .bind(user.username)
    .first<{ password_hash: string }>();

  if (!row || !(await verifyPassword(currentPassword, row.password_hash))) {
    return c.json({ ok: false, error: '❌ 目前密碼錯誤！' }, 401);
  }

  const newHash = await hashPassword(newPassword);
  await c.env.DB.prepare('UPDATE users SET password_hash = ? WHERE username = ?')
    .bind(newHash, user.username)
    .run();

  return c.json({ ok: true, message: '✅ 密碼已成功更新！' });
});

// Admin user management middleware & routes
app.use('/admin/*', async (c, next) => {
  const user = c.get('user');
  if (user.role !== 'admin') {
    return c.json({ ok: false, error: '⛔ 僅管理者可執行此操作！' }, 403);
  }
  return next();
});

app.get('/admin/users', async (c) => {
  const { results } = await c.env.DB.prepare(
    'SELECT username, role, created_at FROM users ORDER BY created_at ASC, username ASC'
  ).all<{ username: string; role: 'admin' | 'user'; created_at: string }>();

  return c.json({ ok: true, users: results });
});

app.post('/admin/users', async (c) => {
  const body = await c.req.json<{
    username?: string;
    password?: string;
    role?: string;
  }>();

  const username = (body.username || '').trim();
  const password = (body.password || '').trim();
  const role = body.role === 'admin' ? 'admin' : 'user';

  if (!username || !password) {
    return c.json({ ok: false, error: '⚠️ 姓名與密碼為必填！' }, 400);
  }

  const existing = await c.env.DB.prepare('SELECT username FROM users WHERE username = ?')
    .bind(username)
    .first();
  if (existing) {
    return c.json({ ok: false, error: `⚠️ 帳號「${username}」已存在！` }, 409);
  }

  const passwordHash = await hashPassword(password);
  await c.env.DB.prepare(
    'INSERT INTO users (username, password_hash, role, created_at) VALUES (?, ?, ?, ?)'
  )
    .bind(username, passwordHash, role, formatTwIso())
    .run();

  return c.json({
    ok: true,
    message: `✅ 已新增${role === 'admin' ? '管理者' : '成員'}「${username}」！`,
  });
});

app.put('/admin/users/:username', async (c) => {
  const actor = c.get('user');
  const target = decodeURIComponent(c.req.param('username'));
  const body = await c.req.json<{
    role?: string;
    newPassword?: string;
  }>();

  const existing = await c.env.DB.prepare(
    'SELECT username, role FROM users WHERE username = ?'
  )
    .bind(target)
    .first<{ username: string; role: 'admin' | 'user' }>();

  if (!existing) {
    return c.json({ ok: false, error: `❌ 找不到使用者「${target}」` }, 404);
  }

  const nextRole =
    body.role === 'admin' || body.role === 'user' ? body.role : existing.role;

  if (target === actor.username && nextRole !== 'admin') {
    return c.json({ ok: false, error: '⛔ 無法將自己的帳號降級為一般成員！' }, 400);
  }

  const newPassword = (body.newPassword || '').trim();
  if (newPassword) {
    const newHash = await hashPassword(newPassword);
    await c.env.DB.prepare(
      'UPDATE users SET role = ?, password_hash = ? WHERE username = ?'
    )
      .bind(nextRole, newHash, target)
      .run();
  } else {
    await c.env.DB.prepare('UPDATE users SET role = ? WHERE username = ?')
      .bind(nextRole, target)
      .run();
  }

  return c.json({
    ok: true,
    message: `✅ 已更新「${target}」的設定！`,
  });
});

app.delete('/admin/users/:username', async (c) => {
  const actor = c.get('user');
  const target = decodeURIComponent(c.req.param('username'));

  if (target === actor.username) {
    return c.json({ ok: false, error: '⛔ 無法刪除目前登入中的自己！' }, 400);
  }

  await c.env.DB.prepare('DELETE FROM drafts WHERE username = ?').bind(target).run();
  await c.env.DB.prepare('DELETE FROM availability WHERE username = ?').bind(target).run();
  await c.env.DB.prepare('DELETE FROM users WHERE username = ?').bind(target).run();

  return c.json({
    ok: true,
    message: `🗑️ 已刪除使用者「${target}」！`,
  });
});
