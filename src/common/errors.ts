export class AppError extends Error {
  public readonly code: string;
  public readonly status?: number;
  public readonly details?: unknown;

  constructor(message: string, code = "APP_ERROR", opts?: { status?: number; details?: unknown }) {
    super(message);
    this.code = code;
    this.status = opts?.status;
    this.details = opts?.details;
  }
}

export class ConfirmRequiredError extends AppError {
  constructor(tool: string) {
    super(`Tool '${tool}' requires confirm=true`, "CONFIRM_REQUIRED", { status: 400 });
  }
}

