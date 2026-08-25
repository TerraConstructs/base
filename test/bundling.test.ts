import { DockerBuildSecret } from "../src";

// NOTE: Most bundling functionality is tested in cdktn.
// TerraConstructs only adds AWS-specific extensions (DockerBuildSecret, DockerBuildOptions with cache options).
// These tests focus on TC-specific functionality only.
describe("bundling", () => {
  describe("DockerBuildSecret", () => {
    test("fromSrc returns correct Docker CLI secret argument", () => {
      const fromSrc = DockerBuildSecret.fromSrc("path.json");
      expect(fromSrc).toEqual("src=path.json");
    });

    test("fromSrc with different path", () => {
      const fromSrc = DockerBuildSecret.fromSrc("secrets/config.env");
      expect(fromSrc).toEqual("src=secrets/config.env");
    });
  });
});
