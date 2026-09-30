(function (root) {
  "use strict";

  const AI_BALL_VISIBLE_KEY = "course-app-ai-ball";
  const AI_BALL_POS_KEY = "course-app-ai-ball-pos";
  const AI_WINDOW_POS_KEY = "course-app-ai-window-pos";
  const AI_NOTICE_KEY = "course-app-ai-notice-v1";
  const AI_CONTEXT_KEY = "course-app-ai-context";
  const AI_THINKING_KEY = "course-app-ai-thinking";

  const AI_PRESETS = {
    deepseek: {label: "DeepSeek 官方", baseUrl: "https://api.deepseek.com", model: "deepseek-flash", thinking: true},
    openai: {label: "OpenAI", baseUrl: "https://api.openai.com/v1", model: "gpt-4o-mini", thinking: false},
    openrouter: {label: "OpenRouter", baseUrl: "https://openrouter.ai/api/v1", model: "", thinking: false},
    ollama: {label: "本地 Ollama", baseUrl: "http://127.0.0.1:11434/v1", model: "", thinking: false},
    custom: {label: "自定义 / 其他", baseUrl: "", model: "", thinking: false}
  };

  const AI_ERROR_HINTS = {
    401: "API Key 无效，请检查密钥设置。",
    402: "账户余额不足，请前往服务商控制台充值。",
    422: "请求参数被拒绝，请检查模型名称是否正确。",
    429: "请求过于频繁，触发服务商限流，请稍后再试。",
    500: "服务商服务器故障，请稍后重试。",
    503: "服务商繁忙，请稍后重试。"
  };

  const MAX_RESPONSE_BYTES = 2000000;
  const MAX_HISTORY_MESSAGES = 12;
  const MAX_CONTEXT_SESSIONS = 300;
  const MAX_TOOL_ROUNDS = 4;

  const AI_TOOLS = [
    {type: "function", function: {
      name: "add_course",
      description: "在当前学期的课表中新增一条上课安排。用户明确表达了添加意图时才调用。",
      parameters: {type: "object", properties: {
        name: {type: "string", description: "课程名称"},
        code: {type: "string", description: "课程代码（可选）"},
        teacher: {type: "string", description: "教师姓名（可选）"},
        day: {type: "integer", description: "星期几：1=周一，2=周二 … 7=周日", minimum: 1, maximum: 7},
        period_start: {type: "integer", description: "开始节次，1-13", minimum: 1, maximum: 13},
        period_end: {type: "integer", description: "结束节次，必须不小于开始节次", minimum: 1, maximum: 13},
        weeks: {type: "array", items: {type: "integer"}, description: "上课周次列表，如 [1,3,5]；每周都上则为 [1,2,…,总周数]"},
        location: {type: "string", description: "上课地点（可选）"},
        campus: {type: "string", description: "校区（可选）"},
        notes: {type: "string", description: "备注（可选）"}
      }, required: ["name", "day", "period_start", "period_end", "weeks"]}
    }},
    {type: "function", function: {
      name: "update_course",
      description: "修改当前学期中已有的一条上课安排。按课程名称查找；同名多条时用 day 或 period_start 缩小范围。",
      parameters: {type: "object", properties: {
        name: {type: "string", description: "要修改的课程名称"},
        day: {type: "integer", description: "限定星期几（可选，用于区分同名课程）", minimum: 1, maximum: 7},
        period_start: {type: "integer", description: "限定开始节次（可选）", minimum: 1, maximum: 13},
        new_day: {type: "integer", description: "新的星期几（可选）", minimum: 1, maximum: 7},
        new_period_start: {type: "integer", description: "新的开始节次（可选）", minimum: 1, maximum: 13},
        new_period_end: {type: "integer", description: "新的结束节次（可选）", minimum: 1, maximum: 13},
        new_weeks: {type: "array", items: {type: "integer"}, description: "新的周次列表（可选）"},
        new_teacher: {type: "string", description: "新的教师姓名（可选）"},
        new_location: {type: "string", description: "新的地点（可选）"}
      }, required: ["name"]}
    }},
    {type: "function", function: {
      name: "delete_course",
      description: "删除当前学期中已有的一条上课安排。按课程名称查找；同名多条时用 day 或 period_start 缩小范围。",
      parameters: {type: "object", properties: {
        name: {type: "string", description: "要删除的课程名称"},
        day: {type: "integer", description: "限定星期几（可选）", minimum: 1, maximum: 7},
        period_start: {type: "integer", description: "限定开始节次（可选）", minimum: 1, maximum: 13}
      }, required: ["name"]}
    }},
    {type: "function", function: {
      name: "find_free_slots",
      description: "查询指定星期几当前周有哪些节次空闲。只读，不需要用户确认。",
      parameters: {type: "object", properties: {
        day: {type: "integer", description: "星期几：1=周一 … 7=周日", minimum: 1, maximum: 7}
      }, required: ["day"]}
    }}
  ];

  const el = {};
  ["aiBall", "aiCapsule", "aiCapsuleText", "aiWindow", "aiHead", "aiTitle", "aiConfigBtn", "aiMinimize", "aiClose",
    "aiChatView", "aiPrivacyNote", "aiNoticeClose", "aiMessages", "aiContextChip", "aiThinkChip", "aiInput", "aiSend",
    "aiConfigView", "aiPreset", "aiBaseUrl", "aiModel", "aiModelList", "aiApiKey", "aiTemperature", "aiMaxTokens",
    "aiFetchModels", "aiClearKey", "aiSaveConfig", "aiBallVisible", "aiConfigStatus"].forEach((id) => {
    el[id] = document.getElementById(id);
  });

  const ai = {
    open: false, minimized: false, configOpen: false,
    config: {baseUrl: "", model: "", temperature: 1, maxTokens: 4096, hasKey: false, preset: "deepseek"},
    messages: [],
    streaming: false, requestId: 0, abort: null,
    sseBuffer: "", sseDone: false, assistantText: "", assistantReasoning: "", finishReason: "", usage: null,
    sseToolCalls: [], pendingTools: [], toolRound: 0,
    contextOn: localStorage.getItem(AI_CONTEXT_KEY) !== "off",
    thinkingOn: localStorage.getItem(AI_THINKING_KEY) === "on",
    native: Boolean(root.CourseAppNative && root.CourseAppNative.aiChatRequest)
  };
  let bubbleRefs = null;
  let dragState = null;

  function clamp(value, min, max) { return Math.max(min, Math.min(max, value)); }

  function ready(fn) {
    if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", fn);
    else fn();
  }

  function joinEndpoint(baseUrl, path) {
    let base = String(baseUrl || "").trim().replace(/\/+$/, "");
    if (!base) throw new Error("接口地址为空");
    if (!/^https?:\/\//i.test(base)) base = "https://" + base;
    if (/\/(chat\/completions|models)$/.test(base)) return base;
    return base + "/" + path;
  }

  function available() { return Boolean(!root.CourseAppNative || root.CourseAppNative.aiChatRequest); }

  function updateTitle() {
    el.aiTitle.textContent = ai.config.model ? `AI 助手 · ${ai.config.model}` : "AI 助手（未配置模型）";
  }

  function setConfigStatus(text) { el.aiConfigStatus.textContent = text || ""; }

  function syncChips() {
    const count = typeof state !== "undefined" && state ? state.sessions.length : 0;
    el.aiContextChip.textContent = ai.contextOn ? `附带课表 · ${count} 条` : "课表明细关";
    el.aiContextChip.classList.toggle("active", ai.contextOn);
    el.aiThinkChip.classList.toggle("active", ai.thinkingOn);
  }

  // ---------- 配置 ----------
  async function loadConfig() {
    try {
      if (ai.native) {
        const result = JSON.parse(root.CourseAppNative.getAiConfig());
        if (result.ok) ai.config = Object.assign(ai.config, result);
      } else {
        const response = await fetch("/api/ai/config", {cache: "no-store"});
        const result = await response.json();
        if (result.ok) ai.config = Object.assign(ai.config, result);
      }
    } catch (error) {
      setConfigStatus("配置读取失败：" + error.message);
    }
    syncConfigForm();
    updateTitle();
  }

  function syncConfigForm() {
    if (!AI_PRESETS[ai.config.preset]) ai.config.preset = "custom";
    el.aiPreset.value = ai.config.preset;
    el.aiBaseUrl.value = ai.config.baseUrl || "";
    el.aiModel.value = ai.config.model || "";
    el.aiTemperature.value = ai.config.temperature || 1;
    el.aiMaxTokens.value = ai.config.maxTokens || 4096;
    el.aiApiKey.value = "";
    el.aiApiKey.placeholder = ai.config.hasKey ? "已保存（输入可更换）" : "留空保持已保存的密钥";
    el.aiBallVisible.checked = localStorage.getItem(AI_BALL_VISIBLE_KEY) !== "hidden";
  }

  function collectConfig() {
    return {
      preset: el.aiPreset.value,
      baseUrl: el.aiBaseUrl.value.trim(),
      model: el.aiModel.value.trim(),
      temperature: clamp(Number(el.aiTemperature.value) || 1, 0, 2),
      maxTokens: clamp(Number(el.aiMaxTokens.value) || 4096, 256, 384000)
    };
  }

  async function saveConfig() {
    const config = collectConfig();
    if (!config.baseUrl) return setConfigStatus("请填写接口地址");
    if (!config.model) return setConfigStatus("请填写模型名称");
    const apiKey = el.aiApiKey.value.trim();
    try {
      if (ai.native) {
        const result = JSON.parse(root.CourseAppNative.saveAiConfig(JSON.stringify(config), apiKey));
        if (!result.ok) throw new Error(result.error || "保存失败");
        ai.config = Object.assign(ai.config, config, {hasKey: result.hasKey});
      } else {
        const body = Object.assign({}, config);
        if (apiKey) body.apiKey = apiKey;
        const response = await fetch("/api/ai/config", {
          method: "PUT", headers: {"Content-Type": "application/json"}, body: JSON.stringify(body)
        });
        const result = await response.json();
        if (!response.ok || !result.ok) throw new Error(result.error || "保存失败");
        ai.config = Object.assign(ai.config, result);
      }
      syncConfigForm();
      updateTitle();
      setConfigStatus("已保存" + (ai.config.hasKey ? "" : "（尚未设置 API Key）"));
      root.showToast && showToast("AI 设置已保存");
    } catch (error) {
      setConfigStatus("保存失败：" + error.message);
    }
  }

  async function clearKey() {
    try {
      if (ai.native) {
        const result = JSON.parse(root.CourseAppNative.saveAiConfig(JSON.stringify(collectConfig()), "-"));
        if (!result.ok) throw new Error(result.error || "清除失败");
        ai.config.hasKey = false;
      } else {
        const response = await fetch("/api/ai/config", {
          method: "PUT", headers: {"Content-Type": "application/json"}, body: JSON.stringify({apiKey: "-"})
        });
        const result = await response.json();
        if (!response.ok || !result.ok) throw new Error(result.error || "清除失败");
        ai.config.hasKey = false;
      }
      syncConfigForm();
      setConfigStatus("已清除本机保存的 API Key");
    } catch (error) {
      setConfigStatus("清除失败：" + error.message);
    }
  }

  async function fetchModels() {
    const baseUrl = el.aiBaseUrl.value.trim();
    setConfigStatus("正在获取模型列表…");
    try {
      let models = [];
      if (ai.native) {
        const id = String(Date.now());
        const reply = await new Promise((resolve) => {
          root.onAiModelsOnce = resolve;
          const result = JSON.parse(root.CourseAppNative.aiModelsRequest(id, joinEndpoint(baseUrl, "models")));
          if (!result.ok) resolve({error: result.error || "请求失败"});
        });
        if (reply.error) throw new Error(reply.error);
        models = (reply.data || []).map((item) => item.id).filter(Boolean);
      } else {
        const response = await fetch("/api/ai/models", {
          method: "POST", headers: {"Content-Type": "application/json"}, body: JSON.stringify({baseUrl})
        });
        const result = await response.json();
        if (!response.ok || !result.ok) throw new Error(result.error || "获取失败");
        models = (result.data || []).map((item) => item.id).filter(Boolean);
      }
      el.aiModelList.innerHTML = models.map((name) => `<option value="${String(name).replace(/"/g, "&quot;")}"></option>`).join("");
      setConfigStatus(models.length ? `获取到 ${models.length} 个模型` : "服务商未返回模型列表");
    } catch (error) {
      setConfigStatus("获取模型失败：" + error.message);
    }
  }

  // ---------- 上下文 ----------
  function buildSystemPrompt() {
    const lines = ["你是课程表应用内的 AI 助手，回答使用中文，保持简洁准确，不要编造课表里没有的内容。"];
    lines.push("以下学期与课表信息来自用户本机：");
    if (typeof state !== "undefined" && state) {
      lines.push(`学期：${state.semester.name || "未命名"}；共 ${state.semester.totalWeeks} 个教学周；第一教学周基准日 ${state.semester.weekOneStart}（第 1 周的星期一），实际开课日 ${state.semester.classStartDate}。任意日期所在的教学周 = 该日期与基准日的天数差除以 7 再加 1。`);
      if (state.periods.length) {
        lines.push("节次时间：" + state.periods.map((p) => `${p.number}(${p.start || "?"}–${p.end || "?"})`).join(" "));
      }
      if (ai.contextOn) {
        if (!state.sessions.length) {
          lines.push("课表明细为空：当前没有导入或录入任何课程。");
        } else {
          const sorted = [...state.sessions].sort((a, b) => a.day - b.day || a.periodStart - b.periodStart
            || String(a.name).localeCompare(String(b.name), "zh-CN"));
          const capped = sorted.slice(0, MAX_CONTEXT_SESSIONS);
          lines.push(`全部课程安排共 ${state.sessions.length} 条${sorted.length > capped.length ? `（数据较多，仅注入前 ${MAX_CONTEXT_SESSIONS} 条）` : ""}；未列出的日期没有课程：`);
          for (const session of capped) {
            const parts = [`${session.name}${session.code ? `(${session.code})` : ""}`,
              `周${SHORT_DAYS[session.day - 1]} 第${session.periodStart}-${session.periodEnd}节`,
              session.weekLabel || formatWeeks(session.weeks)];
            if (session.teacher) parts.push(session.teacher);
            if (session.location) parts.push("@" + session.location);
            if (session.campus) parts.push("@" + session.campus);
            lines.push("- " + parts.join(" "));
          }
        }
      } else {
        lines.push("用户未附带课程明细，仅提供学期与节次信息。");
      }
    } else {
      lines.push("课表暂未加载。");
    }
    return lines.join("\n");
  }

  function buildMessages() {
    const history = ai.messages.slice(-MAX_HISTORY_MESSAGES).map((item) => ({...item}));
    while (history.length && history[0].role !== "user") history.shift();
    if (typeof state !== "undefined" && state) {
      const today = new Date();
      const weekday = "一二三四五六日"[today.getDay() === 0 ? 6 : today.getDay() - 1];
      const position = teachingPosition();
      const phase = position.phase === "in" ? `第 ${position.week} 教学周`
        : position.phase === "before" ? "尚未开课" : "教学周已结束";
      const prefix = `【今天是 ${localDateKey(today)} 星期${weekday} · ${phase}】`;
      for (let index = history.length - 1; index >= 0; index -= 1) {
        if (history[index].role === "user") {
          history[index].content = prefix + history[index].content;
          break;
        }
      }
    }
    return [{role: "system", content: buildSystemPrompt()}].concat(history);
  }

  function buildBody(keepModel) {
    const body = {messages: buildMessages(), stream: true, stream_options: {include_usage: true}, tools: AI_TOOLS};
    if (keepModel) body.model = ai.config.model;
    body.max_tokens = ai.config.maxTokens || 4096;
    const preset = AI_PRESETS[ai.config.preset] || {};
    const thinkingSupported = Boolean(preset.thinking) || ai.thinkingOn;
    if (thinkingSupported) body.thinking = {type: ai.thinkingOn ? "enabled" : "disabled"};
    if (!ai.thinkingOn && ai.config.temperature && ai.config.temperature !== 1) body.temperature = ai.config.temperature;
    return JSON.stringify(body);
  }

  // ---------- 流式请求 ----------
  function providerError(status, detail) {
    const hint = AI_ERROR_HINTS[status] || (status ? `服务商返回 HTTP ${status}` : "网络连接失败");
    const snippet = detail ? `（${String(detail).slice(0, 200)}）` : "";
    return new Error(`${hint}${snippet}`);
  }

  async function send() {
    const text = el.aiInput.value.trim();
    if (!text || ai.streaming) return;
    if (ai.pendingTools.some((item) => item.status === "pending")) return showToast("请先处理上方的 AI 操作请求");
    if (!ai.config.baseUrl || !ai.config.model) {
      openWindow();
      showConfigView(true);
      return setConfigStatus("请先填写接口地址、模型名称和 API Key");
    }
    el.aiInput.value = "";
    autoGrow();
    ai.messages.push({role: "user", content: text});
    addBubble("user", text);
    startAssistantBubble();
    ai.streaming = true;
    updateSendButton();
    ai.requestId += 1;
    ai.sseBuffer = ""; ai.sseDone = false; ai.assistantText = ""; ai.assistantReasoning = "";
    ai.finishReason = ""; ai.usage = null; ai.sseToolCalls = []; ai.toolRound = 0; ai.pendingTools = [];
    const id = String(ai.requestId);
    try {
      if (ai.native) {
        const result = JSON.parse(root.CourseAppNative.aiChatRequest(id, joinEndpoint(ai.config.baseUrl, "chat/completions"), buildBody(true)));
        if (!result.ok) throw new Error(result.error || "无法发起请求");
      } else {
        await streamViaProxy(id, buildBody(false));
      }
    } catch (error) {
      failAssistant(error.message);
    }
  }

  async function continueChat() {
    if (ai.streaming) return;
    if (ai.toolRound >= MAX_TOOL_ROUNDS && ai.pendingTools.some((item) => item.status === "pending")) {
      for (const action of ai.pendingTools) {
        action.status = "rejected";
        action.result = JSON.stringify({ok: false, error: "连续操作次数已达上限"});
        updateToolCard(action);
      }
    }
    if (ai.pendingTools.length) pushToolResults();
    startStream();
  }

  function startStream() {
    ai.streaming = true;
    updateSendButton();
    ai.toolRound += 1;
    ai.requestId += 1;
    ai.sseBuffer = ""; ai.sseDone = false; ai.assistantText = ""; ai.assistantReasoning = "";
    ai.finishReason = ""; ai.usage = null; ai.sseToolCalls = [];
    startAssistantBubble();
    const id = String(ai.requestId);
    try {
      if (ai.native) {
        const result = JSON.parse(root.CourseAppNative.aiChatRequest(id, joinEndpoint(ai.config.baseUrl, "chat/completions"), buildBody(true)));
        if (!result.ok) throw new Error(result.error || "无法发起请求");
      } else {
        streamViaProxy(id, buildBody(false));
      }
    } catch (error) {
      failAssistant(error.message);
    }
  }

  async function streamViaProxy(id, bodyJson) {
    const controller = new AbortController();
    ai.abort = controller;
    const response = await fetch("/api/ai/chat", {
      method: "POST", headers: {"Content-Type": "application/json"}, body: bodyJson, signal: controller.signal
    });
    if (!response.ok) {
      const data = await response.json().catch(() => ({}));
      throw providerError(response.status, data.error);
    }
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    for (;;) {
      const part = await reader.read();
      if (part.done) break;
      feedSse(decoder.decode(part.value, {stream: true}));
    }
    finishStream();
  }

  function feedSse(text) {
    ai.sseBuffer += text;
    let index;
    while ((index = ai.sseBuffer.indexOf("\n")) >= 0) {
      const line = ai.sseBuffer.slice(0, index).replace(/\r$/, "");
      ai.sseBuffer = ai.sseBuffer.slice(index + 1);
      if (!line.startsWith("data:")) continue;
      const payload = line.slice(5).trim();
      if (!payload) continue;
      if (payload === "[DONE]") { ai.sseDone = true; continue; }
      let chunk;
      try { chunk = JSON.parse(payload); } catch (error) { continue; }
      const choice = chunk.choices && chunk.choices[0];
      if (choice) {
        const delta = choice.delta || {};
        if (delta.reasoning_content) appendReasoning(delta.reasoning_content);
        if (delta.content) appendContent(delta.content);
        if (delta.tool_calls) {
          for (const fragment of delta.tool_calls) {
            const index = fragment.index ?? 0;
            ai.sseToolCalls[index] = ai.sseToolCalls[index]
              || {id: "", type: "function", function: {name: "", arguments: ""}};
            if (fragment.id) ai.sseToolCalls[index].id = fragment.id;
            if (fragment.function && fragment.function.name) ai.sseToolCalls[index].function.name = fragment.function.name;
            if (fragment.function && fragment.function.arguments) ai.sseToolCalls[index].function.arguments += fragment.function.arguments;
          }
        }
        if (choice.finish_reason) ai.finishReason = choice.finish_reason;
      }
      if (chunk.usage) ai.usage = chunk.usage;
    }
  }

  function stopStream() {
    if (!ai.streaming) return;
    if (ai.native && root.CourseAppNative.aiCancel) root.CourseAppNative.aiCancel(String(ai.requestId));
    if (ai.abort) ai.abort.abort();
  }

  function finishStream() {
    if (!ai.streaming) return;
    ai.streaming = false;
    updateSendButton();
    if (ai.finishReason === "length") appendContent("\n（回复因达到 max_tokens 上限被截断）");
    if (ai.finishReason === "content_filter") appendContent("\n（内容被服务商安全策略拦截）");
    if (ai.finishReason === "tool_calls" && ai.sseToolCalls.length) {
      if (bubbleRefs && !ai.assistantText) bubbleRefs.root.classList.add("hidden");
      finalizeAssistantBubble();
      ai.messages.push({role: "assistant", content: ai.assistantText || null, tool_calls: ai.sseToolCalls});
      ai.pendingTools = ai.sseToolCalls.map((call) => {
        const parsed = parseToolArgs(call);
        const action = {call, status: "pending", result: "", args: parsed.args || {}, rendered: false};
        if (parsed.error) {
          action.status = "done";
          action.result = JSON.stringify({ok: false, error: parsed.error});
        } else if (call.function.name === "find_free_slots") {
          action.status = "done";
          action.result = JSON.stringify({ok: true, free_slots: toolFindFreeSlots(action.args.day)});
        }
        return action;
      });
      renderToolCards();
      if (!ai.pendingTools.some((item) => item.status === "pending")) {
        pushToolResults();
        continueChat();
      }
      return;
    }
    if (!ai.assistantText && !ai.assistantReasoning) {
      failAssistant("服务商未返回内容，请检查模型名称与设置。");
      return;
    }
    const usage = ai.usage;
    if (usage && bubbleRefs) {
      const hit = typeof usage.prompt_cache_hit_tokens === "number" ? `，缓存命中 ${usage.prompt_cache_hit_tokens}` : "";
      bubbleRefs.usage.textContent = `输入 ${usage.prompt_tokens || 0}${hit} · 输出 ${usage.completion_tokens || 0} tokens`;
    }
    finalizeAssistantBubble();
    ai.messages.push({role: "assistant", content: ai.assistantText || "（无文本回复）"});
    updateCapsule();
  }

  function failAssistant(message) {
    ai.streaming = false;
    updateSendButton();
    const lastMsg = ai.messages[ai.messages.length - 1];
    if (lastMsg && lastMsg.tool_calls) {
      for (const call of lastMsg.tool_calls) {
        ai.messages.push({role: "tool", tool_call_id: call.id, content: JSON.stringify({ok: false, error: message})});
      }
    }
    if (bubbleRefs) {
      bubbleRefs.root.classList.remove("ai-msg-assistant");
      bubbleRefs.root.classList.add("ai-msg-error");
      bubbleRefs.text.textContent = message;
      if (bubbleRefs.reasoning) bubbleRefs.reasoning.remove();
      if (bubbleRefs.usage) bubbleRefs.usage.remove();
      const retry = document.createElement("button");
      retry.className = "ai-note-close";
      retry.type = "button";
      retry.textContent = "重试";
      retry.addEventListener("click", () => {
        if (ai.streaming) return;
        const last = ai.messages[ai.messages.length - 1];
        if (last && last.role === "user") {
          ai.messages.pop();
          bubbleRefs.root.remove();
          el.aiInput.value = last.content;
          send();
        }
      });
      bubbleRefs.root.querySelector(".ai-bubble").after(retry);
      bubbleRefs = null;
    }
    scrollMessages();
  }

  function updateCapsule() {
    if (!ai.minimized) return;
    const last = ai.messages[ai.messages.length - 1];
    el.aiCapsuleText.textContent = ai.streaming ? "AI 正在回复…" : (last && last.content ? String(last.content).slice(0, 26) : "AI 助手");
  }

  // ---------- 消息渲染 ----------
  function addBubble(kind, text) {
    const wrap = document.createElement("div");
    wrap.className = `ai-msg ai-msg-${kind}`;
    const bubble = document.createElement("div");
    bubble.className = "ai-bubble";
    bubble.textContent = text;
    wrap.appendChild(bubble);
    el.aiMessages.appendChild(wrap);
    scrollMessages();
    return wrap;
  }

  function startAssistantBubble() {
    const wrap = document.createElement("div");
    wrap.className = "ai-msg ai-msg-assistant";
    const bubble = document.createElement("div");
    bubble.className = "ai-bubble";
    bubble.textContent = "";
    const reasoning = document.createElement("details");
    reasoning.className = "ai-reasoning";
    const summary = document.createElement("summary");
    summary.textContent = "思考过程";
    const reasoningText = document.createElement("pre");
    reasoningText.textContent = "";
    reasoning.append(summary, reasoningText);
    reasoning.hidden = true;
    const usage = document.createElement("div");
    usage.className = "ai-usage";
    wrap.append(bubble, reasoning, usage);
    el.aiMessages.appendChild(wrap);
    bubbleRefs = {root: wrap, text: bubble, reasoning, reasoningText, usage};
    scrollMessages();
  }

  function appendContent(text) {
    ai.assistantText += text;
    if (bubbleRefs) bubbleRefs.text.textContent = ai.assistantText;
    scrollMessages();
    updateCapsule();
  }

  function appendReasoning(text) {
    ai.assistantReasoning += text;
    if (bubbleRefs) {
      bubbleRefs.reasoning.hidden = false;
      if (!ai.assistantText) bubbleRefs.reasoning.open = true;
      bubbleRefs.reasoningText.textContent = ai.assistantReasoning;
    }
    updateCapsule();
  }

  function finalizeAssistantBubble() {
    if (bubbleRefs && !ai.assistantReasoning) bubbleRefs.reasoning.remove();
    bubbleRefs = null;
    scrollMessages();
  }

  function scrollMessages() { el.aiMessages.scrollTop = el.aiMessages.scrollHeight; }

  function updateSendButton() {
    el.aiSend.innerHTML = ai.streaming
      ? '<svg class="icon" aria-hidden="true"><use href="#i-stop"/></svg>'
      : '<svg class="icon" aria-hidden="true"><use href="#i-send"/></svg>';
    el.aiSend.classList.toggle("stop", ai.streaming);
    el.aiSend.setAttribute("aria-label", ai.streaming ? "停止" : "发送");
  }

  function autoGrow() {
    el.aiInput.style.height = "auto";
    el.aiInput.style.height = Math.min(120, el.aiInput.scrollHeight) + "px";
  }

  // ---------- 三态切换 ----------
  function openWindow() {
    ai.open = true;
    ai.minimized = false;
    el.aiWindow.classList.remove("hidden");
    el.aiCapsule.classList.add("hidden");
    el.aiBall.classList.add("ai-ball-active");
    syncChips();
    restoreWindowPos();
    setTimeout(() => el.aiInput.focus(), 60);
  }

  function closeWindow() {
    ai.open = false;
    ai.minimized = false;
    el.aiWindow.classList.add("hidden");
    el.aiCapsule.classList.add("hidden");
    el.aiBall.classList.remove("ai-ball-active");
  }

  function minimizeWindow() {
    if (!ai.open) return;
    ai.open = false;
    ai.minimized = true;
    el.aiWindow.classList.add("hidden");
    el.aiCapsule.classList.remove("hidden");
    updateCapsule();
  }

  function showConfigView(show) {
    ai.configOpen = show;
    el.aiConfigView.classList.toggle("hidden", !show);
    el.aiChatView.classList.toggle("hidden", show);
    if (show) syncConfigForm();
  }

  // ---------- 拖拽与位置 ----------
  function saveRect(target, key, snap) {
    const rect = target.getBoundingClientRect();
    let x = rect.left;
    if (snap) x = rect.left + rect.width / 2 < window.innerWidth / 2 ? 8 : window.innerWidth - rect.width - 8;
    const y = clamp(rect.top, 0, window.innerHeight - Math.min(rect.height, 120));
    localStorage.setItem(key, JSON.stringify({x: Math.round(x), y: Math.round(y)}));
    place(target, x, y);
  }

  function place(target, x, y) {
    target.style.left = x + "px";
    target.style.top = y + "px";
    target.style.right = "auto";
    target.style.bottom = "auto";
  }

  function restoreRect(target, key, fallback) {
    try {
      const pos = JSON.parse(localStorage.getItem(key) || "null");
      if (pos && Number.isFinite(pos.x) && Number.isFinite(pos.y)) {
        place(target, clamp(pos.x, 0, window.innerWidth - 60), clamp(pos.y, 0, window.innerHeight - 60));
        return;
      }
    } catch (error) { /* 使用默认位置 */ }
    if (fallback) fallback();
  }

  function makeDraggable(handle, target, posKey, snap, onTap, allowButton) {
    handle.addEventListener("pointerdown", (event) => {
      if (!allowButton && event.target.closest("button, select, input, textarea")) return;
      try { handle.setPointerCapture(event.pointerId); } catch (error) { /* 合成事件或指针已释放 */ }
      const rect = target.getBoundingClientRect();
      dragState = {target, posKey, snap, onTap, startX: event.clientX, startY: event.clientY,
        x: rect.left, y: rect.top, w: rect.width, h: rect.height, moved: false};
    });
    handle.addEventListener("pointermove", (event) => {
      if (!dragState || dragState.target !== target) return;
      const dx = event.clientX - dragState.startX;
      const dy = event.clientY - dragState.startY;
      if (Math.abs(dx) + Math.abs(dy) > 6) dragState.moved = true;
      if (dragState.moved) {
        place(target, clamp(dragState.x + dx, 0, window.innerWidth - dragState.w),
          clamp(dragState.y + dy, 0, window.innerHeight - Math.min(dragState.h, 120)));
      }
    });
    const release = (event) => {
      if (!dragState || dragState.target !== target) return;
      const state = dragState;
      dragState = null;
      try { handle.releasePointerCapture(event.pointerId); } catch (error) { /* 已释放 */ }
      if (state.moved) saveRect(target, state.posKey, state.snap);
      else if (state.onTap) state.onTap(event);
    };
    handle.addEventListener("pointerup", release);
    handle.addEventListener("pointercancel", release);
  }

  function restoreWindowPos() {
    restoreRect(el.aiWindow, AI_WINDOW_POS_KEY, null);
  }

  // ---------- 初始化 ----------
  function init() {
    if (!available()) return;
    syncChips();
    el.aiPrivacyNote.classList.toggle("hidden", localStorage.getItem(AI_NOTICE_KEY) === "seen");

    el.aiClose.addEventListener("click", closeWindow);
    el.aiMinimize.addEventListener("click", minimizeWindow);
    el.aiCapsule.addEventListener("click", openWindow);
    el.aiCapsule.addEventListener("keydown", (event) => { if (event.key === "Enter" || event.key === " ") openWindow(); });
    el.aiConfigBtn.addEventListener("click", () => showConfigView(!ai.configOpen));
    el.aiNoticeClose.addEventListener("click", () => {
      localStorage.setItem(AI_NOTICE_KEY, "seen");
      el.aiPrivacyNote.classList.add("hidden");
    });
    el.aiContextChip.addEventListener("click", () => {
      ai.contextOn = !ai.contextOn;
      localStorage.setItem(AI_CONTEXT_KEY, ai.contextOn ? "on" : "off");
      syncChips();
    });
    el.aiThinkChip.addEventListener("click", () => {
      ai.thinkingOn = !ai.thinkingOn;
      localStorage.setItem(AI_THINKING_KEY, ai.thinkingOn ? "on" : "off");
      syncChips();
    });
    el.aiSend.addEventListener("click", () => { ai.streaming ? stopStream() : send(); });
    el.aiInput.addEventListener("input", autoGrow);
    el.aiInput.addEventListener("keydown", (event) => {
      if (event.key === "Enter" && !event.shiftKey) { event.preventDefault(); send(); }
    });
    el.aiPreset.addEventListener("change", () => {
      const preset = AI_PRESETS[el.aiPreset.value];
      if (preset && el.aiPreset.value !== "custom") {
        el.aiBaseUrl.value = preset.baseUrl;
        if (preset.model) el.aiModel.value = preset.model;
      }
    });
    el.aiSaveConfig.addEventListener("click", saveConfig);
    el.aiClearKey.addEventListener("click", clearKey);
    el.aiFetchModels.addEventListener("click", fetchModels);
    el.aiBallVisible.addEventListener("change", () => {
      localStorage.setItem(AI_BALL_VISIBLE_KEY, el.aiBallVisible.checked ? "shown" : "hidden");
      el.aiBall.classList.toggle("hidden", !el.aiBallVisible.checked);
      if (!el.aiBallVisible.checked) closeWindow();
    });
    el.aiMessages.addEventListener("click", (event) => {
      const confirmBtn = event.target.closest("[data-tool-confirm]");
      const cancelBtn = event.target.closest("[data-tool-cancel]");
      if (!confirmBtn && !cancelBtn) return;
      const card = (confirmBtn || cancelBtn).closest(".ai-tool-card");
      if (!card) return;
      const action = ai.pendingTools[Number(card.dataset.toolIndex)];
      if (action) resolveTool(action, Boolean(confirmBtn));
    });

    makeDraggable(el.aiBall, el.aiBall, AI_BALL_POS_KEY, true, () => openWindow(), true);
    makeDraggable(el.aiHead, el.aiWindow, AI_WINDOW_POS_KEY, false, null);
    restoreRect(el.aiBall, AI_BALL_POS_KEY, null);

    if (localStorage.getItem(AI_BALL_VISIBLE_KEY) !== "hidden") el.aiBall.classList.remove("hidden");
    loadConfig();

    if (root.visualViewport) {
      root.visualViewport.addEventListener("resize", () => {
        if (!ai.open || ai.minimized) return;
        const rect = el.aiWindow.getBoundingClientRect();
        const overflow = rect.bottom - root.visualViewport.height;
        if (overflow > 0) place(el.aiWindow, rect.left, Math.max(0, rect.top - overflow));
      });
    }
  }

  root.onAiChunk = function (id, text) { if (id === String(ai.requestId) && ai.streaming) feedSse(text); };
  root.onAiDone = function (id) { if (id === String(ai.requestId)) finishStream(); };
  root.onAiError = function (id, status, message) {
    if (id !== String(ai.requestId)) return;
    failAssistant(providerError(Number(status) || 0, message).message);
  };
  root.onAiModels = function (id, payloadJson) {
    if (typeof root.onAiModelsOnce === "function") {
      const resolve = root.onAiModelsOnce;
      root.onAiModelsOnce = null;
      try { resolve(JSON.parse(payloadJson)); } catch (error) { resolve({error: "响应解析失败"}); }
    }
  };
  root.onAiModelsOnce = null;

  function parseToolArgs(call) {
    let args = {};
    try {
      args = JSON.parse(call.function.arguments || "{}");
    } catch (error) {
      return {error: "工具参数不是有效 JSON"};
    }
    if (typeof args !== "object" || args === null || Array.isArray(args)) return {error: "工具参数格式不正确"};
    const validation = validateToolArgs(call.function.name, args);
    if (validation.errors.length) return {error: "参数不合法：" + validation.errors.join("；")};
    return {args: validation.clean};
  }

  function validateToolArgs(name, args) {
    const errors = [];
    const clean = {};
    const intField = (key, min, max) => {
      if (args[key] === undefined) return;
      const value = Number(args[key]);
      if (!Number.isInteger(value) || value < min || value > max) {
        errors.push(`${key} 必须是 ${min}-${max} 的整数`);
        return;
      }
      clean[key] = value;
    };
    const strField = (key, limit) => {
      if (args[key] === undefined || args[key] === null) return;
      const value = String(args[key]).replace(/\s+/g, " ").trim();
      if (!value) return;
      clean[key] = value.slice(0, limit);
    };
    intField("day", 1, 7);
    intField("new_day", 1, 7);
    intField("period_start", 1, 13);
    intField("period_end", 1, 13);
    intField("new_period_start", 1, 13);
    intField("new_period_end", 1, 13);
    strField("name", 80);
    strField("code", 30);
    strField("teacher", 40);
    strField("new_teacher", 40);
    strField("location", 100);
    strField("new_location", 100);
    strField("campus", 100);
    strField("notes", 200);
    if (args.weeks !== undefined) {
      const weeks = normalizeToolWeeks(args.weeks);
      if (!weeks) errors.push("weeks 必须是 1-30 的周次列表");
      else clean.weeks = weeks;
    }
    if (args.new_weeks !== undefined) {
      const weeks = normalizeToolWeeks(args.new_weeks);
      if (!weeks) errors.push("new_weeks 必须是 1-30 的周次列表");
      else clean.new_weeks = weeks;
    }
    if (name === "add_course") {
      if (!clean.name) errors.push("缺少课程名称");
      if (clean.day === undefined) errors.push("缺少星期");
      if (clean.period_start === undefined || clean.period_end === undefined) errors.push("缺少节次");
      if (!clean.weeks) errors.push("缺少周次");
    }
    if ((name === "update_course" || name === "delete_course") && !clean.name) errors.push("缺少课程名称");
    if (name === "find_free_slots" && clean.day === undefined) errors.push("缺少星期");
    if (clean.period_start !== undefined && clean.period_end !== undefined && clean.period_start > clean.period_end) errors.push("开始节次不能晚于结束节次");
    if (clean.new_period_start !== undefined && clean.new_period_end !== undefined && clean.new_period_start > clean.new_period_end) errors.push("开始节次不能晚于结束节次");
    return {errors, clean};
  }

  function normalizeToolWeeks(value) {
    let weeks = null;
    if (Array.isArray(value)) weeks = value.map(Number);
    else if (typeof value === "string") {
      try { weeks = parseWeeks(value); } catch (error) { return null; }
    }
    if (!Array.isArray(weeks)) return null;
    weeks = [...new Set(weeks.map(Number))].filter((week) => Number.isInteger(week) && week >= 1 && week <= 30).sort((a, b) => a - b);
    return weeks.length ? weeks : null;
  }

  function toolFindFreeSlots(day) {
    const periods = weekGridPeriods();
    const busy = new Map();
    for (const session of state.sessions) {
      if (session.day !== day) continue;
      if (!(session.weeks || []).includes(selectedWeek)) continue;
      for (let p = session.periodStart; p <= session.periodEnd; p += 1) busy.set(p, session.name);
    }
    return periods
      .filter((period) => !busy.has(period.number))
      .map((period) => ({period: period.number, time: period.start && period.end ? `${period.start}–${period.end}` : ""}));
  }

  function executeTool(name, args) {
    if (name === "find_free_slots") {
      return {ok: true, free_slots: toolFindFreeSlots(args.day)};
    }
    if (name === "add_course") {
      const session = {
        id: `custom-${Date.now()}`,
        code: args.code || "", name: args.name, teacher: args.teacher || "",
        day: args.day, periodStart: args.period_start, periodEnd: args.period_end,
        weeks: args.weeks, weekLabel: formatWeeks(args.weeks),
        location: args.location || "", campus: args.campus || state.semester.campus || "",
        notes: args.notes || "",
        color: window.CourseExcelImport?.colorFor ? CourseExcelImport.colorFor(args.name) : DEFAULT_COLOR
      };
      const conflicts = state.sessions.filter((item) => item.day === session.day
        && item.weeks.some((week) => session.weeks.includes(week))
        && item.periodStart <= session.periodEnd && session.periodStart <= item.periodEnd)
        .map((item) => item.name);
      state.sessions.push(session);
      syncActiveSemesterEntry();
      return {ok: true, summary: `已新增 ${session.name} 周${SHORT_DAYS[session.day - 1]} 第${session.periodStart}-${session.periodEnd}节`,
        conflicts: conflicts.length ? conflicts : undefined};
    }
    if (name === "update_course" || name === "delete_course") {
      const matches = state.sessions.filter((item) => item.name === args.name || item.name.includes(args.name));
      let narrowed = matches;
      if (args.day !== undefined) narrowed = narrowed.filter((item) => item.day === args.day);
      if (args.period_start !== undefined) narrowed = narrowed.filter((item) => item.periodStart === args.period_start);
      if (!narrowed.length) return {ok: false, error: matches.length ? "找到多门同名课程，请说明星期或节次" : `没有找到课程「${args.name}」`};
      if (narrowed.length > 1) return {ok: false, error: `有 ${narrowed.length} 门匹配课程，请说明星期或节次`};
      const target = narrowed[0];
      if (name === "delete_course") {
        state.sessions = state.sessions.filter((item) => item.id !== target.id);
        state.attendance = Object.fromEntries(Object.entries(state.attendance || {}).filter(([key]) => !key.endsWith("|" + target.id)));
        syncActiveSemesterEntry();
        return {ok: true, summary: `已删除 ${target.name}`};
      }
      if (args.new_day !== undefined) target.day = args.new_day;
      if (args.new_period_start !== undefined) target.periodStart = args.new_period_start;
      if (args.new_period_end !== undefined) target.periodEnd = args.new_period_end;
      if (args.new_weeks !== undefined) {
        target.weeks = args.new_weeks;
        target.weekLabel = formatWeeks(target.weeks);
      }
      if (args.new_teacher !== undefined) target.teacher = args.new_teacher;
      if (args.new_location !== undefined) target.location = args.new_location;
      syncActiveSemesterEntry();
      return {ok: true, summary: `已修改 ${target.name}`};
    }
    return {ok: false, error: `不支持的工具：${name}`};
  }

  function describeToolCall(name, args) {
    const dayName = (day) => (day ? `周${SHORT_DAYS[day - 1]}` : "");
    if (name === "add_course") {
      const rows = [["操作", "新增课程"], ["课程", args.name || ""],
        ["时间", `${dayName(args.day)} 第${args.period_start}-${args.period_end}节`],
        ["周次", args.weeks ? formatWeeks(args.weeks) : ""],
        ["教师", args.teacher || ""], ["地点", args.location || ""]];
      return {title: "AI 想新增课程", rows: rows.filter((row) => row[1])};
    }
    if (name === "update_course") {
      const changes = [];
      if (args.new_day !== undefined) changes.push(`改为${dayName(args.new_day)}`);
      if (args.new_period_start !== undefined) changes.push(`节次改为第${args.new_period_start}-${args.new_period_end || args.new_period_start}节`);
      if (args.new_weeks) changes.push(`周次改为${formatWeeks(args.new_weeks)}`);
      if (args.new_teacher) changes.push(`教师改为${args.new_teacher}`);
      if (args.new_location) changes.push(`地点改为${args.new_location}`);
      return {title: "AI 想修改课程", rows: [["课程", args.name || ""]].concat(changes.map((item) => ["变更", item]))};
    }
    if (name === "delete_course") {
      const scope = [dayName(args.day), args.period_start ? `第${args.period_start}节起` : ""].filter(Boolean).join(" ");
      return {title: "AI 想删除课程", rows: [["课程", args.name || ""], ["限定", scope || "同名全部"]]};
    }
    return {title: `AI 请求调用 ${name}`, rows: []};
  }

  function renderToolCards() {
    ai.pendingTools.forEach((action, index) => {
      if (action.rendered) return;
      action.rendered = true;
      const info = describeToolCall(action.call.function.name, action.args);
      const wrap = document.createElement("div");
      wrap.className = "ai-msg ai-msg-tool";
      wrap.innerHTML = `<div class="ai-tool-card" data-tool-index="${index}">
        <strong>${escapeHtml(info.title)}</strong>
        <div class="ai-tool-fields">${info.rows.map((row) => `<div><span>${escapeHtml(row[0])}</span><b>${escapeHtml(row[1])}</b></div>`).join("")}</div>
        <div class="ai-tool-actions">
          <button class="ai-btn primary" data-tool-confirm type="button">确认执行</button>
          <button class="ai-btn" data-tool-cancel type="button">取消</button>
        </div>
      </div>`;
      el.aiMessages.appendChild(wrap);
    });
    scrollMessages();
  }

  function updateToolCard(action) {
    const index = ai.pendingTools.indexOf(action);
    const card = el.aiMessages.querySelector(`[data-tool-index="${index}"]`);
    if (!card) return;
    const actions = card.querySelector(".ai-tool-actions");
    if (actions) actions.innerHTML = `<span class="ai-tool-done">${action.status === "done" ? "✓ 已执行" : "已取消"}</span>`;
  }

  function pushToolResults() {
    for (const action of ai.pendingTools) {
      ai.messages.push({role: "tool", tool_call_id: action.call.id, content: action.result || "{}"});
    }
    ai.pendingTools = [];
  }

  async function resolveTool(action, approved) {
    if (action.status !== "pending") return;
    if (approved) {
      const outcome = executeTool(action.call.function.name, action.args);
      if (outcome.ok && action.call.function.name !== "find_free_slots") {
        try {
          await saveState("AI 已更新课表");
        } catch (error) {
          outcome.save_error = error.message;
        }
      }
      action.status = "done";
      action.result = JSON.stringify(outcome);
      if (typeof render === "function") render();
      if (typeof syncChips === "function") syncChips();
    } else {
      action.status = "rejected";
      action.result = JSON.stringify({ok: false, error: "用户取消了该操作"});
    }
    updateToolCard(action);
    if (!ai.pendingTools.some((item) => item.status === "pending")) {
      pushToolResults();
      await continueChat();
    }
  }

  ready(init);
})(typeof window !== "undefined" ? window : globalThis);
