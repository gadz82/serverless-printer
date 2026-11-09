import type { TemplateDescriptor } from "../domain/template-descriptor.js";

export interface TemplateCatalog {
  resolve(templateId: string): Promise<TemplateDescriptor | null>;
}
