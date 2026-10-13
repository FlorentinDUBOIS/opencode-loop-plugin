import solidPlugin from "@opentui/solid/bun-plugin"

// The TUI half compiles Solid JSX at build time so dist/tui.js loads from a
// plain directory with no node_modules. The host provides these runtime modules.
const result = await Bun.build({
  entrypoints: ["./src/tui.tsx"],
  outdir: "./dist",
  target: "bun",
  external: ["@opentui/*", "solid-js", "solid-js/*", "@opencode/*", "@opencode-ai/*"],
  plugins: [solidPlugin],
})

if (!result.success) {
  for (const log of result.logs) console.error(log)
  process.exit(1)
}
