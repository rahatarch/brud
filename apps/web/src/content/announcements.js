export const ANNOUNCEMENTS = {
  eyebrow: "AKKHAR-LABS DISPATCH",
  title: "Announcements & Advance Notices",
  lede: "Upcoming architectural shifts, future release roadmaps, and advance notices for breaking changes before they land in production.",
  items: [
    {
      type: "Upcoming Breaking Change",
      tag: "ADVANCE NOTICE",
      status: "Planned for v0.2.0",
      date: "Target: Q4 2026",
      badgeStyle: "warning",
      title: "RFC: Autonomous Loop Protocol & Strict Execution Boundaries",
      summary:
        "Advance notice on planned schema adjustments for headless execution and AST validation contracts. Review the upcoming specifications before migration.",
      details: [
        "Introduction of cryptographically bounded workspace execution.",
        "Legacy search/replace block parser deprecation timeline (90-day grace period).",
        "Zero breaking changes will be released without a 30-day pre-notification window.",
      ],
    },
    {
      type: "Future Milestone",
      tag: "ROADMAP PREVIEW",
      status: "Under Architecture Review",
      date: "Target: Q4 2026",
      badgeStyle: "accent",
      title: "Native Multi-Workspace Orchestration Engine",
      summary:
        "Preliminary architecture notice for cross-monorepo session synchronization and centralized audit logs.",
      details: [
        "Seamless session handoff across nested package boundaries.",
        "Unified patch coordinator for multi-root VS Code workspaces.",
      ],
    },
  ],
};