import { createRequire } from "node:module";
import path from "node:path";
import { pathToFileURL } from "node:url";

export type TemplateCompiler = {
  compileTemplate(
    source: string,
    options: { readonly mode: "lenient" },
  ): (data?: Readonly<Record<string, unknown>>) => string;
};

/**
 * Loads the workspace template engine through its package entry so the
 * Chromium adapter test renders the real generic-report template without
 * adding the engine as a runtime dependency of the worker package.
 */
export async function loadTemplateCompiler(repositoryRoot: string): Promise<TemplateCompiler> {
  const engineRequire = createRequire(
    path.join(repositoryRoot, "packages", "template-engine", "package.json"),
  );
  const entryPoint = engineRequire.resolve("./src/index.ts");
  const module = (await import(pathToFileURL(entryPoint).href)) as TemplateCompiler;

  return module;
}
