// 假模型演示剧本:CLI `--model fake` 模式使用(离线演示全链路)
// 注意:剧本响应非模型生成,时间线 detail 已如实记录智能体输出
// 调用序(人工模式):感知×N → 定级 → 任务方案 → 里程碑评估×M;处置按角色分键并行调用

import type { ScriptedResponse } from "../src/agents/model";
import type { ScenarioKey } from "../src/simulation/scenarios";

function perceptionJson(output: Record<string, unknown>): string {
  return JSON.stringify(output);
}

function planJson(tasks: Array<{ role: string; title: string; description: string }>): string {
  return JSON.stringify({ tasks, reasoning: "三角色并行处置(演示剧本响应)" });
}

function evalJson(additionalTasks: Array<{ role: string; title: string; description: string }>): string {
  return JSON.stringify({
    needsRedispatch: additionalTasks.length > 0,
    additionalTasks,
    reasoning: additionalTasks.length > 0 ? "场景演变带来新风险,建议加派(演示剧本响应)" : "现有任务覆盖处置需要,无需调整(演示剧本响应)",
  });
}

function narrative(text: string): string {
  return JSON.stringify({ narrative: text });
}

function notificationJson(title: string, content: string): string {
  return JSON.stringify({ title, content });
}

export const DEMO_SCRIPTS: Record<
  ScenarioKey,
  {
    perception: ScriptedResponse[];
    command: ScriptedResponse[];
    handling_security: ScriptedResponse[];
    handling_medical: ScriptedResponse[];
    handling_logistics: ScriptedResponse[];
    notification: ScriptedResponse[];
  }
> = {
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
      planJson([
        { role: "security", title: "封锁并引导疏散", description: "封锁图书馆三层东区,引导人员经西侧楼梯疏散" },
        { role: "medical", title: "医疗待命", description: "在楼下集结点待命,评估潜在伤员并准备急救" },
        { role: "logistics", title: "切断三层电源", description: "联动切断三层东区电源,设置外围警戒线" },
      ]),
      evalJson([{ role: "logistics", title: "启动应急广播", description: "循环播放疏散引导广播,加快疏散节奏" }]),
      evalJson([]),
      evalJson([]),
    ],
    handling_security: [narrative("保安组 3 人封锁东侧楼梯,引导 30 余名学生经西侧楼梯有序疏散,无拥挤(演示剧本响应)。")],
    handling_medical: [narrative("医务组在集结点待命,评估 2 名轻微呛咳学生,现场处置后无需送医(演示剧本响应)。")],
    handling_logistics: [
      narrative("后勤组断电作业时配电箱跳闸,首次未能完成断电,准备重试(演示剧本响应)。"),
      narrative("后勤组改用备用回路完成三层东区断电,并设置好外围警戒线(演示剧本响应)。"),
      narrative("后勤组启动应急广播循环播放疏散引导,疏散节奏明显加快(演示剧本响应)。"),
    ],
    notification: [
      notificationJson(
        "【模拟演练】图书馆三层火情疏散通知(师生)",
        "【模拟演练】图书馆三层东区发现烟雾并确认疑似火情,三层全体师生请立即停止阅览,沿西侧楼梯有序疏散至图书馆前广场集结点,服从现场保安引导,勿乘电梯、勿返回取物。本通知为模拟演练数据,非真实警情。",
      ),
      notificationJson(
        "【模拟演练】图书馆三层火情情况通报(家长)",
        "【模拟演练】家长您好:今日演练中图书馆三层东区模拟发生火情,学校已按预案组织疏散与处置,学生安全在控,请勿恐慌赶往学校,后续将通过学校渠道通报演练情况。本通报为模拟演练数据,非真实警情。",
      ),
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
      planJson([
        { role: "medical", title: "现场急救", description: "携带急救包赶到倒地学生处,评估意识与生命体征" },
        { role: "security", title: "现场秩序维护", description: "疏导围观学生,预留救护车通道" },
        { role: "logistics", title: "器材与转运支援", description: "运送担架与急救器材到现场,协助模拟转运" },
      ]),
      evalJson([]),
      evalJson([]),
    ],
    handling_security: [narrative("保安组疏导围观学生,预留出救护车通道,现场秩序良好(演示剧本响应)。")],
    handling_medical: [narrative("医务组 90 秒内到达现场,学生意识恢复,生命体征平稳,持续观察(演示剧本响应)。")],
    handling_logistics: [narrative("后勤组将担架与急救器材运抵现场,并协助完成模拟转运准备(演示剧本响应)。")],
    notification: [
      notificationJson(
        "【模拟演练】操场西侧学生突发疾病处置通知(师生)",
        "【模拟演练】操场西侧跑道有一名学生突发身体不适倒地,医务组已在场处置。请在场师生听从保安引导,不围观聚集,为救护预留通道,按正常秩序活动。本通知为模拟演练数据,非真实警情。",
      ),
      notificationJson(
        "【模拟演练】操场西侧学生突发疾病情况通报(家长)",
        "【模拟演练】家长您好:今日演练中操场西侧有一名学生模拟突发疾病,学校医务组已第一时间到场处置,学生情况平稳,请勿担忧。本通报为模拟演练数据,非真实警情。",
      ),
    ],
  },
};
