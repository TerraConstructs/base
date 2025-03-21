import { TerraformMetaArguments, TerraformResource } from "cdktf";
import { Construct } from "constructs";

export enum TestProviderMetadata {
  TYPE = "test",
}
export interface TestResourceConfig extends TerraformMetaArguments {
  readonly properties?: { [name: string]: any };
}
export class TestResource extends TerraformResource {
  public static readonly tfResourceType: string = "test_resource";

  /**
   * AWS CloudFormation resource properties.
   *
   * This object is returned via cfnProperties
   * @internal
   */
  protected readonly _properties: any;
  constructor(scope: Construct, id: string, config: TestResourceConfig) {
    super(scope, id, {
      terraformResourceType: "test_resource",
      terraformGeneratorMetadata: {
        providerName: TestProviderMetadata.TYPE,
        providerVersionConstraint: "~> 2.0",
      },
      provider: config.provider,
      dependsOn: config.dependsOn,
      count: config.count,
      lifecycle: config.lifecycle,
      provisioners: config.provisioners,
      forEach: config.forEach,
    });
    this._properties = config.properties || {};
  }

  public get names(): string[] {
    return this.getListAttribute("names");
  }

  protected synthesizeAttributes(): { [name: string]: any } {
    return this._properties;
  }
}
