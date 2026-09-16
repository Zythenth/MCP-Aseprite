import { randomUUID } from "node:crypto";
/** In-memory approval receipts. A receipt is valid only for the reviewed document revision. */
export class ApprovalState {
    approvals = new Map();
    record(input) {
        const receipt = {
            ...input,
            approvalId: randomUUID(),
            approvedAt: new Date().toISOString(),
        };
        this.approvals.set(receipt.approvalId, receipt);
        return receipt;
    }
    validate(approvalId, sessionId, revision) {
        if (!approvalId)
            throw new Error("Final export requires humanApprovalId from request_human_approval.");
        const receipt = this.approvals.get(approvalId);
        if (!receipt)
            throw new Error("humanApprovalId is unknown in this MCP session.");
        if (receipt.decision !== "approved")
            throw new Error(`Final export blocked by human decision: ${receipt.decision}.`);
        if (receipt.sessionId !== sessionId || receipt.revision !== revision) {
            throw new Error("Human approval is stale because the Aseprite document or revision changed; request approval again.");
        }
        return receipt;
    }
}
//# sourceMappingURL=approvalState.js.map