/**
 * intent-request/parse.ts
 * @description
 * 负责把 LLM 输出的 Intent Request 文本协议解析成结构化请求对象。
 *
 * 这个文件只做文本解析和参数校验，
 * 不负责安全检查，也不负责执行动作。
 */
import type {
  FollowUpIntentRequest,
  IntentRequest,
  LoadMemoryIntentRequest,
  LoadSkillIntentRequest,
  SaveMemoryIntentRequest,
  SearchMemoryIntentRequest,
  UnloadMemoryIntentRequest,
  UpdateMemoryIntentRequest,
} from "@/types";
import {
  IntentRequestSource,
  IntentRequestType,
  isIntentRequestMemoryScope,
  isIntentRequestMemoryUnloadReason,
  isIntentRequestType,
} from "@/types";
import { isEmpty, isNumber, isString } from "radashi";
import type { RawIntentRequestParams } from "./types";

/* ==================== */
/* Field Parsing        */
/* ==================== */

/**
 * 拆分单行 Intent Request 的头部字段。
 * @description
 * 这里只解析前两个固定位置:
 * 1. request
 * 2. intent
 *
 * 第二个逗号之后的剩余文本统一视为参数区，
 * 这样参数值内部即使包含逗号，也不会破坏整体解析。
 */
const parseIntentRequestHeader = (requestLine: string) => {
  const fields: string[] = [];
  let currentField = "";
  let isInQuote = false;
  let hasEscape = false;

  for (const char of requestLine) {
    if (hasEscape) {
      currentField += char;
      hasEscape = false;
      continue;
    }

    if (char === "\\") {
      currentField += char;
      hasEscape = true;
      continue;
    }

    if (char === "\"") {
      currentField += char;
      isInQuote = !isInQuote;
      continue;
    }

    if (char === "," && !isInQuote) {
      fields.push(currentField.trim());
      currentField = "";

      if (fields.length === 2) {
        break;
      }

      continue;
    }

    currentField += char;
  }

  if (isInQuote) {
    return null;
  }

  fields.push(currentField.trim());
  return fields;
};

/**
 * 解析 intent 字段文本。
 * @description
 * intent 必须显式存在，并且始终使用双引号包裹。
 */
const parseIntentText = (intentField: string) => {
  if (intentField.length < 2) {
    return null;
  }

  if (!intentField.startsWith("\"") || !intentField.endsWith("\"")) {
    return null;
  }

  return intentField
    .slice(1, -1)
    .replace(/\\\"/g, "\"")
    .replace(/\\\\/g, "\\");
};

/**
 * 解析参数区。
 * @description
 * 参数区使用 ";" 分割多个 key=value 对。
 */
const parseIntentRequestParams = (paramText: string) => {
  const params: RawIntentRequestParams = {};

  if (isEmpty(paramText)) {
    return params;
  }

  const rawParams = paramText
    .split(";")
    .map((item) => item.trim())
    .filter((item) => !isEmpty(item));

  if (rawParams.length === 0) {
    return null;
  }

  for (const rawParam of rawParams) {
    const equalIndex = rawParam.indexOf("=");

    if (equalIndex <= 0) {
      return null;
    }

    const paramKey = rawParam.slice(0, equalIndex).trim();
    const paramValue = rawParam.slice(equalIndex + 1).trim();

    if (isEmpty(paramKey) || paramKey in params) {
      return null;
    }

    params[paramKey] = paramValue;
  }

  return params;
};

/**
 * 解析 limit 参数。
 * @description
 * limit 只接受正整数。
 */
const parseIntentRequestLimit = (rawLimit: string) => {
  const parsedLimit = Number(rawLimit);

  if (
    !isNumber(parsedLimit) ||
    Number.isNaN(parsedLimit) ||
    !Number.isInteger(parsedLimit) ||
    parsedLimit <= 0
  ) {
    return null;
  }

  return parsedLimit;
};

/* ==================== */
/* Typed Request Parse  */
/* ==================== */

const parseSearchMemoryIntentRequest = (
  intent: string,
  params: RawIntentRequestParams,
): SearchMemoryIntentRequest | null => {
  const words = params.words;

  if (!isString(words) || isEmpty(words)) {
    return null;
  }

  const scope = params.scope;
  const rawLimit = params.limit;
  let limit: number | undefined;

  if (isString(scope) && !isIntentRequestMemoryScope(scope)) {
    return null;
  }

  if (isString(rawLimit)) {
    const parsedLimit = parseIntentRequestLimit(rawLimit);

    if (parsedLimit === null) {
      return null;
    }

    limit = parsedLimit;
  }

  return {
    source: IntentRequestSource.CONVERSATION,
    request: IntentRequestType.SEARCH_MEMORY,
    intent,
    params: {
      words,
      ...(isString(scope) ? { scope } : {}),
      ...(isNumber(limit) ? { limit } : {}),
    },
  };
};

const parseLoadMemoryIntentRequest = (
  intent: string,
  params: RawIntentRequestParams,
): LoadMemoryIntentRequest | null => {
  const key = params.key;

  if (!isString(key) || isEmpty(key)) {
    return null;
  }

  return {
    source: IntentRequestSource.CONVERSATION,
    request: IntentRequestType.LOAD_MEMORY,
    intent,
    params: {
      key,
    },
  };
};

const parseUnloadMemoryIntentRequest = (
  intent: string,
  params: RawIntentRequestParams,
): UnloadMemoryIntentRequest | null => {
  const key = params.key;
  const reason = params.reason;

  if (!isString(key) || isEmpty(key)) {
    return null;
  }

  if (!isString(reason) || !isIntentRequestMemoryUnloadReason(reason)) {
    return null;
  }

  return {
    source: IntentRequestSource.CONVERSATION,
    request: IntentRequestType.UNLOAD_MEMORY,
    intent,
    params: {
      key,
      reason,
    },
  };
};

const parseSaveMemoryIntentRequest = (
  intent: string,
  params: RawIntentRequestParams,
): SaveMemoryIntentRequest | null => {
  const text = params.text;
  const summary = params.summary;
  const scope = params.scope;

  if (!isString(text) || isEmpty(text)) {
    return null;
  }

  if (isString(summary) && isEmpty(summary)) {
    return null;
  }

  if (isString(scope) && !isIntentRequestMemoryScope(scope)) {
    return null;
  }

  return {
    source: IntentRequestSource.CONVERSATION,
    request: IntentRequestType.SAVE_MEMORY,
    intent,
    params: {
      text,
      ...(isString(summary) ? { summary } : {}),
      ...(isString(scope) ? { scope } : {}),
    },
  };
};

const parseUpdateMemoryIntentRequest = (
  intent: string,
  params: RawIntentRequestParams,
): UpdateMemoryIntentRequest | null => {
  const key = params.key;
  const text = params.text;
  const summary = params.summary;

  if (!isString(key) || isEmpty(key)) {
    return null;
  }

  if (!isString(text) && !isString(summary)) {
    return null;
  }

  if (isString(text) && isEmpty(text)) {
    return null;
  }

  if (isString(summary) && isEmpty(summary)) {
    return null;
  }

  return {
    source: IntentRequestSource.CONVERSATION,
    request: IntentRequestType.UPDATE_MEMORY,
    intent,
    params: {
      key,
      ...(isString(text) ? { text } : {}),
      ...(isString(summary) ? { summary } : {}),
    },
  };
};

const parseLoadSkillIntentRequest = (
  intent: string,
  params: RawIntentRequestParams,
): LoadSkillIntentRequest | null => {
  const skill = params.skill;

  if (!isString(skill) || isEmpty(skill)) {
    return null;
  }

  return {
    source: IntentRequestSource.CONVERSATION,
    request: IntentRequestType.LOAD_SKILL,
    intent,
    params: {
      skill,
    },
  };
};

const parseFollowUpIntentRequest = (
  intent: string,
  params: RawIntentRequestParams,
): FollowUpIntentRequest | null => {
  const sessionId = params.sessionId;
  const chatId = params.chatId;

  if (
    !isString(sessionId) ||
    isEmpty(sessionId) ||
    !isString(chatId) ||
    isEmpty(chatId)
  ) {
    return null;
  }

  return {
    source: IntentRequestSource.CONVERSATION,
    request: IntentRequestType.FOLLOW_UP,
    intent,
    params: {
      sessionId,
      chatId,
    },
  };
};

const parseTypedIntentRequest = (
  request: IntentRequestType,
  intent: string,
  params: RawIntentRequestParams,
): IntentRequest | null => {
  switch (request) {
    case IntentRequestType.PREPARE_CONVERSATION:
      return null;
    case IntentRequestType.SEARCH_MEMORY:
      return parseSearchMemoryIntentRequest(intent, params);
    case IntentRequestType.LOAD_MEMORY:
      return parseLoadMemoryIntentRequest(intent, params);
    case IntentRequestType.UNLOAD_MEMORY:
      return parseUnloadMemoryIntentRequest(intent, params);
    case IntentRequestType.SAVE_MEMORY:
      return parseSaveMemoryIntentRequest(intent, params);
    case IntentRequestType.UPDATE_MEMORY:
      return parseUpdateMemoryIntentRequest(intent, params);
    case IntentRequestType.LOAD_SKILL:
      return parseLoadSkillIntentRequest(intent, params);
    case IntentRequestType.FOLLOW_UP:
      return parseFollowUpIntentRequest(intent, params);
  }
};

/* ==================== */
/* Public Parse API     */
/* ==================== */

/**
 * 解析单行 Intent Request。
 * @description
 * 只有完整闭合的方括号请求才会被接受。
 * 非法或不完整请求会被忽略。
 */
const parseIntentRequestLine = (requestLine: string): IntentRequest | null => {
  if (!requestLine.startsWith("[") || !requestLine.endsWith("]")) {
    return null;
  }

  const requestContent = requestLine.slice(1, -1).trim();

  if (isEmpty(requestContent)) {
    return null;
  }

  const fields = parseIntentRequestHeader(requestContent);

  if (!fields || fields.length < 2) {
    return null;
  }

  const requestName = fields[0];
  const intentField = fields[1];

  if (!isString(requestName) || !isString(intentField)) {
    return null;
  }

  if (!isIntentRequestType(requestName)) {
    return null;
  }

  const intentText = parseIntentText(intentField);

  if (intentText === null) {
    return null;
  }

  const paramsText = requestContent
    .slice(requestContent.indexOf(intentField) + intentField.length)
    .replace(/^,/, "")
    .trim();
  const params = parseIntentRequestParams(paramsText);

  if (params === null) {
    return null;
  }

  return parseTypedIntentRequest(requestName, intentText, params);
};

/**
 * 解析多行 Intent Request 文本。
 * @description
 * 输入是 LLM 在回复尾部附加的原始请求文本，
 * 输出是 Runtime 可以直接消费的结构化对象数组。
 */
export const parseIntentRequests = (intentRequestText: string): IntentRequest[] => {
  return intentRequestText
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => !isEmpty(line))
    .map((line) => parseIntentRequestLine(line))
    .filter((request): request is IntentRequest => request !== null);
};
