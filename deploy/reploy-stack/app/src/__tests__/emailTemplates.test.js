const {
  buildConfirmationEmail,
  buildBulkConfirmationEmails,
  escapeHtml,
} = require("../emailTemplates");

describe("buildConfirmationEmail", () => {
  const baseParams = {
    userName: "Alice",
    email: "alice@example.com",
    token: "abc123",
    baseUrl: "https://app.example.com",
  };

  it("returns a well-formed email object", () => {
    const email = buildConfirmationEmail(baseParams);

    expect(email.to).toBe("alice@example.com");
    expect(email.subject).toContain("access");
    expect(typeof email.textBody).toBe("string");
    expect(typeof email.htmlBody).toBe("string");
  });

  it("includes yes and no URLs with the token in the text body", () => {
    const email = buildConfirmationEmail(baseParams);

    expect(email.textBody).toContain("response=yes");
    expect(email.textBody).toContain("response=no");
    expect(email.textBody).toContain("token=abc123");
  });

  it("includes yes and no links in the HTML body", () => {
    const email = buildConfirmationEmail(baseParams);

    expect(email.htmlBody).toContain("response=yes");
    expect(email.htmlBody).toContain("response=no");
    expect(email.htmlBody).toContain("abc123");
  });

  it("addresses the user by name", () => {
    const email = buildConfirmationEmail(baseParams);

    expect(email.textBody).toContain("Hello Alice");
    expect(email.htmlBody).toContain("Hello Alice");
  });

  it("URL-encodes the token", () => {
    const email = buildConfirmationEmail({
      ...baseParams,
      token: "a token with spaces&special=chars",
    });

    expect(email.textBody).toContain(
      encodeURIComponent("a token with spaces&special=chars")
    );
  });
});

describe("buildBulkConfirmationEmails", () => {
  it("generates one email per user", () => {
    const users = [
      { user_key: "alice", email: "alice@example.com", token: "tok1" },
      { user_key: "bob", email: "bob@example.com", token: "tok2" },
    ];

    const emails = buildBulkConfirmationEmails(users, "https://app.example.com");

    expect(emails).toHaveLength(2);
    expect(emails[0].to).toBe("alice@example.com");
    expect(emails[1].to).toBe("bob@example.com");
    expect(emails[0].textBody).toContain("tok1");
    expect(emails[1].textBody).toContain("tok2");
  });
});

describe("escapeHtml", () => {
  it("escapes HTML special characters", () => {
    expect(escapeHtml('<script>"hello"&</script>')).toBe(
      "&lt;script&gt;&quot;hello&quot;&amp;&lt;/script&gt;"
    );
  });
});
