import { Box, Text } from "ink";
import type { Theme, ModelInfo } from "./types";

interface QuotaViewProps {
  theme: Theme;
  models: ModelInfo[];
  selectedModel: string;
  contextUsage: number;
  maxContext: number;
  costTokens: number;
  messagesCount: number;
  onClose: () => void;
}

function UsageBar({ used, total, theme }: { used: number; total: number; theme: Theme }) {
  const barWidth = 30;
  const pct = total > 0 ? Math.min(used / total, 1) : 0;
  const filled = Math.round(pct * barWidth);
  const empty = barWidth - filled;
  const color = pct > 0.9 ? theme.error : pct > 0.7 ? theme.warning : theme.success;

  return (
    <Box>
      <Text color={theme.border}>[</Text>
      <Text color={color}>{"█".repeat(filled)}</Text>
      <Text color={theme.dim}>{"░".repeat(Math.max(0, empty))}</Text>
      <Text color={theme.border}>]</Text>
      <Text color={theme.textDim}> {(pct * 100).toFixed(0)}%</Text>
    </Box>
  );
}

function ModelQuotaRow({ model, currentModelId, theme }: { model: ModelInfo; currentModelId: string; theme: Theme }) {
  const isCurrent = model.id === currentModelId;
  const ctx = model.contextWindow;
  const ctxLabel = ctx >= 1_000_000 ? `${(ctx / 1_000_000).toFixed(1)}M` : ctx >= 1_000 ? `${(ctx / 1_000).toFixed(0)}K` : String(ctx);

  return (
    <Box>
      <Text color={isCurrent ? theme.success : theme.textDim}>{isCurrent ? "●" : "○"}</Text>
      <Text color={isCurrent ? theme.text : theme.textDim}> </Text>
      <Box width={30}>
        <Text color={theme.text} wrap="truncate-end">
          {model.provider ? `${model.provider}/${model.name || model.id}` : model.name || model.id}
        </Text>
      </Box>
      <Text color={theme.border}> │ </Text>
      <Box width={8}>
        <Text color={theme.textDim}>{ctxLabel.padStart(6)} ctx</Text>
      </Box>
      <Text color={theme.border}> │ </Text>
      {model.capabilities.length > 0 ? (
        <Text color={theme.dim}>
          {model.capabilities.slice(0, 4).join(",")}
          {model.capabilities.length > 4 ? "..." : ""}
        </Text>
      ) : (
        <Text color={theme.dim}>—</Text>
      )}
    </Box>
  );
}

export function QuotaView({ theme, models, selectedModel, contextUsage, maxContext, costTokens, messagesCount, onClose: _oc }: QuotaViewProps) {
  void _oc;
  const sessionTotal = contextUsage + costTokens;
  const avgPerMsg = messagesCount > 0 ? Math.round(sessionTotal / messagesCount) : 0;

  return (
    <Box flexDirection="column" alignItems="center" justifyContent="center" width="100%">
      <Box flexDirection="column" padding={1} width={72}>
        <Box marginBottom={1}>
          <Text bold color={theme.primary}>Model Quotas & Token Usage</Text>
        </Box>

        <Box flexDirection="column" marginBottom={1}>
          <Text bold color={theme.textDim}>Session Usage</Text>
          <Box>
            <Text color={theme.text}>  Input tokens:    </Text>
            <Text color={theme.success}>{contextUsage.toLocaleString()}</Text>
          </Box>
          <Box>
            <Text color={theme.text}>  Output tokens:   </Text>
            <Text color={theme.success}>{costTokens.toLocaleString()}</Text>
          </Box>
          <Box>
            <Text color={theme.text}>  Total tokens:    </Text>
            <Text color={theme.warning}>{sessionTotal.toLocaleString()}</Text>
          </Box>
          {messagesCount > 0 ? (
            <Box>
              <Text color={theme.text}>  Avg per message: </Text>
              <Text color={theme.textDim}>{avgPerMsg.toLocaleString()} tokens</Text>
            </Box>
          ) : null}
        </Box>

        <Box flexDirection="column" marginBottom={1}>
          <Text bold color={theme.textDim}>Current Model Context</Text>
          {maxContext > 0 ? (
            <UsageBar used={contextUsage + costTokens} total={maxContext} theme={theme} />
          ) : (
            <Text color={theme.dim}>  N/A</Text>
          )}
        </Box>

        <Box flexDirection="column">
          <Text bold color={theme.textDim}>All Models ({models.length})</Text>
          <Box>
            <Text color={theme.dim}>  </Text>
            <Box width={30}>
              <Text color={theme.dim}>Model</Text>
            </Box>
            <Text color={theme.dim}> │ Context  │ Capabilities</Text>
          </Box>
          {models.map((m) => (
            <ModelQuotaRow key={m.id} model={m} currentModelId={selectedModel} theme={theme} />
          ))}
        </Box>

        <Box marginTop={1}>
          <Text color={theme.textDim}>Esc to close</Text>
        </Box>
      </Box>
    </Box>
  );
}
