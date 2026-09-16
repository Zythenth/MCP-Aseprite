import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CommandDispatcher } from "../../bridge/dispatcher.js";
import type { BridgeState } from "../../bridge/state.js";
import { ApprovalState, type ApprovalDecision } from "../approvalState.js";
import { bridgeToolError } from "./common.js";

export function registerApprovalTools(
  server: McpServer,
  dispatcher: CommandDispatcher,
  stateTracker: BridgeState,
  approvalState: ApprovalState
): void {
  server.tool(
    "request_human_approval",
    "Shows a blocking native Aseprite review dialog with a rendered frame preview. Final exports require an approved, current receipt from this tool.",
    {
      title: z.string().min(1).max(128).default("Aprovação de exportação"),
      summary: z.string().min(1).max(2048),
      frameNumber: z.number().int().positive().optional(),
    },
    async (args) => {
      try {
        if (!stateTracker.isConnected()) throw new Error("A connected Aseprite bridge is required for human approval.");
        const result = await dispatcher.send<{ decision: ApprovalDecision; feedback?: string; revision?: number }>(
          "show_human_approval",
          args,
          5 * 60_000
        );
        if (!["approved", "changes_requested", "rejected"].includes(result.decision)) {
          throw new Error("Aseprite returned an invalid human approval decision.");
        }
        const revision = typeof result.revision === "number" ? result.revision : stateTracker.getRevision();
        stateTracker.setRevision(revision);
        const receipt = approvalState.record({
          decision: result.decision,
          feedback: result.feedback ?? "",
          revision,
          sessionId: stateTracker.getSessionId(),
        });
        return { content: [{ type: "text", text: JSON.stringify({ success: true, ...receipt }) }] };
      } catch (error) {
        return bridgeToolError(error);
      }
    }
  );
}
