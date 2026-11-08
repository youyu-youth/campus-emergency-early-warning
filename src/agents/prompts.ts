// 智能体提示词(全部中文,与业务规则分离存放)
// 所有输入均标注为模拟演练数据,严禁表述为真实警情

import type { GradingInput } from "./command";
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
