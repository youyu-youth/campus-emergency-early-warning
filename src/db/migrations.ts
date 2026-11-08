// 数据库迁移：按名称顺序追加，已发布的迁移不可修改（保护历史演练记录）
export interface Migration {
  name: string;
  sql: string;
}

export const MIGRATIONS: Migration[] = [
  {
    name: "0001_init",
    sql: `
      CREATE TABLE IF NOT EXISTS drills (
        id TEXT PRIMARY KEY,
        scenario_key TEXT NOT NULL,
        name TEXT NOT NULL,
        seed INTEGER NOT NULL,
        params TEXT NOT NULL DEFAULT '{}',
        status TEXT NOT NULL DEFAULT 'draft',
        clock_state TEXT NOT NULL DEFAULT '{}',
        score REAL,
        started_at TEXT,
        ended_at TEXT,
        created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
        updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
      );

      CREATE TABLE IF NOT EXISTS signals (
        id TEXT PRIMARY KEY,
        drill_id TEXT NOT NULL REFERENCES drills(id),
        source_kind TEXT NOT NULL,
        source_ref TEXT NOT NULL,
        location TEXT NOT NULL,
        signal_type TEXT NOT NULL,
        payload TEXT NOT NULL,
        confidence REAL NOT NULL,
        status TEXT NOT NULL DEFAULT 'new',
        sim_time TEXT NOT NULL,
        created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
      );
      CREATE INDEX IF NOT EXISTS idx_signals_drill ON signals(drill_id);

      CREATE TABLE IF NOT EXISTS events (
        id TEXT PRIMARY KEY,
        drill_id TEXT NOT NULL REFERENCES drills(id),
        signal_id TEXT REFERENCES signals(id),
        type TEXT NOT NULL,
        title TEXT NOT NULL,
        location TEXT NOT NULL,
        severity TEXT,
        status TEXT NOT NULL DEFAULT 'reported',
        detected_sim_time TEXT,
        resolved_sim_time TEXT,
        created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
        updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
      );
      CREATE INDEX IF NOT EXISTS idx_events_drill ON events(drill_id);

      CREATE TABLE IF NOT EXISTS tasks (
        id TEXT PRIMARY KEY,
        drill_id TEXT NOT NULL REFERENCES drills(id),
        event_id TEXT NOT NULL REFERENCES events(id),
        role TEXT NOT NULL,
        title TEXT NOT NULL,
        description TEXT NOT NULL DEFAULT '',
        status TEXT NOT NULL DEFAULT 'pending_confirmation',
        result TEXT,
        dispatched_sim_time TEXT,
        started_sim_time TEXT,
        completed_sim_time TEXT,
        created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
        updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
      );
      CREATE INDEX IF NOT EXISTS idx_tasks_drill ON tasks(drill_id);
      CREATE INDEX IF NOT EXISTS idx_tasks_event ON tasks(event_id);

      CREATE TABLE IF NOT EXISTS notifications (
        id TEXT PRIMARY KEY,
        drill_id TEXT NOT NULL REFERENCES drills(id),
        event_id TEXT NOT NULL REFERENCES events(id),
        audience TEXT NOT NULL,
        title TEXT NOT NULL,
        content TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'draft',
        delivery TEXT,
        published_sim_time TEXT,
        created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
        updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
      );
      CREATE INDEX IF NOT EXISTS idx_notifications_drill ON notifications(drill_id);

      CREATE TABLE IF NOT EXISTS timeline_nodes (
        id TEXT PRIMARY KEY,
        drill_id TEXT NOT NULL REFERENCES drills(id),
        event_id TEXT REFERENCES events(id),
        seq INTEGER NOT NULL,
        phase TEXT NOT NULL,
        node_type TEXT NOT NULL,
        title TEXT NOT NULL,
        detail TEXT NOT NULL DEFAULT '{}',
        actor TEXT,
        requires_confirmation INTEGER NOT NULL DEFAULT 0,
        sim_time TEXT NOT NULL,
        real_time TEXT NOT NULL,
        created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
      );
      CREATE UNIQUE INDEX IF NOT EXISTS idx_timeline_drill_seq ON timeline_nodes(drill_id, seq);

      CREATE TABLE IF NOT EXISTS graph_runs (
        id TEXT PRIMARY KEY,
        drill_id TEXT NOT NULL REFERENCES drills(id),
        status TEXT NOT NULL DEFAULT 'idle',
        state TEXT NOT NULL DEFAULT '{}',
        updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
      );
      CREATE INDEX IF NOT EXISTS idx_graph_runs_drill ON graph_runs(drill_id);
    `,
  },
  {
    name: "0002_reports",
    sql: `
      CREATE TABLE IF NOT EXISTS reports (
        id TEXT PRIMARY KEY,
        drill_id TEXT NOT NULL REFERENCES drills(id),
        timeline_summary TEXT NOT NULL,
        metrics TEXT NOT NULL,
        problems TEXT NOT NULL,
        improvements TEXT NOT NULL,
        source TEXT NOT NULL,
        created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
      );
      CREATE INDEX IF NOT EXISTS idx_reports_drill ON reports(drill_id);
    `,
  },
];
