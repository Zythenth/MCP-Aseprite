// src/mcp/server.ts
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { Transport } from "@modelcontextprotocol/sdk/shared/transport.js";
import { CommandDispatcher } from "../bridge/dispatcher.js";
import { BridgeState } from "../bridge/state.js";
import { registerStatusTool } from "./tools/status.js";
import { registerVisualTools } from "./tools/visual.js";
import { registerEditingTools } from "./tools/editing.js";
import { registerFileTools } from "./tools/files.js";
import { registerShapeTools } from "./tools/shapes.js";
import { registerLayerTools } from "./tools/layers.js";
import { registerFrameTools } from "./tools/frames.js";
import { registerPaletteTools } from "./tools/palette.js";
import { registerCelTools } from "./tools/cels.js";
import { registerSliceTools } from "./tools/slices.js";
import { registerSelectionTools } from "./tools/selection.js";
import { registerTileTools } from "./tools/tiles.js";
import { registerAnimationInspectionTools } from "./tools/animation.js";
import { registerBatchTools } from "./tools/batch.js";
import { registerWorkflowTools } from "./tools/workflow.js";
import { registerPixelArtTools } from "./tools/pixelArt.js";
import { registerReviewTools } from "./tools/review.js";
import { registerPixelMotionTools } from "./tools/pixelMotion.js";
import { registerApprovalTools } from "./tools/approval.js";
import { registerEngineExportTools } from "./tools/engineExport.js";
import { registerBatchExportTools } from "./tools/batchExport.js";
import { registerLivePaintingTools } from "./tools/livePainting.js";
import { registerDirectionalActionTools } from "./tools/directionalActions.js";
import { ReviewState } from "./reviewState.js";
import { AnimationWorkflowState } from "./animationWorkflowState.js";
import { ApprovalState } from "./approvalState.js";
import { LivePaintingState } from "./livePaintingState.js";
import { createPolicyToolRegistrar } from "./toolPolicy.js";
import type { Toolset } from "../config.js";
import { registerMcpResources } from "./resources/index.js";
import { PIXEL_ART_WORKFLOW_INSTRUCTIONS } from "./instructions.js";
import { config } from "../config.js";
import { logger } from "../logger.js";

export function createMcpServer(
  dispatcher?: CommandDispatcher,
  stateTracker?: BridgeState,
  options: { readOnly?: boolean; toolsets?: Toolset[] } = {}
): McpServer {
  const activeDispatcher = dispatcher || new CommandDispatcher();
  const activeStateTracker = stateTracker || new BridgeState();
  const reviewState = new ReviewState();
  const workflowState = new AnimationWorkflowState(activeStateTracker);
  const approvalState = new ApprovalState();
  const livePaintingState = new LivePaintingState(activeStateTracker);
  const readOnly = options.readOnly ?? config.readOnly;
  const enabledToolsets = new Set(options.toolsets ?? [...config.toolsets]);

  const server = new McpServer(
    {
      name: config.serverName,
      version: config.serverVersion,
    },
    {
      capabilities: {
        tools: {},
        resources: {},
      },
      instructions: PIXEL_ART_WORKFLOW_INSTRUCTIONS,
    }
  );
  const toolRegistrar = createPolicyToolRegistrar(server, readOnly, livePaintingState);

  // Register Core and Specialized Tools
  registerStatusTool(toolRegistrar, activeDispatcher, activeStateTracker);
  if (enabledToolsets.has("visual")) registerVisualTools(toolRegistrar, activeDispatcher, activeStateTracker);
  if (enabledToolsets.has("editing")) {
    registerEditingTools(toolRegistrar, activeDispatcher, activeStateTracker);
    registerLivePaintingTools(toolRegistrar, activeDispatcher, activeStateTracker, livePaintingState);
  }
  if (enabledToolsets.has("files")) registerFileTools(toolRegistrar, activeDispatcher, activeStateTracker, workflowState, approvalState);
  if (enabledToolsets.has("files")) registerEngineExportTools(toolRegistrar, activeDispatcher, activeStateTracker);
  if (enabledToolsets.has("files")) registerBatchExportTools(toolRegistrar, activeDispatcher);
  if (enabledToolsets.has("shapes")) registerShapeTools(toolRegistrar, activeDispatcher, activeStateTracker);
  if (enabledToolsets.has("layers")) registerLayerTools(toolRegistrar, activeDispatcher, activeStateTracker);
  if (enabledToolsets.has("frames")) registerFrameTools(toolRegistrar, activeDispatcher, activeStateTracker);
  if (enabledToolsets.has("palette")) registerPaletteTools(toolRegistrar, activeDispatcher, activeStateTracker);
  if (enabledToolsets.has("cels")) registerCelTools(toolRegistrar, activeDispatcher, activeStateTracker);
  if (enabledToolsets.has("slices")) registerSliceTools(toolRegistrar, activeDispatcher, activeStateTracker);
  if (enabledToolsets.has("selection")) registerSelectionTools(toolRegistrar, activeDispatcher, activeStateTracker);
  if (enabledToolsets.has("tiles")) registerTileTools(toolRegistrar, activeDispatcher, activeStateTracker);
  if (enabledToolsets.has("animation")) {
    registerAnimationInspectionTools(toolRegistrar, activeDispatcher, activeStateTracker, workflowState);
    registerBatchTools(toolRegistrar, activeDispatcher, activeStateTracker);
    registerWorkflowTools(toolRegistrar, activeDispatcher, activeStateTracker, workflowState);
    registerPixelMotionTools(toolRegistrar, activeDispatcher, activeStateTracker);
    registerApprovalTools(toolRegistrar, activeDispatcher, activeStateTracker, approvalState);
    registerDirectionalActionTools(toolRegistrar, activeDispatcher, activeStateTracker);
  }
  if (enabledToolsets.has("pixel-art")) registerPixelArtTools(toolRegistrar, activeDispatcher, activeStateTracker, reviewState);
  if (enabledToolsets.has("review")) registerReviewTools(toolRegistrar, activeDispatcher, activeStateTracker, reviewState);

  // Register MCP Resources
  registerMcpResources(server, activeDispatcher, activeStateTracker);

  return server;
}

export async function startMcpServer(
  server: McpServer,
  transport?: Transport
): Promise<void> {
  const activeTransport = transport ?? new StdioServerTransport();
  logger.info("Connecting McpServer to stdio transport...");
  await server.connect(activeTransport);
  logger.info(`${config.serverName} connected and listening on stdio.`);
}

export async function stopMcpServer(server: McpServer): Promise<void> {
  try {
    await server.close();
    logger.info(`${config.serverName} stopped successfully.`);
  } catch (err: any) {
    logger.error(`Error stopping McpServer: ${err.message}`);
  }
}
