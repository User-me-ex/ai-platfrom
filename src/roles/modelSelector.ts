import * as vscode from 'vscode';
import { ModelInfo, UnifiedModelCatalog } from '../models';
import { RoleDefinition } from './types';
import { searchModels } from './fuzzySearch';
import { updateRole, duplicateRole, deleteRole, saveRoles, getRoles } from './roleRegistry';

function formatModelDetail(m: ModelInfo): string {
  const parts: string[] = [];
  if (m.provider) parts.push(`Provider: ${m.provider}`);
  if (m.source) parts.push(`Source: ${m.source}`);
  if (m.caps.contextWindow) parts.push(`${Math.round(m.caps.contextWindow / 1000)}k ctx`);
  if (m.caps.maxOutput) parts.push(`${Math.round(m.caps.maxOutput / 1000)}k out`);
  const tags = ['tools', 'reasoning', 'vision', 'search'].filter((k) => (m.caps as any)[k]);
  if (tags.length) parts.push(tags.join(', '));
  return parts.join(' · ');
}

export async function pickRolePrimaryModel(
  role: RoleDefinition,
  catalog?: ModelInfo[]
): Promise<string | undefined> {
  const activeCatalog = catalog && catalog.length > 0 ? catalog : UnifiedModelCatalog.getInstance().getModels();
  const qp = vscode.window.createQuickPick<vscode.QuickPickItem & { modelId: string }>();
  qp.title = `Select Primary Model for ${role.name}`;
  qp.placeholder = 'Type to fuzzy search 9 Router catalog (e.g. ag/, claude, sonnet, deepseek, gpt-4o, reasoning)…';
  qp.matchOnDescription = false;
  qp.matchOnDetail = false;

  const updateItems = (filter: string) => {
    const matched = searchModels(filter, activeCatalog);
    qp.items = matched.map((m) => {
      const isCurrent = m.id === role.primaryModel;
      return {
        label: `${isCurrent ? '$(check) ' : '$(sparkle) '}${m.id}`,
        description: isCurrent ? 'CURRENT PRIMARY' : m.provider,
        detail: formatModelDetail(m),
        alwaysShow: isCurrent,
        modelId: m.id
      };
    });
  };

  updateItems('');

  return new Promise((resolve) => {
    qp.onDidChangeValue((val) => {
      updateItems(val);
    });

    qp.onDidChangeSelection(async (sel) => {
      const chosen = sel[0]?.modelId;
      qp.dispose();
      resolve(chosen);
    });

    qp.onDidHide(() => {
      qp.dispose();
      resolve(undefined);
    });

    qp.show();
  });
}

export async function pickModelFromCatalog(
  title: string,
  catalog?: ModelInfo[],
  excludeIds: string[] = []
): Promise<string | undefined> {
  const activeCatalog = catalog && catalog.length > 0 ? catalog : UnifiedModelCatalog.getInstance().getModels();
  const qp = vscode.window.createQuickPick<vscode.QuickPickItem & { modelId: string }>();
  qp.title = title;
  qp.placeholder = 'Fuzzy search 9 Router models by name, ID, provider, or capability…';
  qp.matchOnDescription = false;
  qp.matchOnDetail = false;

  const available = activeCatalog.filter((m) => !excludeIds.includes(m.id));

  const updateItems = (filter: string) => {
    const matched = searchModels(filter, available);
    qp.items = matched.map((m) => ({
      label: `$(sparkle) ${m.id}`,
      description: m.provider,
      detail: formatModelDetail(m),
      modelId: m.id
    }));
  };

  updateItems('');

  return new Promise((resolve) => {
    qp.onDidChangeValue((val) => {
      updateItems(val);
    });

    qp.onDidChangeSelection((sel) => {
      const chosen = sel[0]?.modelId;
      qp.dispose();
      resolve(chosen);
    });

    qp.onDidHide(() => {
      qp.dispose();
      resolve(undefined);
    });

    qp.show();
  });
}

export async function manageRoleFallbackModels(
  role: RoleDefinition,
  catalog?: ModelInfo[]
): Promise<string[] | undefined> {
  const activeCatalog = catalog && catalog.length > 0 ? catalog : UnifiedModelCatalog.getInstance().getModels();
  let fallbacks = [...(role.fallbackModels || [])];

  for (;;) {
    const items: (vscode.QuickPickItem & { action: string; index?: number })[] = [];

    if (fallbacks.length > 0) {
      fallbacks.forEach((mId, idx) => {
        items.push({
          label: `$(list-ordered) #${idx + 1}: ${mId}`,
          description: `Fallback Priority #${idx + 1}`,
          detail: 'Click to move up/down or remove this fallback model',
          action: 'manageModel',
          index: idx
        });
      });
    } else {
      items.push({
        label: '$(info) No fallback models configured',
        description: 'Single model mode (no fallback on persistent error)',
        action: 'none'
      });
    }

    items.push(
      {
        label: '$(add) Add Fallback Model',
        description: 'Fuzzy search and append another model to the fallback chain',
        action: 'add'
      }
    );

    if (fallbacks.length > 0) {
      items.push({
        label: '$(trash) Clear All Fallback Models',
        description: 'Remove all fallback models for this role',
        action: 'clearAll'
      });
    }

    items.push({
      label: '$(check) Done',
      description: 'Save and return to role configuration',
      action: 'done'
    });

    const choice = await vscode.window.showQuickPick(items, {
      title: `Configure Fallback Chain for ${role.name} (${fallbacks.length} fallback(s))`,
      placeHolder: 'Manage fallback model ordering and priority'
    });

    if (!choice || choice.action === 'done') break;

    if (choice.action === 'add') {
      const chosen = await pickModelFromCatalog(
        `Add Fallback Model to ${role.name}`,
        activeCatalog,
        [role.primaryModel, ...fallbacks]
      );
      if (chosen) {
        fallbacks.push(chosen);
      }
    } else if (choice.action === 'clearAll') {
      const confirm = await vscode.window.showWarningMessage(
        `Clear all fallback models for ${role.name}?`,
        { modal: true },
        'Clear all'
      );
      if (confirm === 'Clear all') fallbacks = [];
    } else if (choice.action === 'manageModel' && typeof choice.index === 'number') {
      const idx = choice.index;
      const mId = fallbacks[idx];
      const subItems: (vscode.QuickPickItem & { action: string })[] = [];

      if (idx > 0) {
        subItems.push({ label: '$(arrow-up) Move Up (Higher Priority)', action: 'up' });
      }
      if (idx < fallbacks.length - 1) {
        subItems.push({ label: '$(arrow-down) Move Down (Lower Priority)', action: 'down' });
      }
      subItems.push({ label: '$(trash) Remove From Fallback Chain', action: 'remove' });

      const subChoice = await vscode.window.showQuickPick(subItems, {
        title: `Manage Fallback #${idx + 1}: ${mId}`
      });

      if (subChoice?.action === 'up' && idx > 0) {
        const tmp = fallbacks[idx - 1];
        fallbacks[idx - 1] = fallbacks[idx];
        fallbacks[idx] = tmp;
      } else if (subChoice?.action === 'down' && idx < fallbacks.length - 1) {
        const tmp = fallbacks[idx + 1];
        fallbacks[idx + 1] = fallbacks[idx];
        fallbacks[idx] = tmp;
      } else if (subChoice?.action === 'remove') {
        fallbacks.splice(idx, 1);
      }
    }
  }

  return fallbacks;
}

export async function configureRoleInteractive(
  role: RoleDefinition,
  context: vscode.ExtensionContext,
  catalog?: ModelInfo[]
): Promise<void> {
  const activeCatalog = catalog && catalog.length > 0 ? catalog : UnifiedModelCatalog.getInstance().getModels();
  for (;;) {
    const fallbackDesc = role.fallbackModels.length > 0
      ? role.fallbackModels.join(' -> ')
      : 'None (no fallback)';

    const items: (vscode.QuickPickItem & { action: string })[] = [
      {
        label: `$(sparkle) Primary Model: ${role.primaryModel}`,
        description: 'Fuzzy search 9 Router catalog to change primary model',
        action: 'primaryModel'
      },
      {
        label: `$(list-ordered) Fallback Models (${role.fallbackModels.length})`,
        description: fallbackDesc,
        action: 'fallbackModels'
      },
      {
        label: `$(comment) Permanent Role System Prompt`,
        description: `${role.systemPrompt.slice(0, 60)}…`,
        action: 'systemPrompt'
      },
      {
        label: role.enabled ? `$(check) Role Status: Enabled` : `$(circle-slash) Role Status: Disabled`,
        description: 'Toggle whether Main AI can invoke this role in workflows',
        action: 'toggleEnabled'
      },
      {
        label: `$(pencil) Role Name & Purpose`,
        description: `${role.name}: ${role.purpose}`,
        action: 'editMeta'
      },
      {
        label: `$(copy) Duplicate Role`,
        description: 'Create a copy of this role configuration',
        action: 'duplicate'
      }
    ];

    if (role.isCustom) {
      items.push({
        label: `$(trash) Delete Role`,
        description: 'Remove this custom role definition',
        action: 'delete'
      });
    }

    const sel = await vscode.window.showQuickPick(items, {
      title: `Role Configuration — ${role.name} [${role.id}]`,
      placeHolder: 'Select a setting to configure'
    });

    if (!sel) break;

    if (sel.action === 'primaryModel') {
      const chosen = await pickRolePrimaryModel(role, activeCatalog);
      if (chosen) {
        role.primaryModel = chosen;
        await updateRole(context, role);
        vscode.window.showInformationMessage(`Updated primary model for ${role.name} to "${chosen}".`);
      }
    } else if (sel.action === 'fallbackModels') {
      const updated = await manageRoleFallbackModels(role, activeCatalog);
      if (updated !== undefined) {
        role.fallbackModels = updated;
        await updateRole(context, role);
        vscode.window.showInformationMessage(`Updated fallback chain for ${role.name} (${updated.length} model(s)).`);
      }
    } else if (sel.action === 'systemPrompt') {
      const input = await vscode.window.showInputBox({
        title: `Permanent System Prompt for ${role.name}`,
        prompt: 'Define the permanent persona, instructions, and domain rules for this role:',
        value: role.systemPrompt,
        ignoreFocusOut: true
      });
      if (input !== undefined && input.trim()) {
        role.systemPrompt = input.trim();
        await updateRole(context, role);
        vscode.window.showInformationMessage(`Updated system prompt for ${role.name}.`);
      }
    } else if (sel.action === 'toggleEnabled') {
      role.enabled = !role.enabled;
      await updateRole(context, role);
      vscode.window.showInformationMessage(`Role ${role.name} is now ${role.enabled ? 'Enabled' : 'Disabled'}.`);
    } else if (sel.action === 'editMeta') {
      const newName = await vscode.window.showInputBox({
        title: 'Role Name',
        value: role.name,
        ignoreFocusOut: true
      });
      if (newName && newName.trim()) {
        role.name = newName.trim();
        const newPurpose = await vscode.window.showInputBox({
          title: 'Role Purpose',
          value: role.purpose,
          ignoreFocusOut: true
        });
        if (newPurpose && newPurpose.trim()) {
          role.purpose = newPurpose.trim();
        }
        await updateRole(context, role);
        vscode.window.showInformationMessage(`Updated metadata for ${role.name}.`);
      }
    } else if (sel.action === 'duplicate') {
      const copy = await duplicateRole(context, role.id);
      vscode.window.showInformationMessage(`Duplicated role as "${copy.name}" [${copy.id}].`);
      break;
    } else if (sel.action === 'delete') {
      const confirm = await vscode.window.showWarningMessage(
        `Are you sure you want to delete role '${role.name}'?`,
        { modal: true },
        'Delete'
      );
      if (confirm === 'Delete') {
        await deleteRole(context, role.id);
        vscode.window.showInformationMessage(`Deleted role '${role.name}'.`);
        break;
      }
    }
  }
}
