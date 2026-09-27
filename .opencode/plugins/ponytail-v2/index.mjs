// ponytail — OpenCode v2 compatibility shim.
//
// WHY THIS EXISTS
// @dietrichgebert/ponytail@4.10.0 ships only a v1 plugin: its default export is an
// async function returning a hooks object, and its hooks are named
// `experimental.chat.system.transform` / `command.execute.before`. OpenCode v2
// requires `Plugin.define({ id, setup })` (a default-exported *object*), so
// loading the package directly fails with:
//
//   PluginModule.LoadError: Plugin must export a default definition with an id
//   and an effect or setup function. (cause: SchemaError(Expected object at
//   ["default"]))
//
// This shim re-implements the same behaviour against the v2 plugin API and
// imports the package's OWN instruction builder, so the ruleset text stays
// owned by upstream and is not duplicated here.
//
// Equivalent mappings from v1 -> v2:
//   config hook pushing skills.paths        -> ctx.skill.transform
//   config hook pushing config.command      -> ctx.command.transform
//   experimental.chat.system.transform      -> ctx.session.hook("context")
//   command.execute.before                  -> parse mode from prompt.text
//
// Like upstream, a mode change takes effect on the NEXT turn, not the current
// one, because the transform reads the flag the command writes.
//
// Remove this file once upstream ships a v2-compatible plugin.

import fs from "fs"
import os from "os"
import path from "path"
import { createRequire } from "module"

const require = createRequire(import.meta.url)

// Upstream stores the active mode next to the OpenCode config; keep the same
// location so an existing `.ponytail-active` keeps working across the switch.
const statePath = path.join(
  process.env.XDG_CONFIG_HOME || path.join(os.homedir(), ".config"),
  "opencode",
  ".ponytail-active",
)

/** Locate the installed ponytail package inside OpenCode's npm cache. */
function resolvePackageRoot() {
  // Escape hatch for unusual setups.
  if (process.env.PONYTAIL_PACKAGE_DIR) return process.env.PONYTAIL_PACKAGE_DIR

  const npmCache = path.join(os.homedir(), ".cache", "opencode", "npm")
  const scope = path.join(npmCache, "@dietrichgebert")
  if (!fs.existsSync(scope)) return null

  // Layout: <npmCache>/@dietrichgebert/ponytail@<tag>/<hash>/node_modules/@dietrichgebert/ponytail
  // The <hash> segment changes on every reinstall, so pick the newest by mtime.
  const candidates = []
  for (const pkgDir of fs.readdirSync(scope)) {
    const versionRoot = path.join(scope, pkgDir)
    if (!fs.statSync(versionRoot).isDirectory()) continue
    for (const hash of fs.readdirSync(versionRoot)) {
      const root = path.join(versionRoot, hash, "node_modules", "@dietrichgebert", "ponytail")
      if (fs.existsSync(path.join(root, "hooks", "ponytail-instructions.js"))) {
        candidates.push({ root, mtime: fs.statSync(path.join(versionRoot, hash)).mtimeMs })
      }
    }
  }
  if (candidates.length === 0) return null
  candidates.sort((a, b) => b.mtime - a.mtime)
  return candidates[0].root
}

function readMode() {
  const pkg = resolvePackageRoot()
  if (!pkg) return "full"
  const { getDefaultMode, normalizePersistedMode } = require(path.join(pkg, "hooks", "ponytail-config"))
  try {
    return normalizePersistedMode(fs.readFileSync(statePath, "utf8").trim()) || getDefaultMode()
  } catch {
    return getDefaultMode()
  }
}

function writeMode(mode) {
  fs.mkdirSync(path.dirname(statePath), { recursive: true })
  fs.writeFileSync(statePath, mode, "utf8")
}

/** Read `description` + body from a ponytail command markdown file. */
function parseCommandFile(file) {
  const content = fs.readFileSync(file, "utf8")
  const match = content.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n([\s\S]*)$/)
  if (!match) return null
  return {
    description: match[1].match(/description:\s*(.+)/)?.[1]?.trim(),
    template: match[2].trim(),
  }
}

export default {
  id: "ponytail",

  async setup(ctx) {
    const pkg = resolvePackageRoot()
    if (!pkg) {
      console.error("[ponytail] package not found in OpenCode npm cache; shim inactive")
      return
    }

    const { getPonytailInstructions } = require(path.join(pkg, "hooks", "ponytail-instructions"))
    const { normalizePersistedMode } = require(path.join(pkg, "hooks", "ponytail-config"))

    // Reports the active intensity. Also the quickest way to confirm the shim
    // loaded at all, since registered tools show up in the agent's tool list.
    await ctx.tool.transform((editor) => {
      editor.add({
        name: "ponytail_status",
        description: "Report which ponytail intensity is currently active and where it is stored",
        input: { type: "object", properties: {}, additionalProperties: false },
        execute: async () => ({
          content: [
            {
              type: "text",
              text: `ponytail mode: ${readMode()}\nstate file: ${statePath}\npackage: ${pkg}`,
            },
          ],
        }),
      })
    })

    // 1. Append the ruleset to the system prompt on every agent-loop turn.
    await ctx.session.hook("context", (event) => {
      const mode = readMode()
      if (mode === "off") return
      event.system.push({ type: "text", text: getPonytailInstructions(mode) })
    })

    // 2. Commands. v2's CommandInvocation has no `arguments` field, so the mode
    //    is parsed back out of the raw prompt text.
    await ctx.command.transform((editor) => {
      // /ponytail [off|lite|full|ultra|review]
      editor.add({
        name: "ponytail",
        description: "Set ponytail intensity: off, lite, full, ultra, review",
        execute: async ({ sessionID, prompt, delivery }) => {
          const arg = String(prompt?.text || "").match(/\bponytail\s+([a-z]+)/i)?.[1]
          const mode = arg ? normalizePersistedMode(arg) : null
          if (arg && !mode) {
            await ctx.session.prompt({
              sessionID,
              delivery,
              text: "Unknown ponytail mode. Use one of: off, lite, full, ultra, review.",
            })
            return
          }
          const next = mode || "full"
          writeMode(next)
          await ctx.session.prompt({
            sessionID,
            delivery,
            text: `Ponytail mode set to \`${next}\`. It applies from my next message. Acknowledge briefly and continue.`,
          })
        },
      })

      // The remaining upstream commands are prompt templates.
      const commandDir = path.join(pkg, ".opencode", "command")
      for (const file of fs.existsSync(commandDir) ? fs.readdirSync(commandDir) : []) {
        if (!file.endsWith(".md")) continue
        const name = path.basename(file, ".md")
        if (name === "ponytail") continue
        const parsed = parseCommandFile(path.join(commandDir, file))
        if (!parsed) continue
        editor.add({
          name,
          description: parsed.description,
          execute: async ({ sessionID, delivery }) => {
            await ctx.session.prompt({ sessionID, delivery, text: parsed.template })
          },
        })
      }
    })

    // 3. Expose upstream's skills (skills/<name>/SKILL.md).
    await ctx.skill.transform((editor) => {
      const skillsDir = path.join(pkg, "skills")
      if (!fs.existsSync(skillsDir)) return
      for (const entry of fs.readdirSync(skillsDir)) {
        const skillFile = path.join(skillsDir, entry, "SKILL.md")
        if (!fs.existsSync(skillFile)) continue
        const raw = fs.readFileSync(skillFile, "utf8")
        const fm = raw.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n([\s\S]*)$/)
        const name = fm?.[1]?.match(/^name:\s*(.+)$/m)?.[1]?.trim() || entry
        const description = fm?.[1]?.match(/^description:\s*(.+)$/m)?.[1]?.trim() || ""
        editor.add({
          id: entry,
          name,
          description,
          path: skillFile,
          content: fm ? fm[2].trim() : raw.trim(),
        })
      }
    })
  },
}
