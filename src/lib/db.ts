import { getWeekDates, getWeekKey, getWeekOffset } from './time';

export interface ProjectRecord {
  id: string;
  category: string;
  title: string;
  main_leader: string;
  sub_leader: string;
  song: string;
  members: string[];
  shoot_date: string;
  stick_info: string;
  a_melo: string[];
  b_melo: string[];
  c_melo: string[];
  last: string[];
  pinned: boolean;
  sort_order: number;
}

export interface AvailabilityRecord {
  week_key: string;
  username: string;
  days: string[];
  absent: boolean;
  note: string;
  updated_at: string;
}

interface RawProjectRow {
  id: string;
  category: string;
  title: string;
  main_leader: string;
  sub_leader: string;
  song: string;
  members: string;
  shoot_date: string;
  stick_info: string;
  a_melo: string;
  b_melo: string;
  c_melo: string;
  last_melo: string;
  pinned: number;
  sort_order: number;
}

interface RawAvailabilityRow {
  week_key: string;
  username: string;
  days: string;
  absent: number;
  note: string;
  updated_at: string;
}

export function parseJsonArray(raw: string | null | undefined): string[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed)
      ? parsed.map((x) => String(x).trim()).filter(Boolean)
      : [];
  } catch {
    return [];
  }
}

export function mapProjectRow(row: RawProjectRow): ProjectRecord {
  return {
    id: row.id,
    category: row.category,
    title: row.title,
    main_leader: row.main_leader,
    sub_leader: row.sub_leader || '',
    song: row.song || '',
    members: parseJsonArray(row.members),
    shoot_date: row.shoot_date || '',
    stick_info: row.stick_info || '',
    a_melo: parseJsonArray(row.a_melo),
    b_melo: parseJsonArray(row.b_melo),
    c_melo: parseJsonArray(row.c_melo),
    last: parseJsonArray(row.last_melo),
    pinned: Boolean(row.pinned),
    sort_order: row.sort_order,
  };
}

export function mapAvailabilityRow(row: RawAvailabilityRow): AvailabilityRecord {
  return {
    week_key: row.week_key,
    username: row.username,
    days: parseJsonArray(row.days),
    absent: Boolean(row.absent),
    note: row.note || '',
    updated_at: row.updated_at || '',
  };
}

export async function getMemberList(db: D1Database): Promise<string[]> {
  const { results } = await db
    .prepare('SELECT username FROM users ORDER BY created_at ASC, username ASC')
    .all<{ username: string }>();
  return results.map((r) => r.username);
}

export async function getProjects(db: D1Database, category?: string): Promise<ProjectRecord[]> {
  const hasFilter = category && category !== '全部';
  const stmt = hasFilter
    ? db
        .prepare('SELECT * FROM projects WHERE category = ? ORDER BY pinned DESC, sort_order DESC')
        .bind(category)
    : db.prepare('SELECT * FROM projects ORDER BY pinned DESC, sort_order DESC');

  const { results } = await stmt.all<RawProjectRow>();
  return results.map(mapProjectRow);
}

export async function getAvailabilityForWeek(
  db: D1Database,
  weekType: string
): Promise<{
  weekKey: string;
  weekDates: string[];
  records: AvailabilityRecord[];
  byDate: Array<{ date: string; attendeesText: string }>;
}> {
  const offset = getWeekOffset(weekType);
  const weekDates = getWeekDates(offset);
  const weekKey = getWeekKey(offset);

  const { results } = await db
    .prepare('SELECT * FROM availability WHERE week_key = ? ORDER BY username ASC')
    .bind(weekKey)
    .all<RawAvailabilityRow>();

  const records = results.map(mapAvailabilityRow);
  const byDate = weekDates.map((d) => {
    const attendees: string[] = [];
    for (const rec of records) {
      if (!rec.absent && rec.days.includes(d)) {
        attendees.push(rec.note ? `${rec.username} (${rec.note})` : rec.username);
      }
    }
    return {
      date: d,
      attendeesText: attendees.length > 0 ? attendees.join('、') : '（尚無人登記可出席）',
    };
  });

  return { weekKey, weekDates, records, byDate };
}

function evalSegmentStatus(required: string[], availableSet: Set<string>): string {
  if (required.length === 0) return '⚪ 未設定';
  const missing = required.filter((m) => !availableSet.has(m));
  if (missing.length === 0) return `🟢 全到 (${required.join(', ')})`;
  return `⚪ 缺: ${missing.join(', ')}`;
}

export async function getSegmentDistribution(
  db: D1Database,
  projectId: string,
  weekType: string
) {
  const projRow = await db
    .prepare('SELECT * FROM projects WHERE id = ?')
    .bind(projectId)
    .first<RawProjectRow>();

  if (!projRow) return [];

  const proj = mapProjectRow(projRow);
  const { weekDates, records } = await getAvailabilityForWeek(db, weekType);

  return weekDates.map((d) => {
    const availToday = new Set(
      records.filter((r) => !r.absent && r.days.includes(d)).map((r) => r.username)
    );
    return {
      date: d.slice(5),
      a_melo: evalSegmentStatus(proj.a_melo, availToday),
      b_melo: evalSegmentStatus(proj.b_melo, availToday),
      c_melo: evalSegmentStatus(proj.c_melo, availToday),
      last: evalSegmentStatus(proj.last, availToday),
    };
  });
}
