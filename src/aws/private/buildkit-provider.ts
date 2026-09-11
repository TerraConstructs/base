// Minimal hand-written bindings for the cruxstack/buildkit provider (no published cdktn package).
import { TerraformProvider, TerraformResource } from "cdktn";
import { Construct } from "constructs";

const PROVIDER_SOURCE = "cruxstack/buildkit";
const PROVIDER_VERSION = "0.0.1";

export interface BuildkitProviderConfig {
  readonly buildkitAddress: string;
}

/**
 * `provider "buildkit"` pinned to one explicit daemon: no auto-discovery, no embedded buildkitd.
 */
export class BuildkitProvider extends TerraformProvider {
  constructor(
    scope: Construct,
    id: string,
    private readonly config: BuildkitProviderConfig,
  ) {
    super(scope, id, {
      terraformResourceType: "buildkit",
      terraformGeneratorMetadata: {
        providerName: "buildkit",
        providerVersionConstraint: PROVIDER_VERSION,
      },
      terraformProviderSource: PROVIDER_SOURCE,
    });
  }

  protected synthesizeAttributes(): { [name: string]: any } {
    return {
      buildkit_address: this.config.buildkitAddress,
      buildkit_autodiscover: false,
      embedded_buildkitd: false,
    };
  }
}

export interface BuildkitCacheEntry {
  readonly type: string;
  readonly attrs?: { [key: string]: string };
}

export interface BuildkitImageConfig {
  readonly provider: BuildkitProvider;
  readonly context: string;
  readonly dockerfile: string;
  readonly platforms: string[];
  readonly registry: string;
  readonly repository: string;
  readonly tags: string[];
  readonly args?: { [key: string]: string };
  readonly secrets?: { [key: string]: string };
  readonly target?: string;
  readonly cacheFrom?: BuildkitCacheEntry[];
  readonly cacheTo?: BuildkitCacheEntry[];
  readonly triggers?: { [key: string]: string };
}

/**
 * `resource "buildkit_image"`: solve on buildkitd and push via the image exporter.
 */
export class BuildkitImage extends TerraformResource {
  constructor(
    scope: Construct,
    id: string,
    private readonly config: BuildkitImageConfig,
  ) {
    super(scope, id, {
      terraformResourceType: "buildkit_image",
      terraformGeneratorMetadata: {
        providerName: "buildkit",
        providerVersionConstraint: PROVIDER_VERSION,
      },
      provider: config.provider,
    });
  }

  /** Tag reference of the pushed image; depends on the build. */
  public get tagUrl(): string {
    return this.getStringAttribute("published.0.tag_url");
  }

  /** Manifest digest of the pushed image. */
  public get imageDigest(): string {
    return this.getStringAttribute("image_digest");
  }

  protected synthesizeAttributes(): { [name: string]: any } {
    const c = this.config;
    const cache = (entries?: BuildkitCacheEntry[]) =>
      entries?.map((e) => ({ type: e.type, attrs: e.attrs }));
    return {
      context: c.context,
      dockerfile: c.dockerfile,
      platforms: c.platforms,
      args: c.args,
      secrets: c.secrets,
      target: c.target,
      triggers: c.triggers,
      publish: [
        { registry: c.registry, repository: c.repository, tags: c.tags },
      ],
      cache_from: cache(c.cacheFrom),
      cache_to: cache(c.cacheTo),
    };
  }
}
