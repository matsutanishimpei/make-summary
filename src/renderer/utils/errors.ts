export function normalizeError(
  error: unknown
): { message: string; code?: string; details?: string } {
  if (error && typeof error === "object") {
    const value = error as { message?: string; code?: string; details?: string };
    return {
      message: value.message ?? "予期しないエラーが発生しました。",
      code: value.code,
      details: value.details
    };
  }
  return { message: String(error) };
}
