// 数据库行类型，与 migrations.ts 中的表结构一一对应
// 状态字段的具体取值见 src/simulation/state-machines.ts

export interface DrillRow {
  id: string;
  scenario_key: string;
  name: string;
  seed: number;
  params: string; // JSON：场景参数（地点、强度、人工确认节点开关等）
  status: string;
  clock_state: string; // JSON：演练时钟状态
  score: number | null;
  started_at: string | null;
  ended_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface SignalRow {
  id: string;
  drill_id: string;
  source_kind: string; // sensor | camera
  source_ref: string;
  location: string;
  signal_type: string;
  payload: string; // JSON：原始数据，显式携带 simulated: true
  confidence: number;
  status: string; // new | processing | reported | ignored
  sim_time: string;
  created_at: string;
}

export interface EventRow {
  id: string;
  drill_id: string;
  signal_id: string | null;
  type: string;
  title: string;
  location: string;
  severity: string | null; // I | II | III | IV，null 为未定级
  status: string;
  detected_sim_time: string | null;
  resolved_sim_time: string | null;
  created_at: string;
  updated_at: string;
}

export interface TaskRow {
  id: string;
  drill_id: string;
  event_id: string;
  role: string; // security | medical | logistics
  title: string;
  description: string;
  status: string;
  result: string | null; // JSON：耗时、资源消耗、处置结果
  dispatched_sim_time: string | null;
  started_sim_time: string | null;
  completed_sim_time: string | null;
  created_at: string;
  updated_at: string;
}

export interface NotificationRow {
  id: string;
  drill_id: string;
  event_id: string;
  audience: string; // staff_students | parents
  title: string;
  content: string;
  status: string;
  delivery: string | null; // JSON：模拟分发统计
  published_sim_time: string | null;
  created_at: string;
  updated_at: string;
}

export interface TimelineNodeRow {
  id: string;
  drill_id: string;
  event_id: string | null;
  seq: number;
  phase: string; // perception | grading | handling | notification | review
  node_type: string; // signal | grading | dispatch | feedback | status_change | notification | anomaly | operator_action
  title: string;
  detail: string; // JSON：原始输入 / Agent 决策依据 / 结构化输出
  actor: string | null;
  requires_confirmation: number; // 0 | 1
  sim_time: string;
  real_time: string;
  created_at: string;
}

export interface GraphRunRow {
  id: string;
  drill_id: string;
  status: string;
  state: string; // JSON：图共享状态快照
  updated_at: string;
}
