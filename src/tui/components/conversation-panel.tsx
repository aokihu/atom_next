/**
 * Conversation Panel
 * @author aokihu <aokihu@gmail.com>
 * @version 0.5.2
 * @description 负责渲染会话标题、消息滚动区以及不同消息角色的视觉语义。
 */

import { isEmpty, isNullish } from "radashi";
import { parseChatStatusLabel, type TuiMessage } from "../model";
import type { TuiThemeScheme } from "../theme";

type ConversationPanelProps = {
  messages: TuiMessage[];
  theme: TuiThemeScheme;
};

/**
 * 不同消息角色使用不同颜色语义，
 * 但颜色值全部来自当前主题，组件只负责把语义映射到消息块上。
 */
const parseMessageTone = (message: TuiMessage, theme: TuiThemeScheme) => {
  if (message.role === "user") {
    return {
      titleColor: theme.user,
      backgroundColor: theme.panelMuted,
    };
  }

  if (message.role === "error") {
    return {
      titleColor: theme.danger,
      backgroundColor: theme.panel,
    };
  }

  if (message.role === "assistant") {
    return {
      titleColor: theme.accent,
      backgroundColor: theme.panel,
    };
  }

  return {
    titleColor: theme.info,
    backgroundColor: theme.panel,
  };
};

const parseMessageTitle = (message: TuiMessage) => {
  if (message.role === "user") {
    return "user";
  }

  if (message.role === "assistant") {
    return `assistant · ${parseChatStatusLabel(message.status)}`;
  }

  if (message.role === "error") {
    return `error · ${parseChatStatusLabel(message.status)}`;
  }

  return "system";
};

const parseMessageContent = (message: TuiMessage) => {
  if (!isEmpty(message.content.trim())) {
    return message.content;
  }

  if (!isNullish(message.status)) {
    return `chat ${parseChatStatusLabel(message.status)}...`;
  }

  return "";
};

/**
 * 会话主区域后续会继续承载更复杂的输出 UI，
 * 所以先把消息列表从根组件中独立出来，避免后面继续膨胀。
 */
export const ConversationPanel = ({
  messages,
  theme,
}: ConversationPanelProps) => {
  return (
    <box
      style={{
        flexGrow: 1,
        padding: 1,
        flexDirection: "column",
        gap: 1,
        backgroundColor: theme.panel,
      }}
    >
      <text fg={theme.accent}>Conversation</text>
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
        {messages.map((message) => {
          const tone = parseMessageTone(message, theme);

          return (
            <box
              key={message.id}
              style={{
                width: "100%",
                flexDirection: "column",
                padding: 1,
                marginBottom: 1,
                backgroundColor: tone.backgroundColor,
              }}
            >
              <text fg={tone.titleColor}>{parseMessageTitle(message)}</text>
              <text fg={theme.text} content={parseMessageContent(message)} />
            </box>
          );
        })}
      </scrollbox>
    </box>
  );
};
