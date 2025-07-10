import * as child_process from "child_process";
import * as crypto from "crypto";
import * as path from "path";
import { DockerBuildSecret, DockerImage, FileSystem } from "../src";
import { DockerCacheOption } from "../src/assets";

jest.mock("child_process");

const dockerCmd = process.env.CDK_DOCKER ?? "docker";

describe("bundling", () => {
  let originalPlatform: NodeJS.Platform;

  beforeEach(() => {
    originalPlatform = process.platform;
  });

  afterEach(() => {
    Object.defineProperty(process, "platform", {
      value: originalPlatform,
    });
    jest.restoreAllMocks();
  });

  test("bundling with image from registry", () => {
    Object.defineProperty(process, "platform", { value: "darwin" });
    (child_process.spawnSync as jest.Mock).mockReturnValue({ status: 0 });

    const image = DockerImage.fromRegistry("alpine");
    image.run({
      command: ["cool", "command"],
      environment: { VAR1: "value1", VAR2: "value2" },
      volumes: [{ hostPath: "/host-path", containerPath: "/container-path" }],
      workingDirectory: "/working-directory",
      user: "user:group",
    });

    expect(child_process.spawnSync).toHaveBeenCalledWith(
      dockerCmd,
      [
        "run",
        "--rm",
        "-u",
        "user:group",
        "-v",
        "/host-path:/container-path:delegated",
        "--env",
        "VAR1=value1",
        "--env",
        "VAR2=value2",
        "-w",
        "/working-directory",
        "alpine",
        "cool",
        "command",
      ],
      { encoding: "utf-8", stdio: ["ignore", "inherit", "inherit"] },
      // { encoding: "utf-8", stdio: ["ignore", process.stderr, "inherit"] },
    );
  });

  test("bundling with image from asset", () => {
    (child_process.spawnSync as jest.Mock).mockReturnValue({ status: 0 });
    jest.spyOn(FileSystem, "fingerprint").mockReturnValue("123456abcdef");

    const image = DockerImage.fromBuild("docker-path", {
      buildArgs: { TEST_ARG: "cdk-test" },
    });
    image.run();

    const tagHash = crypto
      .createHash("sha256")
      .update(
        JSON.stringify({
          path: "docker-path",
          buildArgs: { TEST_ARG: "cdk-test" },
        }),
      )
      .digest("hex");
    const tag = `tcons-${tagHash}`;

    expect(child_process.spawnSync).toHaveBeenNthCalledWith(
      1,
      dockerCmd,
      ["build", "-t", tag, "--build-arg", "TEST_ARG=cdk-test", "docker-path"],
      expect.any(Object),
    );
    expect(child_process.spawnSync).toHaveBeenNthCalledWith(
      2,
      dockerCmd,
      ["run", "--rm", tag],
      expect.any(Object),
    );
  });

  test("bundling with image from asset with cache disabled", () => {
    (child_process.spawnSync as jest.Mock).mockReturnValue({ status: 0 });
    jest.spyOn(FileSystem, "fingerprint").mockReturnValue("123456abcdef");

    const image = DockerImage.fromBuild("docker-path", { cacheDisabled: true });
    image.run();

    const tagHash = crypto
      .createHash("sha256")
      .update(JSON.stringify({ path: "docker-path", cacheDisabled: true }))
      .digest("hex");
    const tag = `tcons-${tagHash}`;

    expect(child_process.spawnSync).toHaveBeenNthCalledWith(
      1,
      dockerCmd,
      ["build", "-t", tag, "--no-cache", "docker-path"],
      expect.any(Object),
    );
    expect(child_process.spawnSync).toHaveBeenNthCalledWith(
      2,
      dockerCmd,
      ["run", "--rm", tag],
      expect.any(Object),
    );
  });

  test("bundling with image from asset with platform", () => {
    (child_process.spawnSync as jest.Mock).mockReturnValue({ status: 0 });
    jest.spyOn(FileSystem, "fingerprint").mockReturnValue("123456abcdef");
    const platform = "linux/someArch99";

    const image = DockerImage.fromBuild("docker-path", { platform });
    image.run();

    const tagHash = crypto
      .createHash("sha256")
      .update(JSON.stringify({ path: "docker-path", platform }))
      .digest("hex");
    const tag = `tcons-${tagHash}`;

    expect(child_process.spawnSync).toHaveBeenNthCalledWith(
      1,
      dockerCmd,
      ["build", "-t", tag, "--platform", platform, "docker-path"],
      expect.any(Object),
    );
    expect(child_process.spawnSync).toHaveBeenNthCalledWith(
      2,
      dockerCmd,
      ["run", "--rm", tag],
      expect.any(Object),
    );
  });

  test("bundling with image from asset with cache-to & cache-from", () => {
    (child_process.spawnSync as jest.Mock).mockReturnValue({ status: 0 });
    jest.spyOn(FileSystem, "fingerprint").mockReturnValue("123456abcdef");
    const cacheTo: DockerCacheOption = {
      type: "local",
      params: { dest: "path/to/local/dir" },
    };
    const cacheFrom: DockerCacheOption[] = [
      {
        type: "s3",
        params: { region: "us-west-2", bucket: "my-bucket", name: "foo" },
      },
      {
        type: "gha",
        params: {
          url: "https://example.com",
          token: "abc123",
          scope: "gh-ref-image2",
        },
      },
    ];
    const options = { cacheTo, cacheFrom };
    const image = DockerImage.fromBuild("docker-path", options);
    image.run();

    const tagHash = crypto
      .createHash("sha256")
      .update(JSON.stringify({ path: "docker-path", ...options }))
      .digest("hex");
    const tag = `tcons-${tagHash}`;

    expect(child_process.spawnSync).toHaveBeenNthCalledWith(
      1,
      dockerCmd,
      [
        "build",
        "-t",
        tag,
        "--cache-from",
        "type=s3,region=us-west-2,bucket=my-bucket,name=foo",
        "--cache-from",
        "type=gha,url=https://example.com,token=abc123,scope=gh-ref-image2",
        "--cache-to",
        "type=local,dest=path/to/local/dir",
        "docker-path",
      ],
      expect.any(Object),
    );
    expect(child_process.spawnSync).toHaveBeenNthCalledWith(
      2,
      dockerCmd,
      ["run", "--rm", tag],
      expect.any(Object),
    );
  });

  test("bundling with image from asset with target stage", () => {
    (child_process.spawnSync as jest.Mock).mockReturnValue({ status: 0 });
    jest.spyOn(FileSystem, "fingerprint").mockReturnValue("123456abcdef");
    const targetStage = "i-love-testing";

    const image = DockerImage.fromBuild("docker-path", { targetStage });
    image.run();

    const tagHash = crypto
      .createHash("sha256")
      .update(JSON.stringify({ path: "docker-path", targetStage }))
      .digest("hex");
    const tag = `tcons-${tagHash}`;

    expect(child_process.spawnSync).toHaveBeenNthCalledWith(
      1,
      dockerCmd,
      ["build", "-t", tag, "--target", targetStage, "docker-path"],
      expect.any(Object),
    );
    expect(child_process.spawnSync).toHaveBeenNthCalledWith(
      2,
      dockerCmd,
      ["run", "--rm", tag],
      expect.any(Object),
    );
  });

  test("throws in case of spawnSync error", () => {
    (child_process.spawnSync as jest.Mock).mockReturnValue({
      status: 0,
      error: new Error("UnknownError"),
    });
    const image = DockerImage.fromRegistry("alpine");
    expect(() => image.run()).toThrow(/UnknownError/);
  });

  test("throws if status is not 0", () => {
    (child_process.spawnSync as jest.Mock).mockReturnValue({
      status: -1,
      stderr: Buffer.from("stderr"),
    });
    const image = DockerImage.fromRegistry("alpine");
    expect(() => image.run()).toThrow(/exited with status -1/);
  });

  test("BundlerDockerImage json is the bundler image name by default", () => {
    const image = DockerImage.fromRegistry("alpine");
    expect(image.toJSON()).toEqual("alpine");
  });

  test("BundlerDockerImage json is the bundler image if building an image", () => {
    (child_process.spawnSync as jest.Mock).mockReturnValue({ status: 0 });
    const imageHash = "123456abcdef";
    const fingerprintMock = jest
      .spyOn(FileSystem, "fingerprint")
      .mockReturnValue(imageHash);

    const image = DockerImage.fromBuild("docker-path");
    const tagHash = crypto
      .createHash("sha256")
      .update(JSON.stringify({ path: "docker-path" }))
      .digest("hex");

    expect(image.image).toEqual(`tcons-${tagHash}`);
    expect(image.toJSON()).toEqual(imageHash);
    expect(fingerprintMock).toHaveBeenCalledWith(
      "docker-path",
      expect.objectContaining({ extraHash: JSON.stringify({}) }),
    );
  });

  test("custom dockerfile is passed through to docker exec", () => {
    (child_process.spawnSync as jest.Mock).mockReturnValue({ status: 0 });
    const imagePath = path.join(__dirname, "fs", "fixtures", "test1");
    DockerImage.fromBuild(imagePath, { file: "my-dockerfile" });

    expect(child_process.spawnSync).toHaveBeenCalledTimes(1);
    const expectedFile = path.join(imagePath, "my-dockerfile");

    expect(child_process.spawnSync).toHaveBeenCalledWith(
      expect.any(String),
      expect.arrayContaining(["-f", expectedFile]),
      expect.any(Object),
    );
  });

  test("fromAsset", () => {
    (child_process.spawnSync as jest.Mock).mockReturnValue({ status: 0 });
    const imagePath = path.join(__dirname, "fs", "fixtures", "test1");
    const image = DockerImage.fromAsset(imagePath, { file: "my-dockerfile" });
    expect(image).toBeDefined();
    expect(image.image).toBeDefined();
  });

  test("custom entrypoint is passed through to docker exec", () => {
    Object.defineProperty(process, "platform", { value: "darwin" });
    (child_process.spawnSync as jest.Mock).mockReturnValue({ status: 0 });

    const image = DockerImage.fromRegistry("alpine");
    image.run({
      entrypoint: ["/cool/entrypoint", "--cool-entrypoint-arg"],
      command: ["cool", "command"],
      volumes: [{ hostPath: "/host-path", containerPath: "/container-path" }],
    });

    expect(child_process.spawnSync).toHaveBeenCalledWith(
      dockerCmd,
      expect.arrayContaining([
        "--entrypoint",
        "/cool/entrypoint",
        "alpine",
        "--cool-entrypoint-arg",
        "cool",
        "command",
      ]),
      expect.any(Object),
    );
  });

  test("cp utility copies from an image", () => {
    const containerId = "1234567890abcdef1234567890abcdef";
    (child_process.spawnSync as jest.Mock).mockReturnValue({
      status: 0,
      stdout: Buffer.from(`${containerId}\n`),
    });

    DockerImage.fromRegistry("alpine").cp("/foo/bar", "/baz");

    expect(child_process.spawnSync).toHaveBeenCalledWith(
      expect.any(String),
      ["create", "alpine"],
      expect.any(Object),
    );
    expect(child_process.spawnSync).toHaveBeenCalledWith(
      expect.any(String),
      ["cp", `${containerId}:/foo/bar`, "/baz"],
      expect.any(Object),
    );
    expect(child_process.spawnSync).toHaveBeenCalledWith(
      expect.any(String),
      ["rm", "-v", containerId],
      expect.any(Object),
    );
  });

  test("cp utility cleans up after itself", () => {
    const containerId = "1234567890abcdef1234567890abcdef";
    (child_process.spawnSync as jest.Mock).mockImplementation(
      (_cmd, args: string[]) => {
        if (args?.includes("cp")) {
          return { status: 1, stderr: Buffer.from("it failed") };
        }
        return { status: 0, stdout: Buffer.from(`${containerId}\n`) };
      },
    );

    expect(() =>
      DockerImage.fromRegistry("alpine").cp("/foo/bar", "/baz"),
    ).toThrow(/Failed to copy/i);

    expect(child_process.spawnSync).toHaveBeenCalledWith(
      expect.any(String),
      ["rm", "-v", containerId],
      expect.any(Object),
    );
  });

  test("cp utility copies to a temp dir if outputPath is omitted", () => {
    (child_process.spawnSync as jest.Mock).mockReturnValue({
      status: 0,
      stdout: Buffer.from("1234567890abcdef1234567890abcdef\n"),
    });
    const tempPath = DockerImage.fromRegistry("alpine").cp("/foo/bar");
    expect(tempPath).toMatch(/tcons-docker-cp-/);
  });

  test("adding user provided security-opt", () => {
    Object.defineProperty(process, "platform", { value: "darwin" });
    (child_process.spawnSync as jest.Mock).mockReturnValue({ status: 0 });
    const image = DockerImage.fromRegistry("alpine");

    image.run({
      command: ["cool", "command"],
      securityOpt: "no-new-privileges",
    });

    expect(child_process.spawnSync).toHaveBeenCalledWith(
      dockerCmd,
      expect.arrayContaining(["--security-opt", "no-new-privileges"]),
      expect.any(Object),
    );
  });

  test("adding user provided network options", () => {
    Object.defineProperty(process, "platform", { value: "darwin" });
    (child_process.spawnSync as jest.Mock).mockReturnValue({ status: 0 });
    const image = DockerImage.fromRegistry("alpine");

    image.run({ command: ["cool", "command"], network: "host" });

    expect(child_process.spawnSync).toHaveBeenCalledWith(
      dockerCmd,
      expect.arrayContaining(["--network", "host"]),
      expect.any(Object),
    );
  });

  test("adding user provided platform", () => {
    Object.defineProperty(process, "platform", { value: "darwin" });
    (child_process.spawnSync as jest.Mock).mockReturnValue({ status: 0 });
    const image = DockerImage.fromRegistry("alpine");

    image.run({ command: ["cool", "command"], platform: "linux/amd64" });

    expect(child_process.spawnSync).toHaveBeenCalledWith(
      dockerCmd,
      expect.arrayContaining(["--platform", "linux/amd64"]),
      expect.any(Object),
    );
  });

  test("adding user provided docker volume options", () => {
    Object.defineProperty(process, "platform", { value: "darwin" });
    (child_process.spawnSync as jest.Mock).mockReturnValue({ status: 1 });
    const image = DockerImage.fromRegistry("alpine");

    try {
      image.run({ command: ["cool", "command"], volumesFrom: ["foo", "bar"] });
    } catch {
      // expected to fail
    }

    expect(child_process.spawnSync).toHaveBeenCalledWith(
      dockerCmd,
      expect.arrayContaining([
        "--volumes-from",
        "foo",
        "--volumes-from",
        "bar",
      ]),
      expect.any(Object),
    );
  });

  test("ensure selinux docker mount", () => {
    Object.defineProperty(process, "platform", { value: "linux" });
    (child_process.spawnSync as jest.Mock)
      .mockReturnValueOnce({ status: 0 }) // selinux checkfromBuild
      .mockReturnValueOnce({ status: 0 }); // docker run

    const image = DockerImage.fromRegistry("alpine");
    image.run({
      command: ["cool", "command"],
      volumes: [{ hostPath: "/host-path", containerPath: "/container-path" }],
    });

    expect(child_process.spawnSync).toHaveBeenNthCalledWith(
      2,
      dockerCmd,
      expect.arrayContaining(["/host-path:/container-path:z,delegated"]),
      expect.any(Object),
    );
  });

  test("ensure selinux docker mount on linux with selinux disabled", () => {
    Object.defineProperty(process, "platform", { value: "linux" });
    (child_process.spawnSync as jest.Mock)
      .mockReturnValueOnce({ status: 1 }) // selinux check fails
      .mockReturnValueOnce({ status: 0 }); // docker run

    const image = DockerImage.fromRegistry("alpine");
    image.run({
      command: ["cool", "command"],
      volumes: [{ hostPath: "/host-path", containerPath: "/container-path" }],
    });

    expect(child_process.spawnSync).toHaveBeenNthCalledWith(
      2,
      dockerCmd,
      expect.arrayContaining(["/host-path:/container-path:delegated"]),
      expect.any(Object),
    );
  });

  test("ensure no selinux docker mount if selinuxenabled isn't an available command", () => {
    Object.defineProperty(process, "platform", { value: "linux" });
    (child_process.spawnSync as jest.Mock)
      .mockReturnValueOnce({ status: 127 }) // selinux check fails
      .mockReturnValueOnce({ status: 0 }); // docker run

    const image = DockerImage.fromRegistry("alpine");
    image.run({
      command: ["cool", "command"],
      volumes: [{ hostPath: "/host-path", containerPath: "/container-path" }],
    });

    expect(child_process.spawnSync).toHaveBeenNthCalledWith(
      2,
      dockerCmd,
      expect.arrayContaining(["/host-path:/container-path:delegated"]),
      expect.any(Object),
    );
  });

  test("ensure correct Docker CLI arguments are returned", () => {
    const fromSrc = DockerBuildSecret.fromSrc("path.json");
    expect(fromSrc).toEqual("src=path.json");
  });
});
