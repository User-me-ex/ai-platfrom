const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const rootDir = path.join(__dirname, '..');
const appJsPath = path.join(rootDir, 'ui-dev', 'app.js');

let lines = fs.readFileSync(appJsPath, 'utf8').split('\n');

for (let i = 0; i < lines.length; i++) {
  let line = lines[i];

  if (line.includes('openStepModal') && line.includes('onclick=')) {
    if (line.includes('step.id')) {
      lines[i] = lines[i].replace(/<button[^>]+onclick=[^>]+>[^<]+<\/button>/, function() {
        return `<button class="btn btn-secondary" style="padding: 2px 8px; font-size: 11px;" onclick="openStepModal(\\'" + step.id + "\\')">Inspect Prompt</button>`;
      });
      // In JS line:
      lines[i] = '            "<button class=\\"btn btn-secondary\\" style=\\"padding: 2px 8px; font-size: 11px;\\" onclick=\\"openStepModal(\'" + step.id + "\')\\">Inspect Prompt</button>" +';
    } else if (line.includes('stepIdForModal')) {
      lines[i] = '                "<button class=\\"btn btn-secondary\\" style=\\"padding: 2px 8px; font-size: 10.5px; border-radius: 4px; display: inline-flex; align-items: center; gap: 4px; cursor: pointer;\\" onclick=\\"openStepModal(\'" + escapeHtml(stepIdForModal) + "\')\\">🔍 Inspect Prompt</button>" +';
    } else if (line.includes('class="graph-node')) {
      lines[i] = '        return "<div class=\\"graph-node " + nodeClass + "\\" onclick=\\"openStepModal(\'" + step.id + "\')\\" title=\\"Click to inspect prompt: " + escapeHtml(step.taskName) + "\\">" +';
    }
  }

  if (line.includes('toggleRoleEnabled') && line.includes('onchange=')) {
    lines[i] = '                "<input type=\\"checkbox\\" " + (role.enabled ? "checked" : "") + " onchange=\\"toggleRoleEnabled(\'" + role.id + "\', this.checked)\\" /> Enabled" +';
  }

  if (line.includes('openModelPicker') && line.includes('onclick=')) {
    if (line.includes('primary')) {
      lines[i] = '                "<button class=\\"btn btn-secondary\\" onclick=\\"openModelPicker(\'" + role.id + "\', \'primary\')\\">Fuzzy Search</button>" +';
    } else if (line.includes('fallback')) {
      lines[i] = '                "<button class=\\"btn btn-secondary\\" onclick=\\"openModelPicker(\'" + role.id + "\', \'fallback\')\\">+ Add</button>" +';
    }
  }

  if (line.includes('saveRoleCard') && line.includes('onclick=')) {
    lines[i] = '            "<button class=\\"btn\\" onclick=\\"saveRoleCard(\'" + role.id + "\')\\">Save Role Changes</button>" +';
  }

  if (line.includes('activateModel') && line.includes('onclick=')) {
    lines[i] = '          : "<button class=\\"btn btn-secondary\\" onclick=\\"activateModel(\'" + escapeHtml(m.id) + "\')\\">Set Active</button>";';
  }

  if (line.includes('selectModel') && line.includes('onclick=')) {
    lines[i] = '        return "<div class=\\"model-item\\" onclick=\\"selectModel(\'" + escapeHtml(m.id) + "\')\\">" +';
  }

  if (line.includes('fillChatPrompt') && line.includes('onclick=')) {
    if (line.includes('Build authentication system')) {
      lines[i] = '              "<button class=\\"btn btn-secondary\\" style=\\"font-size: 11.5px; padding: 5px 12px;\\" onclick=\\"fillChatPrompt(\'Build authentication system with OAuth2 and JWT tokens\')\\">🔐 Build Auth & JWT</button>" +';
    } else if (line.includes('Create database schema')) {
      lines[i] = '              "<button class=\\"btn btn-secondary\\" style=\\"font-size: 11.5px; padding: 5px 12px;\\" onclick=\\"fillChatPrompt(\'Create database schema and REST API endpoints\')\\">🗄️ DB Schema & API</button>" +';
    } else if (line.includes('Audit codebase')) {
      lines[i] = '              "<button class=\\"btn btn-secondary\\" style=\\"font-size: 11.5px; padding: 5px 12px;\\" onclick=\\"fillChatPrompt(\'Audit codebase for vulnerabilities and write unit tests\')\\">🛡️ Audit & Write Tests</button>" +';
    }
  }
}

fs.writeFileSync(appJsPath, lines.join('\n'), 'utf8');

try {
  execSync('node -c ui-dev/app.js', { cwd: rootDir, stdio: 'pipe' });
  console.log('🎉🎉🎉 SUCCESS: ui-dev/app.js HAS 0 SYNTAX ERRORS! 100% VALID!');
} catch (err) {
  console.error('❌ Still error:\n' + err.stderr.toString());
}
