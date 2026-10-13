import { expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import { mkdtemp, rm, writeFile } from "node:fs/promises"
import { builtinModules, createRequire } from "node:module"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { pathToFileURL } from "node:url"

test("published TUI runtime imports are production dependencies", () => {
  const packageJson = JSON.parse(readFileSync("package.json", "utf8")) as {
    dependencies?: Record<string, string>
    devDependencies?: Record<string, string>
  }
  for (const dependency of ["@opentui/solid", "solid-js"]) {
    expect(packageJson.dependencies?.[dependency]).toBeString()
    expect(packageJson.devDependencies?.[dependency]).toBeUndefined()
  }
})

test("published server loads when the host shares Effect 4", async () => {
  const root = join(import.meta.dir, "..")
  const build = Bun.spawn(["bun", "run", "build"], { cwd: root, stdout: "pipe", stderr: "pipe" })
  const buildError = await new Response(build.stderr).text()
  expect(await build.exited, buildError).toBe(0)

  const directory = await mkdtemp(join(tmpdir(), "loop-package-test-"))
  try {
    const hostEffect = createRequire(import.meta.resolve("@opencode/plugin")).resolve("effect")
    const stateEffect = Bun.resolveSync("effect", join(root, "dist"))
    const script = join(directory, "probe.ts")
    await writeFile(script, `
      import { mock } from "bun:test"
      import { readFile } from "node:fs/promises"
      import * as hostEffect from ${JSON.stringify(pathToFileURL(hostEffect).href)}
      if (typeof hostEffect.Schema.optionalWith !== "undefined") throw new Error("Expected Effect 4 host")
      mock.module(${JSON.stringify(stateEffect)}, () => hostEffect)
      const { default: plugin } = await import(${JSON.stringify(pathToFileURL(join(root, "dist/server.js")).href)})
      if (typeof plugin.server !== "function" || typeof plugin.setup !== "function") throw new Error("Missing server entrypoints")
      const hooks = await plugin.server({ client: { session: { status: async () => ({ data: {} }) }, app: { log: async () => {} } } })
      try {
        const context = { sessionID: "ses_package" }
        const result = JSON.parse(await hooks.tool.create_loop.execute({ instruction: "tick", interval: "1m", keep_alive: true }, context))
        await hooks.tool.stop_loop.execute({ loop_id: result.created }, context)
        const state = JSON.parse(await readFile(process.env.OPENCODE_LOOP_STATE_PATH, "utf8"))
        const loop = state.loops[result.created]
        if (!loop.keepAlive || loop.status !== "stopped") throw new Error("Bundled persistence failed")
      } finally {
        await hooks.dispose()
      }
    `)
    const probe = Bun.spawn(["bun", script], {
      env: { ...process.env, OPENCODE_LOOP_STATE_PATH: join(directory, "loops.json") },
      stdout: "pipe",
      stderr: "pipe",
    })
    const error = await new Response(probe.stderr).text()
    expect(await probe.exited, error).toBe(0)
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
}, 10_000)

test("built plugin imports only Node builtins and host-provided runtime modules", async () => {
  const root = join(import.meta.dir, "..")
  const build = Bun.spawn(["bun", "run", "build"], { cwd: root, stdout: "pipe", stderr: "pipe" })
  const buildError = await new Response(build.stderr).text()
  expect(await build.exited, buildError).toBe(0)

  // A directory plugin loads without node_modules: anything else must be bundled.
  const hostProvided = /^(?:@opentui\/|solid-js(?:\/|$)|@opencode\/)/
  const transpiler = new Bun.Transpiler({ loader: "js" })
  const unresolved = (["server.js", "tui.js"] as const).flatMap((file) =>
    transpiler
      .scan(readFileSync(join(root, "dist", file), "utf8"))
      .imports.map((entry) => entry.path)
      .filter(
        (specifier) =>
          !specifier.startsWith("node:") &&
          !builtinModules.includes(specifier) &&
          !(file === "tui.js" && hostProvided.test(specifier)),
      )
      .map((specifier) => `${file}: ${specifier}`),
  )
  expect(unresolved).toEqual([])
}, 10_000)
