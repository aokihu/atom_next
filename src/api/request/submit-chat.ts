/**
 * Submit Chat 请求解析模块
 * @description 负责将 submit chat 的原始 JSON 解析成内部请求结构
 */

import type { ChatSubmissionBody } from "@/types/intent-request";
import type { TaskChannel, TaskPayload } from "@/types/task";
import { isPlainObject, isUndefined } from "radashi";
import { createError, ErrorCause } from "@/libs";

const buildBadRequestError = (message: string) =>
  createError(message, {
    cause: ErrorCause.BadRequest,
  });

const parsePayloadItem = (item: unknown): TaskPayload[number] => {
  if (!isPlainObject(item)) {
    throw buildBadRequestError("payload item must be an object");
  }

  const payloadItem = item as Record<string, unknown>;

  if (payloadItem.type === "text") {
    if (
      typeof payloadItem.data !== "string" ||
      payloadItem.data.trim() === ""
    ) {
      throw buildBadRequestError(
        "text payload item requires a non-empty string data field",
      );
    }

    return {
      type: "text",
      data: payloadItem.data,
    };
  }

  if (payloadItem.type === "image" || payloadItem.type === "audio") {
    if (
      typeof payloadItem.url !== "string" &&
      typeof payloadItem.data === "undefined"
    ) {
      throw buildBadRequestError(
        `${payloadItem.type} payload item requires url or data`,
      );
    }

    return {
      type: payloadItem.type,
      ...(typeof payloadItem.data !== "undefined"
        ? { data: payloadItem.data }
        : {}),
      ...(typeof payloadItem.url === "string" ? { url: payloadItem.url } : {}),
    };
  }

  throw buildBadRequestError("unsupported payload item type");
};

const parsePayload = (value: unknown): TaskPayload => {
  if (!Array.isArray(value)) {
    throw buildBadRequestError("payload must be an array");
  }

  if (value.length === 0) {
    throw buildBadRequestError("payload cannot be empty");
  }

  return value.map((item) => parsePayloadItem(item));
};

const parsePriority = (value: unknown): number | undefined => {
  if (isUndefined(value)) {
    return undefined;
  }

  if (typeof value !== "number" || !Number.isInteger(value) || value < 0) {
    throw buildBadRequestError("priority must be a non-negative integer");
  }

  return value;
};

const parseChannel = (value: unknown): TaskChannel | undefined => {
  if (typeof value === "undefined") {
    return undefined;
  }

  if (!isPlainObject(value)) {
    throw buildBadRequestError("channel must be an object");
  }

  const channel = value as Record<string, unknown>;

  if (channel.domain === "tui") {
    return { domain: "tui" };
  }

  if (channel.domain !== "gateway") {
    throw buildBadRequestError("channel.domain is invalid");
  }

  if (typeof channel.source !== "string" || channel.source.trim() === "") {
    throw buildBadRequestError("gateway channel requires a non-empty source");
  }

  if (
    typeof channel.metadata !== "undefined" &&
    !isPlainObject(channel.metadata)
  ) {
    throw buildBadRequestError("channel.metadata must be a string map");
  }

  const metadata =
    typeof channel.metadata === "undefined"
      ? undefined
      : Object.fromEntries(
          Object.entries(channel.metadata).map(([key, metadataValue]) => {
            if (typeof metadataValue !== "string") {
              throw buildBadRequestError(
                "channel.metadata must be a string map",
              );
            }

            return [key, metadataValue];
          }),
        );

  return {
    domain: "gateway",
    source: channel.source,
    ...(metadata ? { metadata } : {}),
  };
};

export const parseSubmitChatBody = (body: unknown): ChatSubmissionBody => {
  if (!isPlainObject(body)) {
    throw buildBadRequestError("request body must be an object");
  }

  const requestBody = body as Record<string, unknown>;

  return {
    payload: parsePayload(requestBody.payload),
    priority: parsePriority(requestBody.priority),
    channel: parseChannel(requestBody.channel),
  };
};
