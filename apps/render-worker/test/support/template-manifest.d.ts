declare module "*/template-manifest.mjs" {
  export type BuiltManifestPlaceholders = {
    readonly [key: string]: string | BuiltManifestPlaceholders;
  };

  export type BuiltManifestTemplate = {
    readonly id: string;
    readonly slug: string;
    readonly name: string;
    readonly path: string;
    readonly contentHash: string;
    readonly placeholders: BuiltManifestPlaceholders;
  };

  export type BuiltManifest = {
    readonly release: string;
    readonly templates: readonly BuiltManifestTemplate[];
  };

  export function buildManifest(root: string, release?: string): Promise<BuiltManifest>;
}
