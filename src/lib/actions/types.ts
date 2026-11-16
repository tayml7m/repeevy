export type ActionResult = { ok: boolean; message: string };

export function actionError(error: unknown): ActionResult {
  return {
    ok: false,
    message: error instanceof Error ? error.message : String(error),
  };
}
