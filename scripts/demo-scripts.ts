// 假模型演示剧本:CLI `--model fake` 模式使用(离线演示全链路)
// 注意:剧本响应非模型生成,时间线 detail 已如实记录智能体输出

import type { ScriptedResponse } from "../src/agents/model";
import type { ScenarioKey } from "../src/simulation/scenarios";

function perceptionJson(output: Record<string, unknown>): string {
  return JSON.stringify(output);
}

export const DEMO_SCRIPTS: Record<ScenarioKey, { perception: ScriptedResponse[]; command: ScriptedResponse[] }> = {
  fire_alarm: {
    perception: [
      perceptionJson({
        location: "图书馆三层东区",
        eventType: "fire_alarm",
        title: "图书馆三层东区烟雾浓度超标疑似火情",
        occurredTime: "14:00:00",
        evidence: ["烟雾传感器读数 0.42%/m,超过阈值 0.15%/m"],
        reasoning: "烟雾浓度显著超过阈值,判断为疑似火情并上报(演示剧本响应)",
      }),
      perceptionJson({
        location: "图书馆三层东区走廊",
        eventType: "fire_alarm",
        title: "摄像头视觉确认烟雾可见",
        occurredTime: "14:00:45",
        evidence: ["东侧书架区摄像头检测到可见烟雾"],
        reasoning: "视觉检测与烟雾传感器相互印证,作为补充证据关联当前事件(演示剧本响应)",
      }),
      perceptionJson({
        location: "图书馆三层东区",
        eventType: "fire_alarm",
        title: "温度持续上升",
        occurredTime: "14:03:00",
        evidence: ["温度 41.5°C,显著高于基线 26.0°C"],
        reasoning: "温度上升趋势进一步佐证火情发展,作为补充证据关联当前事件(演示剧本响应)",
      }),
    ],
    command: [
      JSON.stringify({
        suggestedSeverity: "II",
        reasoning:
          "烟雾浓度显著超标且摄像头视觉确认,图书馆人流密集、火势存在蔓延趋势,建议定为较大(Ⅱ)级(演示剧本响应)",
      }),
    ],
  },
  medical_emergency: {
    perception: [
      perceptionJson({
        location: "操场西侧跑道",
        eventType: "medical_emergency",
        title: "学生手环心率异常疑似突发疾病",
        occurredTime: "10:15:00",
        evidence: ["学生 STU-0716 手环心率 186bpm,超过阈值 160bpm"],
        reasoning: "心率显著超标,判断为学生突发疾病疑似事件并上报(演示剧本响应)",
      }),
      perceptionJson({
        location: "操场西侧跑道",
        eventType: "medical_emergency",
        title: "摄像头检测到学生倒地",
        occurredTime: "10:15:30",
        evidence: ["西侧跑道弯道处摄像头检测到倒地行为"],
        reasoning: "倒地检测与心率异常相互印证,作为补充证据关联当前事件(演示剧本响应)",
      }),
    ],
    command: [
      JSON.stringify({
        suggestedSeverity: "III",
        reasoning:
          "学生倒地伴心率严重异常,涉及单一人员生命安全但范围可控、无扩散风险,建议定为一般(Ⅲ)级(演示剧本响应)",
      }),
    ],
  },
};
