// 智能体提示词(全部中文,与业务规则分离存放)
// 所有输入均标注为模拟演练数据,严禁表述为真实警情

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
