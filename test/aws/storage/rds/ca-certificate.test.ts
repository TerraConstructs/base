import { CaCertificate } from "../../../../src/aws/storage/rds";

describe("CaCertificate", () => {
  test("well-known identifiers resolve to their expected string values", () => {
    expect(CaCertificate.RDS_CA_2019.toString()).toEqual("rds-ca-2019");
    expect(CaCertificate.RDS_CA_ECC384_G1.toString()).toEqual(
      "rds-ca-ecc384-g1",
    );
    expect(CaCertificate.RDS_CA_RDS2048_G1.toString()).toEqual(
      "rds-ca-rsa2048-g1",
    );
    expect(CaCertificate.RDS_CA_RSA2048_G1.toString()).toEqual(
      "rds-ca-rsa2048-g1",
    );
    expect(CaCertificate.RDS_CA_RDS4096_G1.toString()).toEqual(
      "rds-ca-rsa4096-g1",
    );
    expect(CaCertificate.RDS_CA_RSA4096_G1.toString()).toEqual(
      "rds-ca-rsa4096-g1",
    );
  });

  test("deprecated misspelled aliases match their corrected counterparts", () => {
    expect(CaCertificate.RDS_CA_RDS2048_G1.toString()).toEqual(
      CaCertificate.RDS_CA_RSA2048_G1.toString(),
    );
    expect(CaCertificate.RDS_CA_RDS4096_G1.toString()).toEqual(
      CaCertificate.RDS_CA_RSA4096_G1.toString(),
    );
  });

  test("CaCertificate.of() builds a custom CA certificate from an identifier", () => {
    const custom = CaCertificate.of("rds-ca-custom");
    expect(custom.toString()).toEqual("rds-ca-custom");
  });
});
