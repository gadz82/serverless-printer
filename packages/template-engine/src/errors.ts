export class TemplateEngineError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "TemplateEngineError";
  }
}

export class TemplateCompileError extends TemplateEngineError {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "TemplateCompileError";
  }
}

export class TemplateRenderError extends TemplateEngineError {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "TemplateRenderError";
  }
}

export class TemplateDescriptorError extends TemplateEngineError {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "TemplateDescriptorError";
  }
}

export class TemplateHashError extends TemplateEngineError {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "TemplateHashError";
  }
}

export class TemplateManifestError extends TemplateEngineError {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "TemplateManifestError";
  }
}

export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
