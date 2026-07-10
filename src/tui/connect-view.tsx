import { useState } from "react";
import { Box, Text, useInput } from "ink";
import type { Theme } from "./types";

interface Connection {
  name: string;
  baseUrl: string;
  apiKey?: string;
}

interface ConnectViewProps {
  theme: Theme;
  connections: Connection[];
  activeName: string | null;
  onAdd: (conn: Connection) => void;
  onRemove: (name: string) => void;
  onSwitch: (name: string) => Promise<boolean>;
  onClose: () => void;
}

function ConnRow({ conn, isActive, isHovered, theme }: { conn: Connection; isActive: boolean; isHovered: boolean; theme: Theme }) {
  return (
    <Box>
      <Text color={isHovered ? theme.primary : theme.textDim}>
        {isHovered ? "▸" : " "}
      </Text>
      <Text color={isActive ? theme.success : isHovered ? theme.text : theme.textDim}>
        {" "}{isActive ? "●" : "○"} {conn.name}
      </Text>
      <Text color={theme.textDim}>  {conn.baseUrl}</Text>
      {conn.apiKey ? <Text color={theme.dim}> [key]</Text> : null}
      {isActive ? <Text color={theme.success}> ✓</Text> : null}
    </Box>
  );
}

type ConnView = "list" | "add" | "remove" | "switch";

export function ConnectView({ theme, connections, activeName, onAdd, onRemove, onSwitch, onClose }: ConnectViewProps) {
  const [view, setView] = useState<ConnView>("list");
  const [cursor, setCursor] = useState(0);
  const [statusMsg, setStatusMsg] = useState<string | null>(null);

  const [newName, setNewName] = useState("");
  const [newUrl, setNewUrl] = useState("");
  const [newKey, setNewKey] = useState("");

  const handleDone = () => {
    setView("list");
    setCursor(0);
    setNewName("");
    setNewUrl("");
    setNewKey("");
  };

  useInput((input, key) => {
    if (key.escape) {
      if (view === "list") { onClose(); return; }
      handleDone();
      return;
    }

    if (view === "list") {
      if (key.return) {
        const sel = connections[cursor];
        if (!sel) return;
        setView("switch");
        setStatusMsg(null);
        onSwitch(sel.name).then((ok) => {
          setStatusMsg(ok ? `✓ Switched to "${sel.name}"` : `✗ Switch failed`);
          setTimeout(() => { setStatusMsg(null); handleDone(); }, 1200);
        });
        return;
      }

      if (key.upArrow) { setCursor((c) => Math.max(0, c - 1)); return; }
      if (key.downArrow) { setCursor((c) => Math.min(connections.length - 1, c + 1)); return; }

      if (input === "a" && !key.ctrl) { setView("add"); return; }
      if (input === "d" && !key.ctrl) {
        const sel = connections[cursor];
        if (sel) {
          onRemove(sel.name);
          setStatusMsg(`Removed "${sel.name}"`);
          setTimeout(() => setStatusMsg(null), 1200);
        }
        return;
      }
    }

    if (view === "add") {
      if (key.return) {
        if (!newName || !newUrl) return;
        onAdd({ name: newName, baseUrl: newUrl, apiKey: newKey || undefined });
        setStatusMsg(`✓ Added "${newName}"`);
        setTimeout(() => { setStatusMsg(null); handleDone(); }, 1200);
        return;
      }
      if (key.backspace || key.delete) {
        if (newName.length > 0 && cursor === 0) { setNewName((s) => s.slice(0, -1)); return; }
        if (newUrl.length > 0 && cursor === 1) { setNewUrl((s) => s.slice(0, -1)); return; }
        if (newKey.length > 0 && cursor === 2) { setNewKey((s) => s.slice(0, -1)); return; }
        return;
      }
      if (key.tab) { setCursor((c) => (c + 1) % 3); return; }
      if (input.length === 1 && !key.ctrl && !key.meta) {
        if (cursor === 0) { setNewName((s) => s + input); return; }
        if (cursor === 1) { setNewUrl((s) => s + input); return; }
        if (cursor === 2) { setNewKey((s) => s + input); return; }
      }
    }
  });

  const listView = (
    <Box flexDirection="column" height={14}>
      {connections.length === 0 ? (
        <Box paddingLeft={1}>
          <Text color={theme.textDim}>No connections configured.</Text>
        </Box>
      ) : (
        connections.map((conn, i) => (
          <Box key={conn.name} paddingX={1} marginBottom={1}>
            <ConnRow conn={conn} isActive={conn.name === activeName} isHovered={i === cursor} theme={theme} />
          </Box>
        ))
      )}
    </Box>
  );

  const addView = (
    <Box flexDirection="column" paddingX={1}>
      <Box marginBottom={1}>
        <Text bold color={theme.primary}>Add Connection</Text>
      </Box>
      <Box>
        <Text color={cursor === 0 ? theme.primary : theme.textDim}>
          {cursor === 0 ? "▸" : " "}
        </Text>
        <Text color={theme.text}> Name: </Text>
        <Text color={newName ? theme.text : theme.placeholder}>
          {newName || "my-server"}{cursor === 0 ? "▎" : ""}
        </Text>
      </Box>
      <Box>
        <Text color={cursor === 1 ? theme.primary : theme.textDim}>
          {cursor === 1 ? "▸" : " "}
        </Text>
        <Text color={theme.text}> URL:  </Text>
        <Text color={newUrl ? theme.text : theme.placeholder}>
          {newUrl || "http://localhost:20128/v1"}{cursor === 1 ? "▎" : ""}
        </Text>
      </Box>
      <Box>
        <Text color={cursor === 2 ? theme.primary : theme.textDim}>
          {cursor === 2 ? "▸" : " "}
        </Text>
        <Text color={theme.text}> Key:  </Text>
        <Text color={newKey ? theme.text : theme.placeholder}>
          {newKey || "(optional)"}{cursor === 2 ? "▎" : ""}
        </Text>
      </Box>
      <Box marginTop={1}>
        <Text color={theme.textDim}>Tab to switch field · Enter save · Esc cancel</Text>
      </Box>
    </Box>
  );

  const selectedConn = connections[cursor];

  return (
    <Box flexDirection="column" alignItems="center" justifyContent="center" width="100%">
      <Box flexDirection="column" borderStyle="round" borderColor={theme.borderActive} padding={1} width={66}>
        <Box marginBottom={1}>
          <Text bold color={theme.primary}>
            {view === "add" ? "Add Connection" : "Connections"}
          </Text>
          {view === "list" ? (
            <Text color={theme.textDim}>  ({connections.length})</Text>
          ) : null}
        </Box>

        {statusMsg ? (
          <Box paddingX={1} marginBottom={1}>
            <Text color={theme.success}>{statusMsg}</Text>
          </Box>
        ) : null}

        {view === "add" ? addView : listView}

        {view === "list" && connections.length > 0 ? (
          <Box paddingX={1} marginTop={1}>
            <Text color={theme.dim}>
              {selectedConn ? `Active: ${selectedConn.name}` : ""}
              {"  · "}
              {selectedConn?.apiKey ? "key set" : "no key"}
            </Text>
          </Box>
        ) : null}

        <Box marginTop={1}>
          {view === "list" ? (
            <Text color={theme.textDim}>
              ↑↓ select · Enter switch · A add · D remove
              {"  ·  "}Esc close
            </Text>
          ) : null}
        </Box>
      </Box>
    </Box>
  );
}
