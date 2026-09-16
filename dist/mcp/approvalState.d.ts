export type ApprovalDecision = "approved" | "changes_requested" | "rejected";
export interface HumanApproval {
    approvalId: string;
    decision: ApprovalDecision;
    feedback: string;
    revision: number;
    sessionId: string | null;
    approvedAt: string;
}
/** In-memory approval receipts. A receipt is valid only for the reviewed document revision. */
export declare class ApprovalState {
    private readonly approvals;
    record(input: Omit<HumanApproval, "approvalId" | "approvedAt">): HumanApproval;
    validate(approvalId: string | undefined, sessionId: string | null, revision: number): HumanApproval;
}
//# sourceMappingURL=approvalState.d.ts.map