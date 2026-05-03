import { Transform, type TransformCallback } from "node:stream";
import { isString } from "radashi";

export const REQUEST_MARKER = "<<<REQUEST>>>";

export type RequestStreamParser = Transform & {
  intentRequestText: Promise<string>;
};

type CreateRequestStreamParserOptions = {
  marker?: string;
};

export const createRequestStreamParser = (
  options: CreateRequestStreamParserOptions = {},
): RequestStreamParser => {
  const marker = options.marker ?? REQUEST_MARKER;
  const safeTailLength = Math.max(0, marker.length - 1);

  let visibleBuffer = "";
  let intentRequestText = "";
  let hasRequestMarker = false;
  let resolveIntentRequestText: (intentRequestText: string) => void = () => {};
  let rejectIntentRequestText: (error: unknown) => void = () => {};

  const intentRequestTextPromise = new Promise<string>((resolve, reject) => {
    resolveIntentRequestText = resolve;
    rejectIntentRequestText = reject;
  });

  const parseChunk = (chunk: Buffer | string) => {
    return isString(chunk) ? chunk : chunk.toString("utf8");
  };

  const pushVisibleText = (stream: Transform, text: string) => {
    if (text.length === 0) return;
    stream.push(text);
  };

  const trimRequestPrefix = (text: string) => {
    return text.replace(/^\s*\n?/, "");
  };

  const stream = new Transform({
    decodeStrings: false,

    transform(chunk: Buffer | string, _encoding: BufferEncoding, callback) {
      try {
        const text = parseChunk(chunk);

        if (hasRequestMarker) {
          intentRequestText += text;
          callback();
          return;
        }

        visibleBuffer += text;

        const markerIndex = visibleBuffer.indexOf(marker);

        if (markerIndex >= 0) {
          pushVisibleText(this, visibleBuffer.slice(0, markerIndex).trimEnd());

          hasRequestMarker = true;
          intentRequestText += trimRequestPrefix(
            visibleBuffer.slice(markerIndex + marker.length),
          );
          visibleBuffer = "";
          callback();
          return;
        }

        const safeTextLength = Math.max(
          0,
          visibleBuffer.length - safeTailLength,
        );

        if (safeTextLength > 0) {
          pushVisibleText(this, visibleBuffer.slice(0, safeTextLength));
          visibleBuffer = visibleBuffer.slice(safeTextLength);
        }

        callback();
      } catch (error) {
        callback(error as Error);
      }
    },

    flush(callback: TransformCallback) {
      try {
        if (hasRequestMarker) {
          if (visibleBuffer.length > 0) {
            intentRequestText += visibleBuffer;
            visibleBuffer = "";
          }
        } else if (visibleBuffer.length > 0) {
          pushVisibleText(this, visibleBuffer);
          visibleBuffer = "";
        }

        resolveIntentRequestText(intentRequestText);
        callback();
      } catch (error) {
        rejectIntentRequestText(error);
        callback(error as Error);
      }
    },
  }) as RequestStreamParser;

  stream.intentRequestText = intentRequestTextPromise;

  stream.once("error", (error) => {
    rejectIntentRequestText(error);
  });

  return stream;
};
