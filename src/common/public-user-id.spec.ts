import {
  PUBLIC_USER_ID_ALPHABET,
  PUBLIC_USER_ID_BODY_LENGTH,
  PUBLIC_USER_ID_PREFIX,
  generatePublicUserId,
  normalizePublicUserId,
} from "./public-user-id";

describe("public-user-id", () => {
  it("generates HT- prefixed IDs with the allowed alphabet", () => {
    const id = generatePublicUserId();
    const body = id.slice(PUBLIC_USER_ID_PREFIX.length);

    expect(id.startsWith(PUBLIC_USER_ID_PREFIX)).toBe(true);
    expect(body).toHaveLength(PUBLIC_USER_ID_BODY_LENGTH);
    expect([...body].every((char) => PUBLIC_USER_ID_ALPHABET.includes(char))).toBe(
      true,
    );
  });

  it("generates different IDs across calls", () => {
    const ids = new Set(
      Array.from({ length: 20 }, () => generatePublicUserId()),
    );

    expect(ids.size).toBeGreaterThan(1);
  });

  it("normalizes case and surrounding whitespace", () => {
    expect(normalizePublicUserId("  ht-7k4m9q2x  ")).toBe("HT-7K4M9Q2X");
    expect(normalizePublicUserId("Ht-7K4m9Q2X")).toBe("HT-7K4M9Q2X");
  });

  it("rejects partial, username-like, and invalid alphabet input", () => {
    expect(normalizePublicUserId("HT-7K4")).toBeNull();
    expect(normalizePublicUserId("rohan")).toBeNull();
    expect(normalizePublicUserId("Rohan")).toBeNull();
    expect(normalizePublicUserId("HT-7K4M9Q2O")).toBeNull();
    expect(normalizePublicUserId("HT-7K4M9Q21")).toBeNull();
    expect(normalizePublicUserId("")).toBeNull();
  });
});
