// 智能体提示词(全部中文,与业务规则分离存放)
// 所有输入均标注为模拟演练数据,严禁表述为真实警情

import type { DispatchInput, GradingInput, RedispatchInput } from "./command";
import type { HandlingInput } from "./handling";
import type { PerceptionInput } from "./perception";

export function perceptionPrompt(input: PerceptionInput): string {
  const role = input.isFirstSignal ? "首个信号:请解读并上报为新事件" : "后续信号:请解读并作为当前事件的补充证据";
  return `你是校园应急演练平台的「监测感知智能体」。当前处于模拟演练环境,所有信号均为演练数据,不是真实警情。

## 任务
${role}。请从下述信号中提取:位置、事件类型、发生时间(模拟时间)、证据要点,并给出你的解读依据。

## 信号(模拟演练数据)
- 来源:${input.signal.kind === "sensor" ? "模拟传感器" : "模拟摄像头"} ${input.signal.sourceRef}
- 位置:${input.signal.location}
- 信号类型:${input.signal.signalType}
- 置信度:${input.signal.confidence}
- 模拟时间:${input.simTimeLabel}
- 原始数据:${JSON.stringify(input.signal.payload)}

## 场景
- 演练场景:${input.scenarioName}(${input.scenarioKey})

## 输出要求
仅输出一个 JSON 对象,不要输出任何其他文字或代码块标记。字段如下:
{
  "location": "解读出的具体位置(中文)",
  "eventType": "fire_alarm 或 medical_emergency",
  "title": "事件标题(中文一句话,isFirstSignal 为后续信号时也请给出概括标题)",
  "occurredTime": "解读出的发生时间(HH:mm:ss,基于模拟时间)",
  "evidence": ["证据要点(中文,逐条列出)"],
  "reasoning": "你的解读依据(中文)"
}`;
}

export function gradingPrompt(input: GradingInput): string {
  return `你是校园应急演练平台的「指挥调度智能体」。当前处于模拟演练环境,下述事件为演练数据,不是真实警情。

## 任务
请基于事件信息与感知智能体提取的证据,研判事件严重程度,提出建议等级与理由。

## 事件(模拟演练数据)
- 标题:${input.event.title}
- 类型:${input.event.type}
- 位置:${input.event.location}
- 发现时间(模拟):${input.event.detectedSimTime}
- 当前模拟时间:${input.simTimeLabel}

## 场景
- 演练场景:${input.scenarioName}(${input.scenarioKey})
- 配置强度:${input.intensity}

## 证据要点
${input.evidence.map((e, i) => `${i + 1}. ${e}`).join("\n")}

## 等级定义(校园应急四级)
- I:重大——大规模人员安全威胁或重大设施损毁
- II:较大——明确的局部危险且可能扩大(如火情确认、人员失去意识)
- III:一般——局部可控的异常需及时处置(如单人轻微伤病、初期烟雾)
- IV:轻微——影响有限的异常,常规处置即可

## 输出要求
仅输出一个 JSON 对象,不要输出任何其他文字或代码块标记。字段如下:
{
  "suggestedSeverity": "建议等级,只能是 I、II、III、IV 之一",
  "reasoning": "定级理由(中文,说明关键依据与等级选择的因果关系)"
}`;
}

export function dispatchPlanPrompt(input: DispatchInput): string {
  return `你是校园应急演练平台的「指挥调度智能体」。当前处于模拟演练环境,下述事件为演练数据,不是真实警情。

## 任务
事件已定级,请制定处置任务方案:为保安(security)、医务(medical)、后勤(logistics)安排必要任务,每条任务明确角色、标题与执行说明。只安排确有必要的任务,不为凑数而派。

## 事件(模拟演练数据)
- 标题:${input.event.title}
- 类型:${input.event.type} · 等级 ${input.severity}
- 位置:${input.event.location}
- 当前模拟时间:${input.simTimeLabel}

## 场景与证据
- 演练场景:${input.scenarioName}(${input.scenarioKey})
${input.evidence.map((e, i) => `- 证据${i + 1}:${e}`).join("\n")}

## 输出要求
仅输出一个 JSON 对象,不要输出任何其他文字或代码块标记。字段如下:
{
  "tasks": [{ "role": "security|medical|logistics", "title": "任务标题(中文,一句话)", "description": "执行说明(中文,具体动作与目标)" }],
  "reasoning": "方案理由(中文,为什么是这些任务)"
}`;
}

export function redispatchPrompt(input: RedispatchInput): string {
  return `你是校园应急演练平台的「指挥调度智能体」。当前处于模拟演练环境,下述信息为演练数据,不是真实警情。

## 任务
场景出现新的演变里程碑,请评估当前任务方案是否需要调整:是否需要加派新任务?只在新情况确有需要时加派,不加派时 additionalTasks 为空数组。

## 事件(模拟演练数据)
- 标题:${input.event.title} · 等级 ${input.severity}
- 位置:${input.event.location}

## 新里程碑
- ${input.milestone.label}(${input.milestone.simTimeLabel}):${input.milestone.note}

## 当前任务
${input.currentTasks.map((t, i) => `${i + 1}. [${t.role}] ${t.title}(${t.status})`).join("\n") || "(无)"}

## 输出要求
仅输出一个 JSON 对象,不要输出任何其他文字或代码块标记。字段如下:
{
  "needsRedispatch": true 或 false,
  "additionalTasks": [{ "role": "security|medical|logistics", "title": "任务标题", "description": "执行说明" }],
  "reasoning": "评估理由(中文,说明加派或不加派的依据)"
}`;
}

const HANDLING_ROLE_BRIEFS: Record<HandlingInput["role"], string> = {
  security: "你模拟校园保安队伍:封锁现场、引导疏散、维护秩序、预留救援通道。",
  medical: "你模拟校园医务力量:现场评估伤患、实施急救、协调模拟送医。",
  logistics: "你模拟校园后勤保障:物资输送、断电断气联动、警戒与广播配合。",
};

export function handlingPrompt(input: HandlingInput): string {
  const seconds = Math.round(input.outcome.durationMs / 1000);
  const resources = Object.entries(input.outcome.resources)
    .map(([name, count]) => `${name}×${count}`)
    .join("、");
  return `你是校园应急演练平台的「处置执行智能体」。${HANDLING_ROLE_BRIEFS[input.role]}
当前处于模拟演练环境,下述任务为演练数据,不是真实警情。

## 任务
请为下述任务生成 2–4 句执行叙述:队伍做了什么、结果如何。成败与耗时由规则给定,你必须如实陈述,不得虚构成功或隐瞒失败。

## 任务(模拟演练数据)
- 标题:${input.taskTitle}
- 说明:${input.taskDescription}
- 关联事件:${input.eventTitle}(等级 ${input.severity},位置 ${input.location})
- 当前模拟时间:${input.simTimeLabel}

## 规则给定的执行结果(必须如实反映)
- 结果:${input.outcome.success ? "成功完成" : "失败"}(第 ${input.outcome.attempt} 次尝试)
- 耗时:${seconds} 秒 · 资源消耗:${resources}

## 输出要求
仅输出一个 JSON 对象,不要输出任何其他文字或代码块标记。字段如下:
{
  "narrative": "执行叙述(中文,2–4 句,第一人称队伍视角或客观陈述均可)"
}`;
}
