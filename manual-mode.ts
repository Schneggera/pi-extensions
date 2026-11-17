/**
 * Manual Mode Extension
 *
 * Cycles between MANUAL and AUTO mode for file changes.
 *
 * - MANUAL mode: every change to a file requires explicit permission. The
 *   built-in `edit` and `write` tools are gated behind a confirmation dialog,
 *   and `bash` commands that mutate the filesystem are gated too. Non-UI runs
 *   (print/json) block by default (fail-safe).
 * - AUTO mode: normal behavior, no prompts for file changes.
 *
 * Commands / keys:
 *   /manual         - Toggle manual mode
 *   Ctrl+Alt+M      - Toggle manual mode (shortcut)
 *
 * Test:   pi -e ./manual-mode.ts
 * Install: copy to ~/.pi/agent/extensions/ or .pi/extensions/
 */

import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { Key } from "@earendil-works/pi-tui";
import { Type } from "typebox";

// Tools that directly write to disk and must always be gated in manual mode.
const FILE_WRITE_TOOLS = new Set(["edit", "write", "multi_edit"]);

// What counts as a file mutation for the bash gate.
const MUTATING_PATTERNS = [
	/\brm\b/i,
	/\brmdir\b/i,
	/\bmv\b/i,
	/\bcp\b/i,
	/\bmkdir\b/i,
	/\btouch\b/i,
	/\bchmod\b/i,
	/\bchown\b/i,
	/\bchgrp\b/i,
	/\bln\b/i,
	/\btee\b/i,
	/\btruncate\b/i,
	/\bdd\b/i,
	/\bshred\b/i,
	/(^|[^<])>(?!>)/, // single redirect >
	/>>/,             // append redirect
	/\bnpm\s+(install|uninstall|update|ci|link|publish|init)/i,
	/\byarn\s+(add|remove|install|upgrade|init)/i,
	/\bpnpm\s+(add|remove|install|upgrade|init)/i,
	/\bpip\s+(install|uninstall|download)/i,
	/\bapt(-get)?\s+(install|remove|purge|update|upgrade)/i,
	/\bbrew\s+(install|uninstall|upgrade|tap|link)/i,
	/\bgit\s+(add|commit|push|pull|merge|rebase|reset|checkout|switch|stash|cherry-pick|revert|tag|init|clone|gc|clean)/i,
	/\bsudo\b/i,
	/\bkill\b/i,
	/\bpkill\b/i,
	/\bkillall\b/i,
	/\b(sed|awk|perl|python|node)\b.*-i\b/i, // in-place edits
];

interface ManualModeState {
	enabled: boolean;
}

function mutatesFilesystem(command: string): boolean {
	return MUTATING_PATTERNS.some((p) => p.test(command));
}

export default function manualMode(pi: ExtensionAPI): void {
	let manualEnabled = false;

	pi.registerFlag("manual", {
		description: "Start in manual mode (confirm every file change)",
		type: "boolean",
		default: false,
	});

	function updateStatus(ctx: ExtensionContext): void {
		ctx.ui.setStatus("manual-mode", manualEnabled ? ctx.ui.theme.fg("warning", "🔒 manual") : undefined);
	}

	function notifyState(ctx: ExtensionContext): void {
		ctx.ui.notify(
			manualEnabled
				? "Manual mode enabled — every file change now requires permission."
				: "Manual mode disabled — file changes are automatic again.",
			manualEnabled ? "warning" : "info",
		);
	}

	function persistState(): void {
		pi.appendEntry("manual-mode", { enabled: manualEnabled } satisfies ManualModeState);
	}

	function setManual(value: boolean, ctx: ExtensionContext): void {
		if (manualEnabled === value) return;
		manualEnabled = value;
		updateStatus(ctx);
		persistState();
	}

	function toggleManual(ctx: ExtensionContext): void {
		manualEnabled = !manualEnabled;
		updateStatus(ctx);
		notifyState(ctx);
		persistState();
	}

	// Expose a way for other extensions / scripts to query or set the mode.
	pi.registerTool({
		name: "set_manual_mode",
		label: "Manual Mode",
		description:
			"Query or set manual mode. In manual mode every file change (edit, write, or file-mutating bash) requires explicit user permission. Use this when the user asks to switch between manual and auto mode.",
		parameters: Type.Object({
			manual: Type.Optional(
				Type.Boolean({ description: "true to enable manual mode, false to disable, omit to query" }),
			),
		}),
		async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
			if (typeof params.manual === "boolean") {
				setManual(params.manual, ctx);
			}
			return {
				content: [
					{
						type: "text",
						text: manualEnabled
							? "Manual mode is ON — file changes require permission."
							: "Manual mode is OFF — file changes are automatic.",
					},
				],
				details: { manual: manualEnabled },
			};
		},
	});

	pi.registerCommand("manual", {
		description: "Toggle manual mode (confirm every file change)",
		handler: async (_args, ctx) => toggleManual(ctx),
	});

	pi.registerShortcut(Key.ctrlAlt("m"), {
		description: "Toggle manual mode",
		handler: async (ctx) => toggleManual(ctx),
	});

	// Gate every file change behind an explicit confirmation.
	pi.on("tool_call", async (event, ctx) => {
		if (!manualEnabled) return undefined;

		let changeDescription: string;
		let detail: string;

		if (FILE_WRITE_TOOLS.has(event.toolName)) {
			// edit / write / multi_edit — always a file change in manual mode.
			const input = event.input as { path?: string };
			changeDescription = event.toolName;
			detail = `${event.toolName} → ${input.path ?? "(unknown path)"}`;
		} else if (event.toolName === "bash") {
			const input = event.input as { command?: string };
			const command = input.command ?? "";
			if (!mutatesFilesystem(command)) return undefined;
			changeDescription = "bash command";
			detail = command;
		} else {
			return undefined;
		}

		// Fail-safe: with no UI we cannot ask, so block.
		if (!ctx.hasUI) {
			return {
				block: true,
				reason: `Manual mode: ${changeDescription} blocked because there is no UI to confirm permissions. Use /manual to allow automatic changes.`,
			};
		}

		const ok = await ctx.ui.confirm(
			"Manual mode — allow file change?",
			`${detail}\n\nThis operation changes files. Allow it?`,
		);

		if (!ok) {
			return { block: true, reason: `Manual mode: ${changeDescription} denied by user.` };
		}
		return undefined;
	});

	// Restore mode on session start/resume.
	pi.on("session_start", async (_event, ctx) => {
		if (pi.getFlag("manual") === true) {
			manualEnabled = true;
		}

		const entries = ctx.sessionManager.getEntries();
		const manualEntry = entries
			.filter((e: { type: string; customType?: string }) => e.type === "custom" && e.customType === "manual-mode")
			.pop() as { data?: ManualModeState } | undefined;

		if (manualEntry?.data) {
			manualEnabled = manualEntry.data.enabled ?? manualEnabled;
		}

		updateStatus(ctx);
		persistState();
	});
}
