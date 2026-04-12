/**
 * Input Panel
 * @author aokihu <aokihu@gmail.com>
 * @version 0.5.2
 * @description 独立封装 TUI 输入区，负责 textarea 展示、占位文案和输入提交行为。
 */

import type { TextareaRenderable } from "@opentui/core";
import { isNullish } from "radashi";
import type { TuiStore } from "../model";
import type { TuiThemeScheme } from "../theme";

const INPUT_CONTAINER_BORDER_HEIGHT = 2;

type InputPanelProps = {
  inputLineCount: number;
  inputValue: string;
  textareaRef: {
    current: TextareaRenderable | null;
  };
  store: TuiStore;
  theme: TuiThemeScheme;
};

const parseInputContainerHeight = (inputLineCount: number) => {
  return inputLineCount + INPUT_CONTAINER_BORDER_HEIGHT;
};

const parseInputPlaceholder = (inputLineCount: number) => {
  if (inputLineCount === 1) {
    return "type message and press Enter";
  }

  return "type message, Enter send, Shift+Enter newline";
};

/**
 * 输入区保持常驻焦点，
 * 这样后续为 textarea 增加复杂编辑行为时，职责仍然集中在当前组件内。
 */
export const InputPanel = ({
  inputLineCount,
  inputValue,
  textareaRef,
  store,
  theme,
}: InputPanelProps) => {
  return (
    <box
      style={{
        height: parseInputContainerHeight(inputLineCount),
        backgroundColor: theme.panel,
      }}
    >
      <box
        style={{
          border: true,
          borderColor: theme.border,
          marginX: 2,
        }}
      >
        <textarea
          ref={textareaRef}
          focused
          height={inputLineCount}
          style={{
            marginX: 1,
          }}
          backgroundColor={theme.panel}
          textColor={theme.text}
          focusedBackgroundColor={theme.panel}
          focusedTextColor={theme.text}
          placeholder={parseInputPlaceholder(inputLineCount)}
          placeholderColor={theme.border}
          initialValue={inputValue}
          keyBindings={[
            { name: "return", action: "submit" },
            { name: "linefeed", action: "submit" },
            { name: "return", shift: true, action: "newline" },
            { name: "linefeed", shift: true, action: "newline" },
          ]}
          onContentChange={() => {
            if (isNullish(textareaRef.current)) {
              return;
            }

            store.getState().setInputValue(textareaRef.current.plainText);
          }}
          onSubmit={() => {
            if (isNullish(textareaRef.current)) {
              return;
            }

            void store.getState().sendInput(textareaRef.current.plainText);
          }}
        />
      </box>
    </box>
  );
};
