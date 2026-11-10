export type {
  CompiledTemplate,
  CompileTemplateOptions,
  HandlebarsMode,
  TemplateData,
} from "./compile-template.js";
export { compileTemplate } from "./compile-template.js";
export type { PlaceholderNode, PlaceholderTree } from "./extract-placeholders.js";
export { extractPlaceholders } from "./extract-placeholders.js";
export type { TemplateFilesInput } from "./hash-template-files.js";
export { hashTemplateFiles } from "./hash-template-files.js";
export type { TemplateManifest, TemplateManifestEntry } from "./build-manifest.js";
export { buildManifest } from "./build-manifest.js";
export type { TemplateDescriptor } from "./template-descriptor.js";
export { validateTemplateDescriptor } from "./template-descriptor.js";
export type { FixedHelperName, FixedHelpers } from "./helpers.js";
export { FIXED_HELPER_NAMES } from "./helpers.js";
export {
  TemplateCompileError,
  TemplateDescriptorError,
  TemplateEngineError,
  TemplateHashError,
  TemplateManifestError,
  TemplateRenderError,
} from "./errors.js";
