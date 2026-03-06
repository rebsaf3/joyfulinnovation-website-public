const { createEmailSender } = require("../emailSender");

describe("createEmailSender – log-only mode", () => {
  it("captures sent emails in the .sent array", async () => {
    const sender = createEmailSender(); // no config → log-only

    const result = await sender.sendMail({
      to: "alice@example.com",
      subject: "Test",
      text: "Hello",
      html: "<p>Hello</p>",
    });

    expect(result.logged).toBe(true);
    expect(result.messageId).toMatch(/^log-/);

    expect(sender.sent).toHaveLength(1);
    expect(sender.sent[0].to).toBe("alice@example.com");
    expect(sender.sent[0].subject).toBe("Test");
    expect(sender.sent[0].sentAt).toBeDefined();
  });

  it("accumulates multiple sends", async () => {
    const sender = createEmailSender();

    await sender.sendMail({ to: "a@b.com", subject: "1", text: "", html: "" });
    await sender.sendMail({ to: "c@d.com", subject: "2", text: "", html: "" });

    expect(sender.sent).toHaveLength(2);
  });

  it("has transporter = null in log-only mode", () => {
    const sender = createEmailSender();
    expect(sender.transporter).toBeNull();
  });
});

describe("createEmailSender – SMTP mode", () => {
  it("creates a real transporter when config is provided", () => {
    const sender = createEmailSender({
      host: "smtp.example.com",
      port: 587,
      auth: { user: "u", pass: "p" },
    });

    expect(sender.transporter).not.toBeNull();
    expect(sender.sent).toBeNull();
  });
});
