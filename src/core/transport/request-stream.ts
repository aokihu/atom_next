import { Transform, type TransformCallback } from "node:stream";
import { isString } from "radashi";

export const REQUEST_MARKER = "<<<REQUEST>>>";

export type RequestStreamParser = Transform & {
  requestText: Promise<string>;
};

type CreateRequestStreamParserOptions = {
  marker?: string;
};

/**
 * 创建一个用于解析 LLM 文本输出的 Transform 流。
 *
 * 这个解析器只做一件事:
 * 1. 将用户可见文本继续向下游输出
 * 2. 将 marker 之后的内容静默收集到 requestText 中
 *
 * 之所以使用 Transform，而不是简单的字符串拼接函数，
 * 是因为这里本质上就是一个流式分流问题:
 * 原始 chunk 持续输入，用户可见内容持续输出，而 request 内容在结束后一次性取出。
 */
export const createRequestStreamParser = (
  options: CreateRequestStreamParserOptions = {},
): RequestStreamParser => {
  const marker = options.marker ?? REQUEST_MARKER;
  const safeTailLength = Math.max(0, marker.length - 1);

  let visibleBuffer = "";
  let requestText = "";
  let hasRequestMarker = false;
  let resolveRequestText: (requestText: string) => void = () => {};
  let rejectRequestText: (error: unknown) => void = () => {};

  const requestTextPromise = new Promise<string>((resolve, reject) => {
    resolveRequestText = resolve;
    rejectRequestText = reject;
  });

  /**
   * 将 chunk 统一转为字符串。
   *
   * 解析逻辑只关注文本本身，不关心上游到底给的是 string 还是 Buffer。
   * 统一入口之后，状态机可以保持简单。
   */
  const parseChunk = (chunk: Buffer | string) => {
    return isString(chunk) ? chunk : chunk.toString("utf8");
  };

  /**
   * 输出已经确认安全的用户可见文本。
   *
   * 这里单独提成函数，是为了明确语义:
   * 只有经过 marker 检测之后确认不会再参与匹配的文本，才允许输出给用户。
   */
  const pushVisibleText = (stream: Transform, text: string) => {
    if (text.length === 0) return;
    stream.push(text);
  };

  /**
   * 去掉 marker 后紧邻的起始空白。
   *
   * 这里做的是“最小清理”:
   * 只处理 marker 与 request 正文之间最常见的分隔换行/空格，
   * 不进一步解释 request 内容的结构，避免把解析器和业务语义绑死。
   */
  const trimRequestPrefix = (text: string) => {
    return text.replace(/^\s*\n?/, "");
  };

  const stream = new Transform({
    decodeStrings: false,

    transform(chunk: Buffer | string, _encoding: BufferEncoding, callback) {
      try {
        const text = parseChunk(chunk);

        // 一旦已经命中 marker，后续所有文本都属于 request 区域，
        // 不能再输出给用户，只能继续累积到 requestText。
        if (hasRequestMarker) {
          requestText += text;
          callback();
          return;
        }

        visibleBuffer += text;

        const markerIndex = visibleBuffer.indexOf(marker);

        if (markerIndex >= 0) {
          // 只按第一个 marker 做分界。
          // 命中后，marker 前的内容属于用户可见文本，
          // marker 后的内容全部转入 requestText。
          pushVisibleText(this, visibleBuffer.slice(0, markerIndex).trimEnd());

          hasRequestMarker = true;
          requestText += trimRequestPrefix(
            visibleBuffer.slice(markerIndex + marker.length),
          );
          visibleBuffer = "";
          callback();
          return;
        }

        // 如果当前还没有命中 marker，不能直接把 visibleBuffer 全部输出。
        // 原因是 marker 可能被拆在多个 chunk 中，例如:
        // chunk1 = "hello <<<REQ"
        // chunk2 = "UEST>>> world"
        //
        // 为了支持这种跨 chunk 匹配，需要始终保留 marker.length - 1 的尾部窗口。
        // 这段窗口在下一个 chunk 到来前都不能确认是否属于 marker 的前缀。
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
          // 已进入 request 模式时，visibleBuffer 理论上应为空。
          // 这里仍然补一层兜底，确保任何残留内容都被并入 requestText。
          if (visibleBuffer.length > 0) {
            requestText += visibleBuffer;
            visibleBuffer = "";
          }
        } else if (visibleBuffer.length > 0) {
          // 如果直到流结束都没有命中 marker，
          // 那么缓冲区里残留的内容只是“尚未确认是否为 marker 前缀”的普通文本。
          // 此时可以安全地全部回退为用户可见文本输出。
          pushVisibleText(this, visibleBuffer);
          visibleBuffer = "";
        }

        // requestText Promise 只在流自然结束时 resolve，
        // 这样上层可以把它当作“完整 request 结果”来 await。
        resolveRequestText(requestText);
        callback();
      } catch (error) {
        rejectRequestText(error);
        callback(error as Error);
      }
    },
  }) as RequestStreamParser;

  stream.requestText = requestTextPromise;

  stream.once("error", (error) => {
    // 如果流在 flush 前异常终止，也必须让 requestText Promise 结束，
    // 否则上层 await 会永久悬挂。
    rejectRequestText(error);
  });

  return stream;
};
