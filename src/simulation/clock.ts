// 演练时钟：模拟时间（simulationTime）与真实系统时间分离
// 倍速、暂停、恢复均由规则计算，纯函数无副作用

export interface ClockState {
  /** 模拟世界起点（epoch 毫秒），由场景配置决定 */
  simOrigin: number;
  /** 已累计的模拟毫秒（不含当前运行段） */
  simElapsedMs: number;
  running: boolean;
  /** 当前运行段开始时的真实时刻（epoch 毫秒） */
  lastRealAt: number | null;
  /** 倍速（> 0） */
  speed: number;
}

export function startClock(simOrigin: number, realNow: number, speed = 1): ClockState {
  if (speed <= 0) throw new Error("倍速必须大于 0");
  return { simOrigin, simElapsedMs: 0, running: true, lastRealAt: realNow, speed };
}

export function pauseClock(state: ClockState, realNow: number): ClockState {
  if (!state.running) throw new Error("时钟未在运行，无法暂停");
  return { ...state, simElapsedMs: elapsedMs(state, realNow), running: false, lastRealAt: null };
}

export function resumeClock(state: ClockState, realNow: number, speed = state.speed): ClockState {
  if (state.running) throw new Error("时钟已在运行，无法重复恢复");
  if (speed <= 0) throw new Error("倍速必须大于 0");
  return { ...state, running: true, lastRealAt: realNow, speed };
}

// 运行中调速：先把当前段结算进累计值，再以新倍速开段
export function setSpeed(state: ClockState, realNow: number, speed: number): ClockState {
  if (!state.running) return { ...state, speed };
  return resumeClock(pauseClock(state, realNow), realNow, speed);
}

function elapsedMs(state: ClockState, realNow: number): number {
  if (!state.running || state.lastRealAt === null) return state.simElapsedMs;
  return state.simElapsedMs + Math.max(0, realNow - state.lastRealAt) * state.speed;
}

/** 当前模拟时间相对起点的偏移（毫秒） */
export function simOffsetMs(state: ClockState, realNow: number): number {
  return elapsedMs(state, realNow);
}

/** 当前模拟时间（epoch 毫秒） */
export function simTimeMs(state: ClockState, realNow: number): number {
  return state.simOrigin + elapsedMs(state, realNow);
}

/** 一天内的 HH:mm:ss 显示（模拟仪表时钟） */
export function formatSimClock(offsetMs: number): string {
  const totalSeconds = Math.floor(offsetMs / 1000);
  const hours = Math.floor(totalSeconds / 3600) % 24;
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  return [hours, minutes, seconds]
    .map((n) => String(n).padStart(2, "0"))
    .join(":");
}
