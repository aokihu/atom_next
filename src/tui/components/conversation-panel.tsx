/**
 * Conversation Panel
 * @author aokihu <aokihu@gmail.com>
 * @version 0.5.3
 * @description 负责渲染最终输出结果，并在等待回复时展示轻量的文本等待动画。
 */

import { useEffect, useState } from "react";
import { ChatStatus } from "@/types/chat";
import { type TuiMessage } from "../model";
import { OUTPUT_LOADING_FRAME_INTERVAL_MS } from "../constants";
import type { TuiThemeScheme } from "../theme";
import { ConversationMessageCard } from "./conversation-messages";
import { AssistantConversationLoading } from "./conversation-messages/assistant-message";

type ConversationPanelProps = {
  messages: TuiMessage[];
  activeChatStatus?: ChatStatus;
  isSubmitting: boolean;
  isPolling: boolean;
  theme: TuiThemeScheme;
};

/**
 * 输出区保留用户输入、最终回答和错误结果，
 * system 提示与处理中间态继续交给其他 UI 区域承载。
 */
export const parseConversationOutputMessages = (messages: TuiMessage[]) => {
  return messages.filter((message) => {
    if (message.role === "user") {
      return true;
    }

    if (message.role === "error") {
      return true;
    }

    return (
      message.role === "assistant" && message.status === ChatStatus.COMPLETE
    );
  });
};

/**
 * 输出区只在真正等待回复时展示等待态动画，
 * 完成态和失败态都回到正常消息渲染。
 */
export const parseShouldRenderConversationLoading = (
  activeChatStatus: ChatStatus | undefined,
  isSubmitting: boolean,
  isPolling: boolean,
) => {
  if (isSubmitting || isPolling) {
    return true;
  }

  return (
    activeChatStatus === ChatStatus.WAITING ||
    activeChatStatus === ChatStatus.PENDING ||
    activeChatStatus === ChatStatus.PROCESSING
  );
};

const parseOutputLoadingText = (animationFrame: number) => {
  return `think${".".repeat(animationFrame + 1)}`;
};

/**
 * 会话主区域后续会继续承载更复杂的输出 UI，
 * 所以先把消息列表从根组件中独立出来，避免后面继续膨胀。
 */
export const ConversationPanel = ({
  messages,
  activeChatStatus,
  isSubmitting,
  isPolling,
  theme,
}: ConversationPanelProps) => {
  const outputMessages = parseConversationOutputMessages(messages);
  const shouldRenderLoading = parseShouldRenderConversationLoading(
    activeChatStatus,
    isSubmitting,
    isPolling,
  );
  const [loadingAnimationFrame, setLoadingAnimationFrame] = useState(0);

  useEffect(() => {
    if (!shouldRenderLoading) {
      setLoadingAnimationFrame(0);
      return;
    }

    const timer = setInterval(() => {
      setLoadingAnimationFrame((currentFrame) => {
        return (currentFrame + 1) % 3;
      });
    }, OUTPUT_LOADING_FRAME_INTERVAL_MS);

    return () => {
      clearInterval(timer);
    };
  }, [shouldRenderLoading]);

  return (
    <box
      style={{
        flexGrow: 1,
        paddingX: 1,
        flexDirection: "column",
        gap: 1,
        backgroundColor: theme.panel,
      }}
    >
      <text fg={theme.accent}>Output</text>
      <scrollbox
        focused={false}
        style={{
          flexGrow: 1,
          rootOptions: {
            backgroundColor: theme.panel,
          },
          wrapperOptions: {
            backgroundColor: theme.panel,
          },
          viewportOptions: {
            backgroundColor: theme.panel,
          },
          contentOptions: {
            backgroundColor: theme.panel,
          },
          scrollbarOptions: {
            trackOptions: {
              foregroundColor: theme.accent,
              backgroundColor: theme.border,
            },
          },
        }}
        stickyScroll
        stickyStart="bottom"
      >
        {outputMessages.map((message) => (
          <ConversationMessageCard
            key={message.id}
            message={message}
            theme={theme}
          />
        ))}

        {shouldRenderLoading ? (
          <AssistantConversationLoading
            content={parseOutputLoadingText(loadingAnimationFrame)}
            theme={theme}
          />
        ) : null}
      </scrollbox>
    </box>
  );
};
