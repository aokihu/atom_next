export const parseResponseJson = async <T>(response: Response): Promise<T> => {
  const text = await response.text();
  const body = text.trim() === "" ? {} : JSON.parse(text);

  if (!response.ok) {
    const errorMessage =
      typeof body?.error === "string" && body.error.trim() !== ""
        ? body.error
        : `HTTP ${response.status}`;
    throw new Error(errorMessage);
  }

  return body as T;
};

export const parseMessageText = (value: unknown) => {
  if (typeof value === "string") {
    return value;
  }

  if (value == null) {
    return "";
  }

  return JSON.stringify(value);
};
