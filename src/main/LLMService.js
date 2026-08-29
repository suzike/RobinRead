'use strict';
/**
 * RobinRead（知更）— LLM 服务
 *
 * - OpenAI 兼容 /chat/completions（DeepSeek thinking 控制）
 * - SSE 流式 + 非流式回退
 * - summary / articleContext / explainSelection / askSelection / translate / translateBatch
 * - ArticleChunker（截断、上下文窗口、翻译分段）
 */
const { i18n } = require('./I18N');
const { usesDeepSeekAPI } = require('./Models');

class LLMServiceError extends Error {
  constructor(kind, code, message) {
    const messages = {
      invalidBaseURL: 'Base URL 无效。',
      insecureEndpoint: '仅允许 HTTPS；局域网 HTTP 需在设置中明确开启。',
      invalidResponse: '模型返回的内容无法识别。',
      emptyResponse: '模型没有返回文本。',
      authenticationFailed: '身份验证失败。请在设置中检查 DeepSeek API Key 是否有效、完整且仍有权限。',
      rateLimited: '请求过于频繁或当前额度受限。请稍后重试，并检查服务商账户额度。',
      missingAPIKey: '尚未设置 API Key。请先在设置中完成 AI 服务配置。',
      requestInProgress: '已有 AI 任务正在进行，请稍后再试。',
    };
    super(kind === 'httpStatus' ? i18n.localizedFormat('模型接口返回 HTTP %lld：%@', code, message) : (messages[kind] || kind));
    this.kind = kind;
    this.httpCode = code;
  }
}

class LLMService {
  async test(configuration, apiKey) {
    await this.complete({
      prompt: 'Reply with exactly OK.',
      system: 'You are a connectivity test.',
      configuration,
      apiKey,
    });
  }

  async complete({ prompt, system, configuration, apiKey, onDelta = null, forceDisableReasoning = false, overrideTemperature = null }) {
    const stream = onDelta != null;
    const request = makeRequest({ prompt, system, configuration, apiKey, stream, forceDisableReasoning, overrideTemperature });
    if (stream) {
      try {
        return await this._stream(request, onDelta);
      } catch (err) {
        if (err instanceof LLMServiceError && err.kind === 'emptyResponse') {
          // 部分 OpenAI 兼容服务接受 stream:true 却返回普通 JSON；仅此场景回退
          const fallback = makeRequest({ prompt, system, configuration, apiKey, stream: false, forceDisableReasoning, overrideTemperature });
          const text = await this._nonStreaming(fallback);
          await onDelta(text);
          return text;
        }
        throw err;
      }
    }
    return this._nonStreaming(request);
  }

  async summary(text, configuration, apiKey, onDelta = null) {
    return this.complete({
      prompt: `Article:\n\n${ArticleChunker.truncate(text, 28000)}`,
      system: `Summarize the article in ${configuration.targetLanguage}. Start with one concise conclusion, then give 3 to 7 factual bullets. Do not invent sources or facts.`,
      configuration, apiKey, onDelta,
      overrideTemperature: 0.1,
    });
  }

  /** 高质量中文摘要：结构化编辑级输出（总览/要点/数据/启示）。 */
  async richSummary(text, configuration, apiKey, onDelta = null) {
    return this.complete({
      prompt: `文章全文：\n\n${ArticleChunker.truncate(text, 60000)}`,
      system: `你是一位顶级中文科技编辑，为读者产出高质量的中文摘要。严格基于原文，禁止编造。用 Markdown 输出以下结构：
**一句话总览**：一句话说清这篇文章讲了什么、为什么值得读。
**核心要点**：5-8 条，每条以加粗小标题开头，后接 1-2 句说明；按重要性排序。
**关键数据与事实**：列出文中出现的具体数字、名称、结论（没有则省略本节）。
**结论与启示**：2-3 句，给出对读者的实际意义或行动建议。`,
      configuration, apiKey, onDelta,
      forceDisableReasoning: true,
      overrideTemperature: 0.2,
    });
  }

  /** 一键精读：中文深读笔记（主旨/脉络/概念/证据/局限/金句/行动）。 */
  async deepRead(text, configuration, apiKey, onDelta = null) {
    return this.complete({
      prompt: `文章全文：\n\n${ArticleChunker.truncate(text, 60000)}`,
      system: `你是一位严谨的中文深度阅读助手，为读者做一次精读笔记。严格基于原文，禁止编造。用 Markdown 输出以下结构：
**主旨**：这篇文章的核心主张，1-2 句。
**论证脉络**：按文章结构梳理 2-5 段，每段以加粗小标题概括该部分在论证中的作用。
**关键概念**：解释文中出现的专业术语/缩写（术语：解释），最多 8 个。
**证据与数据**：支撑主张的关键实验、案例、数字（没有则省略本节）。
**局限与另一面**：作者未展开的假设、潜在反例或对立视角，2-3 句。
**金句摘录**：≤3 条原文最有价值的句子（用引用格式）。
**读后行动**：1-2 条可操作的下一步（阅读、实践或验证）。`,
      configuration, apiKey, onDelta,
      forceDisableReasoning: true,
      overrideTemperature: 0.3,
    });
  }

  async articleContext(text, configuration, apiKey) {
    return this.complete({
      prompt: `Article:\n\n${ArticleChunker.contextualArticle(text, '', 60000)}`,
      system: `Create a compact reusable context memo for later questions about this article, in ${configuration.targetLanguage}. Preserve the thesis, section structure, key entities, definitions, evidence, and relationships between claims. State only what the article says. Use concise structured prose and keep the memo under 1,200 words.`,
      configuration, apiKey,
      overrideTemperature: 0.1,
    });
  }

  async explainSelection({ selection, localContext, articleContext, configuration, apiKey, onDelta = null }) {
    let systemPrompt = `你是一位清晰、讲人话的阅读助手。读者在阅读文章时划选了一段文字（由于划词操作可能存在 1-2 行误差，请自动定位读者真正未理解的核心语句或名词概念），请用${configuration.targetLanguage}进行通俗解构。

回答准则：
1. 直白解读：直接用平实、易懂的语言解释这句话或关键句到底在表达什么意思。
2. 术语与概念拆解：若划选内容中包含专业术语、缩写、技术名词或暗喻，单列并简要解释清楚。
3. 严禁事项：绝对禁止分析文章结构、段落作用、修辞手法、起承转合或“呼应上下文/前文”等阅读理解式套话。只聚焦于帮助读者看懂语句本身。
4. 格式与字数：保持简洁直接（控制在 100-180 个字左右），不要重复引用原文，不要使用问候套话。`;
    const trimmedCustom = (configuration.customPrompt || '').trim();
    if (trimmedCustom) {
      systemPrompt += `\n\nAdditional user preference: ${trimmedCustom}`;
    }
    return this.complete({
      prompt: `Article context memo:\n${ArticleChunker.truncate(articleContext, 10000)}\n\nNearby paragraphs:\n${ArticleChunker.truncate(localContext, 5000)}\n\nSelected passage:\n${ArticleChunker.truncate(selection, 4000)}`,
      system: systemPrompt,
      configuration, apiKey, onDelta,
      forceDisableReasoning: true,
      overrideTemperature: 0.2,
    });
  }

  async askSelection({ selection, question, localContext, articleContext, history = null, configuration, apiKey, onDelta = null }) {
    let systemPrompt = `你是一位渊博且贴心的阅读助手。读者正在阅读一篇文章，并针对划选的文本提出了具体问题。请结合划选内容与文章上下文，用${configuration.targetLanguage}进行针对性回答。

回答准则：
1. 针对性解答：切中读者提问的核心，直接回答问题，语言平实易懂。
2. 结合划选文本：紧扣划选段落与上下文，拆解相关专业概念或逻辑。
3. 严禁事项：绝对禁止分析文章结构起承转合，不要重复问题或完整引用原文，不要使用问候套话。
4. 格式与字数：控制在 120-220 字左右，可适度使用 Markdown 加粗或短列表。`;
    const trimmedCustom = (configuration.customPrompt || '').trim();
    if (trimmedCustom) {
      systemPrompt += `\n\n额外用户偏好指令：${trimmedCustom}`;
    }
    const historyBlock = (history && history.length)
      ? `\n\n此前的问答记录（读者可能在追问）：\n${history.slice(-4).map((h) => `问：${h.question}\n答：${h.answer}`).join('\n\n')}`
      : '';
    return this.complete({
      prompt: `文章全局上下文:\n${ArticleChunker.truncate(articleContext, 10000)}\n\n划选段落上下文:\n${ArticleChunker.truncate(localContext, 5000)}\n\n划选文本:\n${ArticleChunker.truncate(selection, 4000)}\n\n读者的提问:\n${ArticleChunker.truncate(question, 1000)}${historyBlock}`,
      system: systemPrompt,
      configuration, apiKey, onDelta,
      forceDisableReasoning: true,
      overrideTemperature: 0.2,
    });
  }

  async translate(paragraph, configuration, apiKey, onDelta = null) {
    return this.complete({
      prompt: paragraph,
      system: `Translate the following passage into ${configuration.targetLanguage}. Preserve meaning, tone, numbers, names, links, and Markdown. Return only the translation.`,
      configuration, apiKey, onDelta,
      forceDisableReasoning: true,
      overrideTemperature: 0.0,
    });
  }

  async translateBatch(paragraphs, configuration, apiKey) {
    if (paragraphs.length === 0) return [];
    if (paragraphs.length === 1) {
      return [await this.translate(paragraphs[0], configuration, apiKey)];
    }
    const prompt = `Translate every string in this JSON array into ${configuration.targetLanguage}.
Keep array order exactly unchanged. Preserve meaning, tone, numbers, names, links, and Markdown.
Return ONLY a valid JSON array of translated strings: no Markdown fence, no explanation, and no omitted item.

${JSON.stringify(paragraphs)}`;
    const output = await this.complete({
      prompt,
      system: 'You are a precise translation engine. The response must be valid JSON and must contain exactly one translated string for every input string.',
      configuration, apiKey,
      forceDisableReasoning: true,
      overrideTemperature: 0.0,
    });
    const translations = decodeBatchTranslations(output);
    if (
      translations.length !== paragraphs.length
      || translations.some((t) => !t.trim())
    ) {
      throw new LLMServiceError('invalidResponse');
    }
    return translations;
  }

  async _nonStreaming(request) {
    const response = await fetchWithTimeout(request);
    const data = Buffer.from(await response.arrayBuffer());
    validateHTTP(response, data);
    let result;
    try {
      result = JSON.parse(data.toString('utf8'));
    } catch (_) {
      throw new LLMServiceError('invalidResponse');
    }
    const text = result?.choices?.[0]?.message?.content?.trim();
    if (!text) throw new LLMServiceError('invalidResponse');
    return text;
  }

  async _stream(request, onDelta) {
    const response = await fetchWithTimeout(request);
    if (!response.ok) {
      const data = Buffer.from(await response.arrayBuffer());
      validateHTTP(response, data);
      throw new LLMServiceError('invalidResponse');
    }
    const decoder = new TextDecoder('utf8');
    let output = '';
    let buffer = '';
    let done = false;
    for await (const chunk of response.body) {
      buffer += decoder.decode(chunk, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() ?? '';
      for (const rawLine of lines) {
        const line = rawLine.trim();
        if (!line.startsWith('data:')) continue;
        const value = line.slice(5).trim();
        if (value === '[DONE]') { done = true; break; }
        let parsed;
        try { parsed = JSON.parse(value); } catch (_) { continue; }
        const delta = parsed?.choices?.[0]?.delta?.content;
        if (delta) {
          output += delta;
          await onDelta(delta);
        }
      }
      if (done) break;
    }
    if (!output) throw new LLMServiceError('emptyResponse');
    return output;
  }
}

async function fetchWithTimeout(request) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 90000);
  try {
    return await fetch(request.url, {
      method: 'POST',
      headers: request.headers,
      body: request.body,
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timer);
  }
}

function validateHTTP(response, data) {
  if (response.ok) return;
  if (response.status === 401 || response.status === 403) throw new LLMServiceError('authenticationFailed');
  if (response.status === 429) throw new LLMServiceError('rateLimited');
  let body = '';
  try { body = JSON.stringify(JSON.parse(data.toString('utf8'))); } catch (_) { body = data.subarray(0, 500).toString('utf8'); }
  throw new LLMServiceError('httpStatus', response.status, body);
}

/**
 * 清理发给模型的文本：
 * 1. 「孤立代理」替换为 U+FFFD——文章标题/摘要按字符数截断时，emoji（代理对）
 *    可能被拦腰截断留下半截 \uD83D；JSON.stringify 会写成非法 \uXXXX 转义，
 *    导致模型接口报「unexpected end of hex escape」HTTP 400。
 * 2. C0 控制字符与 DEL（\n \t 除外）替换为空格——脏 feed 可能混入，部分网关同样拒绝。
 */
function sanitizeLLMText(value) {
  const s = String(value ?? '');
  let out = '';
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    if (c >= 0xd800 && c <= 0xdbff) {
      const next = i + 1 < s.length ? s.charCodeAt(i + 1) : -1;
      if (next >= 0xdc00 && next <= 0xdfff) {
        out += s[i] + s[i + 1];
        i += 1;
      } else {
        out += '\uFFFD';
      }
    } else if (c >= 0xdc00 && c <= 0xdfff) {
      out += '\uFFFD';
    } else if ((c < 0x20 && c !== 0x0a && c !== 0x09) || c === 0x7f) {
      out += ' ';
    } else {
      out += s[i];
    }
  }
  return out;
}

/** 构建请求体。 */
function makeRequest({ prompt, system, configuration, apiKey, stream, forceDisableReasoning = false, overrideTemperature = null }) {
  const trimmedBase = (configuration.baseURL || '').trim();
  let base;
  try {
    base = new URL(trimmedBase);
  } catch (_) {
    throw new LLMServiceError('invalidBaseURL');
  }
  if (base.protocol !== 'https:' && !(configuration.allowInsecureLocalEndpoint && base.protocol === 'http:')) {
    throw new LLMServiceError('insecureEndpoint');
  }
  const root = base.pathname.endsWith('/') ? base.pathname.slice(0, -1) : base.pathname;
  const url = `${base.origin}${root}/chat/completions`;

  const headers = {
    'Content-Type': 'application/json',
    Accept: 'application/json',
  };
  if (apiKey) headers.Authorization = `Bearer ${apiKey}`;

  let thinking = null;
  let reasoningEffort = null;
  if (usesDeepSeekAPI(configuration)) {
    if (forceDisableReasoning) {
      thinking = { type: 'disabled' };
    } else {
      switch (configuration.reasoningMode) {
        case '关闭': thinking = { type: 'disabled' }; break;
        case '低': thinking = { type: 'enabled' }; reasoningEffort = 'low'; break;
        case '中': thinking = { type: 'enabled' }; reasoningEffort = 'medium'; break;
        case '高': thinking = { type: 'enabled' }; reasoningEffort = 'high'; break;
        default: thinking = { type: 'enabled' }; break;
      }
    }
  }

  const body = {
    model: configuration.model,
    messages: [
      { role: 'system', content: sanitizeLLMText(system) },
      { role: 'user', content: sanitizeLLMText(prompt) },
    ],
    temperature: overrideTemperature ?? configuration.temperature,
    stream,
  };
  if (thinking) body.thinking = thinking;
  if (reasoningEffort) body.reasoning_effort = reasoningEffort;

  return { url, headers, body: JSON.stringify(body) };
}

function decodeBatchTranslations(response) {
  let payload = String(response ?? '').trim();
  if (payload.startsWith('```')) {
    const firstNewline = payload.indexOf('\n');
    if (firstNewline < 0) throw new LLMServiceError('invalidResponse');
    payload = payload.slice(firstNewline + 1);
    const closing = payload.lastIndexOf('```');
    if (closing >= 0) payload = payload.slice(0, closing);
    payload = payload.trim();
  }
  try {
    const values = JSON.parse(payload);
    if (Array.isArray(values)) return values;
  } catch (_) { /* 尝试包装形式 */ }
  try {
    const wrapped = JSON.parse(payload);
    if (Array.isArray(wrapped?.translations)) return wrapped.translations;
  } catch (_) { /* 放弃 */ }
  throw new LLMServiceError('invalidResponse');
}

// MARK: - ArticleChunker（1:1 移植）

const ArticleChunker = {
  paragraphs(text) {
    return String(text ?? '')
      .split('\n\n')
      .map((p) => p.trim())
      .filter(Boolean);
  },

  translationSegments(text, maximumCharacters = 5000) {
    const result = [];
    for (const paragraph of this.paragraphs(text)) {
      if ([...paragraph].length <= maximumCharacters) {
        result.push(paragraph);
        continue;
      }
      let remainder = paragraph;
      while (remainder.length > maximumCharacters) {
        const window = remainder.slice(0, maximumCharacters);
        let boundary = -1;
        for (let i = window.length - 1; i >= 0; i -= 1) {
          if ('.!?。！？；;'.includes(window[i])) { boundary = i; break; }
        }
        const end = boundary >= 0 ? boundary + 1 : maximumCharacters;
        const piece = remainder.slice(0, end).trim();
        if (piece) result.push(piece);
        remainder = remainder.slice(end);
      }
      const tail = remainder.trim();
      if (tail) result.push(tail);
    }
    return result;
  },

  truncate(text, maximumCharacters) {
    if (text.length <= maximumCharacters) return text;
    return `${text.slice(0, maximumCharacters)}\n\n[Content truncated for this operation]`;
  },

  contextualArticle(text, selection, maximumCharacters) {
    if (text.length <= maximumCharacters) return text;
    const edgeBudget = Math.min(8000, Math.floor(maximumCharacters / 5));
    const neighborhoodBudget = maximumCharacters - edgeBudget * 2;
    const opening = text.slice(0, edgeBudget);
    const ending = text.slice(-edgeBudget);

    let neighborhood;
    const selectionOffset = selection ? text.indexOf(selection) : -1;
    if (selectionOffset > 0 && selection) {
      const startOffset = Math.max(0, selectionOffset - Math.floor(neighborhoodBudget / 2));
      const remaining = text.length - startOffset;
      neighborhood = text.slice(startOffset, startOffset + Math.min(neighborhoodBudget, remaining));
    } else {
      const middleOffset = Math.max(0, Math.floor((text.length - neighborhoodBudget) / 2));
      const remaining = text.length - middleOffset;
      neighborhood = text.slice(middleOffset, middleOffset + Math.min(neighborhoodBudget, remaining));
    }

    return `[Article opening]\n${opening}\n\n[Selection neighborhood]\n${neighborhood}\n\n[Article ending]\n${ending}`;
  },
};

module.exports = { LLMService, LLMServiceError, ArticleChunker, decodeBatchTranslations };
