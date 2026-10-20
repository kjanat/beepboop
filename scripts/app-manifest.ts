const origin = new URL(process.argv[2] ?? "https://beepboop.kjanat.dev");
if (origin.protocol !== "https:" || origin.username || origin.password || origin.pathname !== "/")
  throw new Error("Expected HTTPS origin");
console.log(
  JSON.stringify(
    {
      name: "Beepboop by kjanat",
      url: "https://github.com/kjanat/beepboop",
      public: false,
      description: "Release routing across repositories. Beep. Boop.",
      hook_attributes: { url: new URL("/webhooks/github", origin).href, active: true },
      default_permissions: { contents: "read", actions: "write", metadata: "read" },
      default_events: ["release", "workflow_run"],
    },
    null,
    2,
  ),
);

export {};
