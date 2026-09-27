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
    const history = ai.messages.slice(-MAX_HISTORY_MESSAGES).map((item) => ({role: item.role, content: item.content}));
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
    const body = {messages: buildMessages(), stream: true, stream_options: {include_usage: true}};
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
    ai.finishReason = ""; ai.usage = null;
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
    el.aiSend.textContent = ai.streaming ? "■" : "➤";
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

  ready(init);
})(typeof window !== "undefined" ? window : globalThis);
