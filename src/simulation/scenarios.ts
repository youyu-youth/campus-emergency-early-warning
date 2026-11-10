// 场景定义：内置两类事件（消防警报、学生突发疾病）作为种子模板；自定义场景经事件库(scenarios 表)增删改查
// 所有信号与演变节点均为演练数据，payload 显式携带 simulated: true，不得伪装真实设备数据

export type ScenarioKey = string;
export type SignalSourceKind = "sensor" | "camera";

export interface SignalTemplate {
  /** 相对演练开始的模拟时间偏移（毫秒） */
  offsetMs: number;
  kind: SignalSourceKind;
  /** 模拟设备来源编号 */
  sourceRef: string;
  location: string;
  signalType: string;
  /** 置信度区间 [min, max]，具体取值由随机种子决定 */
  confidence: [number, number];
  payload: Record<string, unknown>;
}

export interface EvolutionTemplate {
  offsetMs: number;
  milestone: string;
  note: string;
}

export interface Scenario {
  key: ScenarioKey;
  name: string;
  description: string;
  /** 事件类型中文名（监测中心展示；eventType 语义 = 场景 key） */
  eventTypeLabel: string;
  /** 默认模拟开始时刻（一天内，HH:mm） */
  defaultSimStart: string;
  defaults: {
    location: string;
    intensity: "low" | "medium" | "high";
  };
  signals: SignalTemplate[];
  evolution: EvolutionTemplate[];
}

/** 内置场景种子（迁移后写入 scenarios 表并锁定；自定义场景可复制为起点） */
export const BUILTIN_SCENARIOS: Scenario[] = [
  {
    key: "fire_alarm",
    name: "消防警报",
    description: "图书馆三层东区烟雾浓度超标，视觉确认后升级处置并组织疏散",
    eventTypeLabel: "消防警报",
    defaultSimStart: "14:00",
    defaults: { location: "图书馆三层东区", intensity: "medium" },
    signals: [
      {
        offsetMs: 0,
        kind: "sensor",
        sourceRef: "LIB-3F-SMOKE-01",
        location: "图书馆三层东区",
        signalType: "smoke_density",
        confidence: [0.88, 0.96],
        payload: { metric: "smoke_density", value: 0.42, unit: "%/m", threshold: 0.15, simulated: true },
      },
      {
        offsetMs: 45_000,
        kind: "camera",
        sourceRef: "CAM-LIB-3F-E",
        location: "图书馆三层东区走廊",
        signalType: "visual_smoke",
        confidence: [0.8, 0.9],
        payload: { detection: "smoke_visible", region: "东侧书架区", simulated: true },
      },
      {
        offsetMs: 180_000,
        kind: "sensor",
        sourceRef: "LIB-3F-TEMP-02",
        location: "图书馆三层东区",
        signalType: "temperature_rise",
        confidence: [0.7, 0.85],
        payload: { metric: "temperature", value: 41.5, unit: "°C", baseline: 26.0, simulated: true },
      },
    ],
    evolution: [
      {
        offsetMs: 120_000,
        milestone: "烟雾范围扩大",
        note: "东侧书架区烟雾浓度持续上升，蔓延至阅览区",
      },
      {
        offsetMs: 300_000,
        milestone: "消防联动（模拟）",
        note: "模拟喷淋启动、火警警报拉响",
      },
      {
        offsetMs: 480_000,
        milestone: "疏散人流聚集",
        note: "三层疏散楼梯口出现人流聚集，存在衍生风险",
      },
    ],
  },
  {
    key: "medical_emergency",
    name: "学生突发疾病",
    description: "操场西侧学生倒地，手环心率异常与摄像头倒地检测先后触发",
    eventTypeLabel: "突发疾病",
    defaultSimStart: "10:15",
    defaults: { location: "操场西侧跑道", intensity: "medium" },
    signals: [
      {
        offsetMs: 0,
        kind: "sensor",
        sourceRef: "WB-STU-0716",
        location: "操场西侧跑道",
        signalType: "heart_rate_abnormal",
        confidence: [0.9, 0.97],
        payload: {
          metric: "heart_rate",
          value: 186,
          unit: "bpm",
          threshold: 160,
          subjectRef: "STU-0716",
          simulated: true,
        },
      },
      {
        offsetMs: 30_000,
        kind: "camera",
        sourceRef: "CAM-PLAYGROUND-W",
        location: "操场西侧跑道",
        signalType: "fall_detected",
        confidence: [0.78, 0.88],
        payload: { detection: "fall_detected", region: "西侧跑道弯道处", simulated: true },
      },
    ],
    evolution: [
      {
        offsetMs: 120_000,
        milestone: "意识状态评估",
        note: "倒地学生呼喊无回应，情况可能加重",
      },
      {
        offsetMs: 240_000,
        milestone: "校医到场",
        note: "校医到达现场开展初步检查",
      },
      {
        offsetMs: 360_000,
        milestone: "送医评估",
        note: "需评估是否启动模拟急救转运",
      },
    ],
  },
];
