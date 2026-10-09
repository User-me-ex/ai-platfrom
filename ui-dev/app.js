let vscode;
    try {
      vscode = acquireVsCodeApi();
    } catch (e) {
      vscode = window._vscodeApi || { postMessage: function() {} };
    }
    window._vscodeApi = vscode;

    let currentWorkflow = null;
    let currentRoles = [];
    let currentSelectedModel = '${selectedModel}';
    let currentSessionOpts = null;
    let currentVoiceOpts = null;
    let currentApiKeys = [];
    let isVoiceCurrentlyActive = false;
    let isVoiceCurrentlyTalking = false;
    let isVoiceCurrentlyMuted = false;
    let currentPickerContext = null;
    let hubFilterText = '';
    let hubSearchQuery = '';
    let currentChatMode = 'pipeline';
    let chatMessagesList = [];
    let speechRecognizer = null;
    let isDictating = false;
    let hasSwitchedInitialTab = false;
    let isPipelineGraphCollapsed = false;
    let isChatHeaderCollapsed = false;

    function togglePipelineGraph() {
      isPipelineGraphCollapsed = !isPipelineGraphCollapsed;
      const body = document.getElementById('chatSerialGraphBody');
      const btn  = document.getElementById('graphCollapseBtn');
      if (body) body.classList.toggle('graph-collapsed', isPipelineGraphCollapsed);
      if (btn)  btn.classList.toggle('collapsed', isPipelineGraphCollapsed);
      if (btn)  btn.title = isPipelineGraphCollapsed ? 'Expand pipeline graph' : 'Collapse pipeline graph';
    }

    function toggleChatHeader() {
      isChatHeaderCollapsed = !isChatHeaderCollapsed;
      const body = document.getElementById('chatHeaderBody');
      const btn  = document.getElementById('chatHeaderToggleBtn');
      if (body) body.classList.toggle('hdr-collapsed', isChatHeaderCollapsed);
      if (btn)  btn.classList.toggle('hdr-collapsed', isChatHeaderCollapsed);
      if (btn)  btn.title = isChatHeaderCollapsed ? 'Expand header' : 'Collapse header';
    }

    /** Keep compact bar in sync with current mode / status / model */
    function syncCompactBar(mode, statusText, goalText, modelName) {
      const pill = document.getElementById('compactModePill');
      const statusPill = document.getElementById('compactStatusPill');
      const goalSnip = document.getElementById('compactGoalSnippet');
      const mdName = document.getElementById('compactModelName');
      if (pill) {
        if (mode === 'direct') {
          pill.textContent = '\uD83D\uDCAC Chat with Model';
          pill.style.color = '#4ade80';
          pill.style.background = 'rgba(74,222,128,0.1)';
          pill.style.borderColor = 'rgba(74,222,128,0.25)';
        } else {
          pill.textContent = '\u26A1 Autonomous Pipeline';
          pill.style.color = '#38bdf8';
          pill.style.background = 'rgba(56,189,248,0.1)';
          pill.style.borderColor = 'rgba(56,189,248,0.25)';
        }
      }
      if (statusPill && statusText) {
        statusPill.textContent = statusText;
        statusPill.className = 'badge badge-' + statusText;
      }
      if (goalSnip && goalText !== undefined) goalSnip.textContent = goalText;
      if (mdName && modelName) mdName.innerHTML = '9 Router: <strong style="color:#f8fafc;">' + modelName + '</strong>';
    }

    window.onerror = function(msg, url, line, col, error) {
      console.error('[Webview Error]', msg, line, col, error);
      try {
        vscode.postMessage({ command: 'clientError', error: String(msg) + ' (' + line + ':' + col + ')' });
      } catch (e) {}
    };
    window.addEventListener('unhandledrejection', function(event) {
      console.error('[Webview Unhandled Rejection]', event.reason);
    });

    function applyState(msg) {
      if (!msg) return;
      if (msg.workflow !== undefined) currentWorkflow = msg.workflow;
      if (msg.roles) currentRoles = msg.roles;
      if (msg.selectedModel) currentSelectedModel = msg.selectedModel;
      if (msg.sessionOpts) currentSessionOpts = msg.sessionOpts;
      if (msg.voiceOpts) currentVoiceOpts = msg.voiceOpts;
      if (msg.apiKeys) currentApiKeys = msg.apiKeys;
      if (msg.voiceActive !== undefined) isVoiceCurrentlyActive = !!msg.voiceActive;
      if (msg.voiceTalking !== undefined) isVoiceCurrentlyTalking = !!msg.voiceTalking;
      if (msg.voiceMuted !== undefined) isVoiceCurrentlyMuted = !!msg.voiceMuted;

      if (msg.activeSession) {
        currentActiveSession = msg.activeSession;
        const titleEl = document.getElementById('chatActiveSessionTitle');
        if (titleEl) titleEl.innerText = msg.activeSession.title || 'Active Session';
      }
      if (msg.sessionList) {
        populateSessionSelector(msg.sessionList, msg.activeSession ? msg.activeSession.id : undefined);
      }

      updateHeaderStatus();
      renderWorkflow();
      renderRoles();
      renderVoiceTab(msg.liveModels);
      renderSessionTab();
      renderChatTab(msg.workspacePath, msg.activeDoc);
      renderChatSerialGraph(currentWorkflow);

      if (msg.chatMessages && msg.chatMessages.length > 0 && chatMessagesList.length === 0) {
        msg.chatMessages.forEach((m) => appendLiveChatMessage(m));
      }

      if (msg.catalogSize) {
        const cEl = document.getElementById('tabModelsCount');
        if (cEl) cEl.innerText = msg.catalogSize.toLocaleString();
        const mStatus = document.getElementById('modelCountStatus');
        if (mStatus && mStatus.innerText && mStatus.innerText.includes('Loading')) {
          mStatus.innerText = 'Showing all ' + (msg.catalogSize).toLocaleString() + ' models from 9 Router';
        }
      }

      if (msg.topModels) {
        populateChatQuickModelDropdown(msg.topModels);
      }

      if (msg.initialTab === 'chat' && !hasSwitchedInitialTab) {
        hasSwitchedInitialTab = true;
        openChatWithSelectedModel();
      }
    }

    function populateSessionSelector(sessions, activeId) {
      const sel = document.getElementById('chatSessionSelector');
      if (!sel) return;
      sel.innerHTML = '<option value="">History ▾</option>' +
        sessions.map(function(s) {
          const isAct = s.id === activeId ? ' (Active)' : '';
          const preview = s.title.length > 22 ? s.title.slice(0, 22) + '…' : s.title;
          return '<option value="' + escapeHtml(s.id) + '"' + (s.id === activeId ? ' selected' : '') + '>' +
            escapeHtml(preview + isAct) +
          '</option>';
        }).join('');
    }

    window.addEventListener('message', (event) => {
      const msg = event.data;
      if (msg.type === 'updateState') {
        applyState(msg);
      } else if (msg.type === 'chatMessage') {
        appendLiveChatMessage(msg.message);
      } else if (msg.type === 'chatDelta') {
        appendLiveChatDelta(msg.id, msg.text);
      } else if (msg.type === 'chatLog') {
        appendLiveChatLog(msg.logLine, msg.roleName);
      } else if (msg.type === 'chatWorkflowUpdated') {
        currentWorkflow = msg.workflow;
        renderChatSerialGraph(currentWorkflow);
        syncRoleCardsWithWorkflow(currentWorkflow);
        renderWorkflow();
      } else if (msg.type === 'chatStepProgress') {
        updateStepProgressInChat(msg.stepId, msg.state, msg.pct, msg.note);
      } else if (msg.type === 'chatCleared') {
        clearChatUI();
      } else if (msg.type === 'chatReloaded') {
        chatMessagesList = [];
        const feed = document.getElementById('chatFeed');
        if (feed) feed.innerHTML = '';
        if (msg.chatMessages && msg.chatMessages.length > 0) {
          msg.chatMessages.forEach((m) => appendLiveChatMessage(m));
        } else {
          clearChatUI();
        }
      } else if (msg.type === 'switchTab') {
        switchTab(msg.tab);
      } else if (msg.type === 'audioSaved') {
        const feed = document.getElementById('chatFeed');
        if (feed) {
          const pill = document.createElement('div');
          pill.className = 'chat-bubble-row ai-row';
          pill.innerHTML =
            '<div style="background: rgba(16,185,129,0.12); border: 1px solid rgba(16,185,129,0.3); border-radius: 8px; padding: 6px 12px; font-size: 11.5px; display: inline-flex; align-items: center; gap: 8px; margin: 4px 0;">' +
              '<span>🎵 Saved Audio: <strong>' + escapeHtml(msg.fileName) + '</strong> (' + escapeHtml(msg.format.toUpperCase()) + ')</span>' +
              '<button class="btn btn-secondary" style="padding: 2px 7px; font-size: 10px;" onclick="copyLatestAudioPath()">📋 Copy Path</button>' +
              '<button class="btn btn-secondary" style="padding: 2px 7px; font-size: 10px;" onclick="openRecordingsFolder()">📂 Open Folder</button>' +
            '</div>';
          feed.appendChild(pill);
          feed.scrollTop = feed.scrollHeight;
        }
      } else if (msg.type === 'voiceTurn') {
        handleVoiceTurnInChat(msg.text, msg.turnComplete, msg.from);
      } else if (msg.type === 'openChatWithSelectedModel') {
        openChatWithSelectedModel();
      } else if (msg.type === 'fuzzySearchResults') {
        if (currentPickerContext?.isHub) {
          renderHubResults(msg);
        } else {
          renderFuzzyResults(msg);
        }
      }
    });

    function requestRefresh() {
      vscode.postMessage({ command: 'refresh' });
    }

    function startTaskPrompt() {
      const modal = document.getElementById('newTaskModal');
      if (modal) {
        modal.classList.add('show');
        const input = document.getElementById('newTaskGoalInput');
        if (input) {
          input.value = '';
          input.focus();
        }
      } else {
        vscode.postMessage({ command: 'startNewTask' });
      }
    }

    function closeNewTaskModal() {
      const modal = document.getElementById('newTaskModal');
      if (modal) modal.classList.remove('show');
    }

    function submitInlineNewTask() {
      const input = document.getElementById('newTaskGoalInput');
      if (!input) return;
      const text = input.value.trim();
      if (!text) return;
      closeNewTaskModal();
      vscode.postMessage({
        command: 'chatSubmit',
        text: text,
        mode: 'pipeline',
        selectedModel: currentSelectedModel
      });
      switchTab('workflow');
    }

    function switchTab(tab) {
      const tabs = ['workflow', 'roles', 'models', 'voice', 'session', 'chat'];
      tabs.forEach(t => {
        const el = document.getElementById(t + 'Tab');
        const btn = document.getElementById('tab' + capitalize(t) + 'Btn');
        if (el) el.style.display = t === tab ? 'block' : 'none';
        if (btn) btn.classList.toggle('active', t === tab);
      });
      const headerChat = document.getElementById('headerChatBtn');
      if (headerChat) {
        headerChat.style.boxShadow = tab === 'chat' ? '0 0 14px rgba(56,189,248,0.6)' : '0 2px 10px rgba(14,165,233,0.35)';
      }
      if (tab === 'models') {
        onHubSearch();
      } else if (tab === 'chat') {
        setTimeout(() => {
          const input = document.getElementById('chatMessageInput');
          if (input) {
            input.focus();
            const feed = document.getElementById('chatFeed'); if (feed) feed.scrollTop = feed.scrollHeight;
          }
        }, 50);
      }
    }

    function openChatInterface(mode) {
      switchTab('chat');
      setChatMode(mode || 'pipeline');
      setTimeout(() => {
        const input = document.getElementById('chatMessageInput');
        if (input) {
          input.focus();
          const feed = document.getElementById('chatFeed'); if (feed) feed.scrollTop = feed.scrollHeight;
        }
      }, 50);
    }

    function openChatWithSelectedModel() {
      openChatInterface('direct');
    }

    function onChatQuickModelChange(val) {
      if (val === '__browse_all__') {
        openChatModelPicker();
        return;
      }
      selectModel(val);
    }

    function populateChatQuickModelDropdown(topModels) {
      const qSelect = document.getElementById('chatQuickModelDropdown');
      if (!qSelect) return;
      const models = Array.isArray(topModels) && topModels.length > 0
        ? topModels
        : ['ag/gemini-3.8-flash-high', 'kr/qwen3-coder-next', 'ag/claude-opus-4-6-thinking', 'forge api/deepseek-v4-flash', 'cc/claude-3-7-sonnet', 'openai/gpt-4o'];

      const allList = [];
      if (currentSelectedModel && !models.includes(currentSelectedModel)) {
        allList.push(currentSelectedModel);
      }
      models.forEach(function(m) {
        if (!allList.includes(m)) allList.push(m);
      });

      let html = allList.map(function(m) {
        const isSel = m === currentSelectedModel ? ' selected' : '';
        return '<option value="' + escapeHtml(m) + '"' + isSel + '>' + escapeHtml(m) + '</option>';
      }).join('');
      html += '<option value="__browse_all__">🔍 Browse all 2,150 9 Router models…</option>';
      qSelect.innerHTML = html;
    }

    function capitalize(s) {
      return s.charAt(0).toUpperCase() + s.slice(1);
    }

    function updateHeaderStatus() {
      const mText = document.getElementById('headerModelText');
      if (mText) mText.innerText = 'Model: ' + currentSelectedModel;

      const chatActiveBadge = document.getElementById('chatActiveModelBadge');
      if (chatActiveBadge) chatActiveBadge.innerText = currentSelectedModel;

      const bannerModel = document.getElementById('chatBannerModelName');
      if (bannerModel) bannerModel.innerText = currentSelectedModel;

      const barModel = document.getElementById('inputBarModelName');
      if (barModel) barModel.innerText = currentSelectedModel;

      const qSelect = document.getElementById('chatQuickModelDropdown');
      if (qSelect) {
        let matched = false;
        for (let i = 0; i < qSelect.options.length; i++) {
          if (qSelect.options[i].value === currentSelectedModel) {
            qSelect.selectedIndex = i;
            matched = true;
            break;
          }
        }
        if (!matched && currentSelectedModel) {
          const opt = document.createElement('option');
          opt.value = currentSelectedModel;
          opt.innerText = currentSelectedModel;
          qSelect.insertBefore(opt, qSelect.firstChild);
          qSelect.selectedIndex = 0;
        }
      }

      const vDot = document.getElementById('headerVoiceDot');
      const vText = document.getElementById('headerVoiceText');
      if (vDot && vText) {
        if (isVoiceCurrentlyActive) {
          vDot.className = 'dot-voice-on';
          vText.innerText = isVoiceCurrentlyMuted ? 'Voice: Muted' : 'Voice: Live';
        } else {
          vDot.className = 'dot-live';
          vDot.style.background = '#94a3b8';
          vDot.style.boxShadow = 'none';
          vText.innerText = 'Voice: Ready';
        }
      }

      const chatVoiceDot = document.getElementById('voiceModeBtnDot');
      const chatVoiceText = document.getElementById('voiceModeBtnText');
      if (chatVoiceDot && chatVoiceText) {
        if (isVoiceCurrentlyActive) {
          chatVoiceDot.className = 'dot-voice-on';
          chatVoiceText.innerText = isVoiceCurrentlyMuted ? 'Voice: Muted' : 'Voice: Live';
        } else {
          chatVoiceDot.className = 'dot-live';
          chatVoiceDot.style.background = '#94a3b8';
          chatVoiceDot.style.boxShadow = 'none';
          chatVoiceText.innerText = 'Voice Mode: Ready';
        }
      }

      const qaSelDesc = document.getElementById('qaSelectedModelDesc');
      if (qaSelDesc) qaSelDesc.innerText = 'Text mode: Chat directly with ' + currentSelectedModel;

      const qaLiveDesc = document.getElementById('qaLiveModelDesc');
      if (qaLiveDesc && currentVoiceOpts?.liveModel) qaLiveDesc.innerText = currentVoiceOpts.liveModel;

      const qaApiDesc = document.getElementById('qaApiKeysDesc');
      if (qaApiDesc) qaApiDesc.innerText = currentApiKeys.length ? (currentApiKeys.length + ' key(s) configured · fallback active') : 'None configured — click to add';

      const qaVTitle = document.getElementById('qaVoiceTitle');
      if (qaVTitle) qaVTitle.innerText = isVoiceCurrentlyActive ? 'Voice mode (Active)' : 'Voice mode';
    }

    function focusLiveModelSelect() {
      switchTab('voice');
      setTimeout(() => {
        const el = document.getElementById('liveModelSelect');
        if (el) {
          el.focus();
          el.scrollIntoView({ behavior: 'smooth', block: 'center' });
        }
      }, 50);
    }

    function focusApiKeysSection() {
      switchTab('voice');
      setTimeout(() => {
        const el = document.getElementById('newApiKeyInput');
        if (el) {
          el.focus();
          el.scrollIntoView({ behavior: 'smooth', block: 'center' });
        }
      }, 50);
    }

    function toggleQuickHub() {
      const grid = document.getElementById('qaGrid');
      const btn = document.getElementById('qaToggleBtn');
      if (!grid || !btn) return;
      const isHidden = grid.style.display === 'none' || window.getComputedStyle(grid).display === 'none';
      if (isHidden) {
        grid.style.display = 'grid';
        btn.innerText = 'Hide Hub';
      } else {
        grid.style.display = 'none';
        btn.innerText = 'Show Hub';
      }
    }

    /* ---------------- TAB 1: WORKFLOW ---------------- */
    function renderWorkflow() {
      const container = document.getElementById('pipelineContainer');
      const goalEl = document.getElementById('goalText');
      const statusBadge = document.getElementById('mainStatusBadge');
      const progressText = document.getElementById('stepProgressText');
      const controlsEl = document.getElementById('workflowControls');
      const verEl = document.getElementById('verificationBanner');

      if (!currentWorkflow) {
        goalEl.innerText = '(No active workflow)';
        statusBadge.className = 'badge badge-Queued';
        statusBadge.innerText = 'Idle';
        progressText.innerText = 'Start an autonomous serial task, or chat directly with ' + currentSelectedModel + ' in normal text mode.';
        controlsEl.innerHTML = '<button class="btn btn-primary" onclick="openChatWithSelectedModel()" style="background: linear-gradient(135deg, #0284c7, #38bdf8); color: white; font-weight: 600; padding: 6px 14px;">💬 Chat with ' + escapeHtml(currentSelectedModel) + '</button>' +
          '<button class="btn btn-gradient" onclick="startTaskPrompt()">+ Start New Task</button>';
        verEl.style.display = 'none';
        container.innerHTML = '<div style="text-align: center; color: #64748b; padding: 36px 0;">' +
          '<div style="font-size: 28px; margin-bottom: 8px;">💬 ⚡</div>' +
          '<h3 style="font-size: 14px; font-weight: 600; color: #cbd5e1; margin-bottom: 6px;">No Active Serial Pipeline</h3>' +
          '<p style="font-size: 12px; color: var(--fg-muted); margin-bottom: 14px;">You can chat directly with your selected 9 Router model or launch an autonomous serial workflow.</p>' +
          '<button class="btn btn-primary" onclick="openChatWithSelectedModel()" style="font-size: 12.5px; padding: 7px 16px; margin-right: 8px; background: linear-gradient(135deg, #0284c7, #38bdf8); color: white; font-weight: 600;">💬 Chat with ' + escapeHtml(currentSelectedModel) + ' (Text Mode)</button>' +
          '<button class="btn btn-secondary" onclick="startTaskPrompt()" style="font-size: 12.5px; padding: 7px 16px;">🚀 Launch Serial Workflow</button>' +
        '</div>';
        return;
      }

      goalEl.innerText = currentWorkflow.userGoal || 'Untitled Goal';
      statusBadge.className = 'badge badge-' + currentWorkflow.status;
      statusBadge.innerText = currentWorkflow.status;

      const totalSteps = currentWorkflow.steps.length;
      const completedSteps = currentWorkflow.steps.filter(s => s.status === 'Completed').length;
      progressText.innerText = 'Step ' + (currentWorkflow.activeStepIndex + 1) + ' of ' + totalSteps + ' (' + completedSteps + ' completed)';

      let ctrlHtml = '';
      if (currentWorkflow.status === 'Running') {
        ctrlHtml += '<button class="btn btn-secondary" onclick="pauseWorkflow()">⏸ Pause</button>';
        ctrlHtml += '<button class="btn btn-danger" onclick="cancelWorkflow()">✕ Cancel</button>';
      } else if (currentWorkflow.status === 'Paused') {
        ctrlHtml += '<button class="btn btn-success" onclick="resumeWorkflow()">▶ Resume</button>';
        ctrlHtml += '<button class="btn btn-danger" onclick="cancelWorkflow()">✕ Cancel</button>';
      }
      controlsEl.innerHTML = ctrlHtml;

      if (currentWorkflow.verification) {
        verEl.style.display = 'block';
        document.getElementById('verificationSummaryText').innerText = currentWorkflow.verification.summary;
      } else {
        verEl.style.display = 'none';
      }

      container.innerHTML = currentWorkflow.steps.map(function(step, idx) {
        const isActive = idx === currentWorkflow.activeStepIndex && currentWorkflow.status === 'Running';
        return '<div class="step-card ' + (isActive ? 'active-step' : '') + '">' +
          '<div class="step-header">' +
            '<div style="display: flex; align-items: center; gap: 8px;">' +
              '<span style="font-weight: 700; color: #60a5fa;">#' + (idx + 1) + '</span>' +
              '<span class="step-title">' + escapeHtml(step.roleName) + '</span>' +
              '<span style="font-size: 11px; color: var(--fg-muted);">(' + escapeHtml(step.taskName) + ')</span>' +
            '</div>' +
            '<div>' +
              '<span class="badge badge-' + step.status + '">' + step.status + '</span>' +
            '</div>' +
          '</div>' +
          '<div style="font-size: 12px; color: #cbd5e1; margin-bottom: 8px;">' + escapeHtml(step.taskPrompt) + '</div>' +
          '<div style="display: flex; justify-content: space-between; align-items: center; font-size: 11px; color: var(--fg-muted);">' +
            '<div>Model: <code style="color: #93c5fd;">' + escapeHtml(step.assignedModel) + '</code></div>' +
            "<button class=\"btn btn-secondary\" style=\"padding: 2px 8px; font-size: 11px;\" onclick=\"openStepModal('" + step.id + "')\">Inspect Prompt</button>" +
          '</div>' +
        '</div>';
      }).join('');
    }

    function pauseWorkflow() { vscode.postMessage({ command: 'pauseWorkflow' }); }
    function resumeWorkflow() { vscode.postMessage({ command: 'resumeWorkflow' }); }
    function cancelWorkflow() { vscode.postMessage({ command: 'cancelWorkflow' }); }

    function openStepModal(stepId) {
      if (!stepId) return;
      var cleanId = String(stepId);
      if (cleanId.indexOf('role_step_') === 0) {
        cleanId = cleanId.substring('role_step_'.length);
      }

      var step = null;
      if (currentWorkflow && currentWorkflow.steps) {
        step = currentWorkflow.steps.find(function(s) {
          return s.id === cleanId || s.id === stepId || ('role_step_' + s.id) === stepId;
        });
      }

      var modalTitle = 'Step Details';
      var modalRole = '';
      var modalTask = '';
      var modalPrompt = '';
      var modalModel = '';

      if (step) {
        modalTitle = 'Step: ' + (step.taskName || step.roleName);
        modalRole = (step.roleName || '') + (step.roleId ? ' (' + step.roleId + ')' : '');
        modalTask = step.taskName || '';
        modalPrompt = step.taskPrompt || step.taskName || '(No prompt specified)';
        modalModel = step.assignedModel || '';
      } else if (chatMessagesList && chatMessagesList.length > 0) {
        var msg = chatMessagesList.find(function(m) {
          return m.id === stepId || m.id === ('role_step_' + cleanId) || m.stepId === cleanId || m.stepId === stepId;
        });
        if (msg) {
          modalTitle = 'Role: ' + (msg.roleName || 'Specialized Role');
          modalRole = (msg.roleName || '') + (msg.roleModel ? ' [' + msg.roleModel + ']' : '');
          modalTask = msg.taskName || msg.content || '';
          modalPrompt = msg.taskPrompt || msg.content || '(Task prompt executed)';
          modalModel = msg.roleModel || '';
        }
      }

      if (!modalRole && !modalPrompt && !modalTask) {
        console.warn('openStepModal: step not found for', stepId);
        return;
      }

      var elTitle = document.getElementById('modalStepTitle');
      var elRole = document.getElementById('modalStepRole');
      var elTask = document.getElementById('modalStepTask');
      var elPrompt = document.getElementById('modalStepPrompt');
      var elModel = document.getElementById('modalStepModel');
      var modal = document.getElementById('stepModal');

      if (elTitle) elTitle.innerText = modalTitle;
      if (elRole) elRole.innerText = modalRole;
      if (elTask) elTask.innerText = modalTask;
      if (elPrompt) elPrompt.innerText = modalPrompt;
      if (elModel) elModel.innerText = modalModel;
      if (modal) modal.classList.add('show');
    }

    function closeModal() {
      document.getElementById('stepModal').classList.remove('show');
    }

    /* ---------------- TAB 2: ROLES ---------------- */
    function renderRoles() {
      const grid = document.getElementById('rolesGrid');
      grid.innerHTML = currentRoles.map(function(role) {
        return '<div class="role-card" id="role_card_' + role.id + '">' +
          '<div>' +
            '<div class="role-card-header">' +
              '<div style="font-size: 15px; font-weight: 600;">' + escapeHtml(role.name) + '</div>' +
              '<label style="display: flex; align-items: center; gap: 4px; font-size: 11px; cursor: pointer;">' +
                "<input type=\"checkbox\" " + (role.enabled ? "checked" : "") + " onchange=\"toggleRoleEnabled('" + role.id + "', this.checked)\" /> Enabled" +
              '</label>' +
            '</div>' +
            '<div style="font-size: 11.5px; color: var(--fg-muted); margin-bottom: 12px;">' + escapeHtml(role.purpose || role.description) + '</div>' +

            '<div class="form-group">' +
              '<label class="form-label">Primary Model (9 Router)</label>' +
              '<div style="display: flex; gap: 6px;">' +
                '<input type="text" class="input-field" value="' + escapeHtml(role.primaryModel) + '" id="primary_' + role.id + '" style="margin: 0;" />' +
                "<button class=\"btn btn-secondary\" onclick=\"openModelPicker('" + role.id + "', 'primary')\">Fuzzy Search</button>" +
              '</div>' +
            '</div>' +

            '<div class="form-group">' +
              '<label class="form-label">Fallback Models Chain</label>' +
              '<div style="display: flex; gap: 6px;">' +
                '<input type="text" class="input-field" value="' + escapeHtml((role.fallbackModels || []).join(', ')) + '" id="fallbacks_' + role.id + '" placeholder="Comma-separated models" style="margin: 0;" />' +
                "<button class=\"btn btn-secondary\" onclick=\"openModelPicker('" + role.id + "', 'fallback')\">+ Add</button>" +
              '</div>' +
            '</div>' +

            '<div class="form-group">' +
              '<label class="form-label">Role System Persona</label>' +
              '<textarea class="input-field" id="prompt_' + role.id + '" style="min-height: 65px;">' + escapeHtml(role.systemPrompt) + '</textarea>' +
            '</div>' +
          '</div>' +

          '<div style="text-align: right; margin-top: 10px;">' +
            "<button class=\"btn\" onclick=\"saveRoleCard('" + role.id + "')\">Save Role Changes</button>" +
          '</div>' +
        '</div>';
      }).join('');
    }

    function saveRoleCard(roleId) {
      const role = currentRoles.find(r => r.id === roleId);
      if (!role) return;
      role.primaryModel = document.getElementById('primary_' + roleId).value.trim();
      const fbStr = document.getElementById('fallbacks_' + roleId).value;
      role.fallbackModels = fbStr.split(',').map(s => s.trim()).filter(Boolean);
      role.systemPrompt = document.getElementById('prompt_' + roleId).value.trim();
      vscode.postMessage({ command: 'saveRole', role });
    }

    function toggleRoleEnabled(roleId, enabled) {
      const role = currentRoles.find(r => r.id === roleId);
      if (!role) return;
      role.enabled = enabled;
      vscode.postMessage({ command: 'saveRole', role });
    }

    function autoAssignRoles() {
      vscode.postMessage({ command: 'autoAssignRoles', strategy: 'quality' });
    }

    function openRolesJson() {
      vscode.postMessage({ command: 'openRolesJson' });
    }

    function filterRoles() {
      const term = document.getElementById('roleFilterInput').value.toLowerCase();
      currentRoles.forEach(role => {
        const card = document.getElementById('role_card_' + role.id);
        if (!card) return;
        const match = role.name.toLowerCase().includes(term) || role.id.toLowerCase().includes(term) || role.primaryModel.toLowerCase().includes(term);
        card.style.display = match ? 'flex' : 'none';
      });
    }

    /* ---------------- TAB 3: MODELS HUB ---------------- */
    function syncModelsHub() {
      const btn = document.getElementById('syncHubBtn');
      if (btn) btn.innerText = '⟳ Syncing Gateway…';
      currentPickerContext = { isHub: true };
      vscode.postMessage({
        command: 'refreshRouterModels',
        query: hubFilterText || hubSearchQuery
      });
    }

    function setHubFilter(filter, el) {
      hubFilterText = filter;
      const chips = document.querySelectorAll('#hubFilterChips .chip');
      chips.forEach(c => c.classList.remove('active'));
      const targetEl = el || (typeof event !== 'undefined' ? event.target : null);
      if (targetEl && targetEl.classList) targetEl.classList.add('active');
      onHubSearch();
    }

    function onHubSearch() {
      const qInput = document.getElementById('hubSearchInput');
      hubSearchQuery = qInput ? qInput.value : '';
      const combined = (hubFilterText + ' ' + hubSearchQuery).trim();
      currentPickerContext = { isHub: true };
      vscode.postMessage({
        command: 'fuzzySearchModels',
        query: combined
      });
    }

    function renderHubResults(msg) {
      const models = msg.models || [];
      const list = document.getElementById('hubModelList');
      const countEl = document.getElementById('hubCountStatus');
      if (countEl) countEl.innerText = 'Showing ' + models.length + ' of ' + (msg.catalogSize || 2150) + ' models from 9 Router';
      const btn = document.getElementById('syncHubBtn');
      if (btn) btn.innerText = '⟳ Sync 9 Router Gateway';

      if (!models || !models.length) {
        list.innerHTML = '<div style="padding: 24px; text-align: center; color: #64748b;">No matching 9 Router models found.</div>';
        return;
      }

      list.innerHTML = models.map(function(m) {
        const isActive = m.id === currentSelectedModel;
        const caps = [];
        if (m.caps && m.caps.tools) caps.push('tools');
        if (m.caps && m.caps.reasoning) caps.push('reasoning');
        if (m.caps && m.caps.vision) caps.push('vision');
        if (m.caps && (m.caps.audioInput || m.caps.audioOutput)) caps.push('audio');
        if (m.source === 'router' || m.id.includes('/')) caps.push('9router');
        const capsHtml = caps.map(function(c) {
          return '<span class="model-cap-tag ' + (c === '9router' ? 'tag-router' : '') + '">' + c + '</span>';
        }).join('');

        const actionBtn = isActive
          ? '<button class="btn btn-secondary" style="opacity: 0.7; pointer-events: none;">Active Model</button>'
          : "<button class=\"btn btn-secondary\" onclick=\"activateModel('" + escapeHtml(m.id) + "')\">Set Active</button>";

        return '<div class="model-card-item ' + (isActive ? 'is-active-model' : '') + '">' +
          '<div style="flex: 1; min-width: 0; padding-right: 12px;">' +
            '<div style="display: flex; align-items: center; gap: 8px;">' +
              '<strong style="font-size: 13.5px; word-break: break-all;">' + escapeHtml(m.id) + '</strong>' +
              (isActive ? '<span class="badge badge-Completed" style="font-size: 9.5px;">Active</span>' : '') +
            '</div>' +
            '<div style="font-size: 11.5px; color: var(--fg-muted); margin-top: 3px;">' +
              'Provider: <span style="color: #cbd5e1;">' + escapeHtml(m.provider || 'router') + '</span>' +
            '</div>' +
            (capsHtml ? '<div style="display: flex; gap: 4px; margin-top: 5px; flex-wrap: wrap;">' + capsHtml + '</div>' : '') +
          '</div>' +
          '<div>' + actionBtn + '</div>' +
        '</div>';
      }).join('');
    }

    function activateModel(modelId) {
      vscode.postMessage({ command: 'selectActiveModel', modelId });
    }

    function toggleHideLive(hide) {
      vscode.postMessage({ command: 'toggleFilterLive', filterLive: !hide });
    }

    /* ---------------- TAB 4: VOICE ---------------- */
    function renderVoiceTab(liveModels) {
      const orb = document.getElementById('voiceOrb');
      const title = document.getElementById('voiceStatusTitle');
      const desc = document.getElementById('voiceStatusDesc');
      const toggleBtn = document.getElementById('voiceToggleBtn');
      const muteBtn = document.getElementById('voiceMuteBtn');
      const talkBtn = document.getElementById('voiceTalkBtn');

      if (isVoiceCurrentlyActive) {
        orb.className = 'voice-orb active';
        title.innerText = isVoiceCurrentlyMuted
          ? 'Voice Conversation Muted'
          : (isVoiceCurrentlyTalking ? 'Voice Live & Listening' : 'Voice Connected (Mic Paused)');
        desc.innerText = isVoiceCurrentlyTalking
          ? 'Mic is live and transmitting audio to Gemini Live. Speak anytime!'
          : 'Microphone is paused. Click "Resume Mic" to speak.';
        toggleBtn.innerText = '⏹ Stop Voice Mode';
        toggleBtn.className = 'btn btn-danger';
        muteBtn.innerText = isVoiceCurrentlyMuted ? '🔊 Unmute Mic' : '🔇 Mute Mic';
        muteBtn.style.display = 'inline-flex';
        if (talkBtn) {
          talkBtn.innerText = isVoiceCurrentlyTalking ? '⏸ Pause Mic' : '🔴 Resume Mic (Speak)';
          talkBtn.className = isVoiceCurrentlyTalking ? 'btn btn-secondary' : 'btn btn-primary';
          talkBtn.style.display = 'inline-flex';
        }
      } else {
        orb.className = 'voice-orb';
        title.innerText = 'Voice Mode Ready';
        desc.innerText = 'Direct low-latency voice-to-voice with Gemini Live (BidiGenerateContent) and autonomous tool execution.';
        toggleBtn.innerText = '🎙️ Start Voice Mode';
        toggleBtn.className = 'btn btn-gradient';
        muteBtn.style.display = 'none';
        if (talkBtn) talkBtn.style.display = 'none';
      }

      if (liveModels && liveModels.length) {
        const sel = document.getElementById('liveModelSelect');
        sel.innerHTML = liveModels.map(function(m) {
          const isSel = m.id === currentVoiceOpts?.liveModel ? ' selected' : '';
          return '<option value="' + m.id + '"' + isSel + '>' + escapeHtml(m.name) + ' (' + escapeHtml(m.tag) + ')</option>';
        }).join('');
      }

      const keysList = document.getElementById('apiKeysList');
      if (!currentApiKeys || !currentApiKeys.length) {
        keysList.innerHTML = '<div style="font-size: 12px; color: #f59e0b; padding: 6px 0;">⚠️ No Gemini API keys configured. Voice Mode requires at least one Gemini key.</div>';
      } else {
        keysList.innerHTML = currentApiKeys.map(function(k, idx) {
          const badge = idx === 0
            ? '<span class="badge badge-Completed" style="font-size: 9px; margin-left: 6px;">Primary</span>'
            : '<span class="badge" style="font-size: 9px; margin-left: 6px; background: #475569;">Fallback</span>';
          return '<div style="display: flex; justify-content: space-between; align-items: center; padding: 6px 10px; background: rgba(0,0,0,0.3); border-radius: 4px; margin-bottom: 6px;">' +
            '<div style="font-family: monospace; font-size: 11.5px;">' + escapeHtml(k.masked) + ' ' + badge + '</div>' +
            '<button class="btn btn-secondary" style="padding: 2px 6px; font-size: 10px;" onclick="removeApiKey(' + idx + ')">Remove</button>' +
          '</div>';
        }).join('');
      }
    }

    function toggleVoiceMode() { vscode.postMessage({ command: 'toggleVoiceMode' }); }
    function toggleVoiceTalk() { vscode.postMessage({ command: 'toggleVoiceTalk' }); }
    function toggleVoiceMute() { vscode.postMessage({ command: 'toggleVoiceMute' }); }
    function openRecordingsFolder() { vscode.postMessage({ command: 'openRecordingsFolder' }); }
    function copyLatestAudioPath() { vscode.postMessage({ command: 'copyLatestAudio' }); }
    function checkMicLevel() { vscode.postMessage({ command: 'checkMicLevel' }); }
    function listAudioDevices() { vscode.postMessage({ command: 'listAudioDevices' }); }

    function onLiveModelChange(val) {
      vscode.postMessage({ command: 'setLiveModel', liveModel: val });
    }

    function addGeminiApiKey() {
      const input = document.getElementById('newApiKeyInput');
      const val = input.value.trim();
      if (!val) return;
      vscode.postMessage({ command: 'addGeminiApiKey', key: val });
      input.value = '';
    }

    function removeApiKey(idx) {
      vscode.postMessage({ command: 'removeGeminiApiKey', index: idx });
    }

    /* ---------------- TAB 5: SESSION & GUARDRAILS ---------------- */
    function renderSessionTab() {
      if (!currentSessionOpts) return;
      document.getElementById('tempSlider').value = currentSessionOpts.temperature ?? 0.5;
      document.getElementById('tempValueBadge').innerText = currentSessionOpts.temperature ?? 0.5;
      document.getElementById('maxTokensInput').value = currentSessionOpts.maxTokens ?? 4096;
      document.getElementById('maxTurnsInput').value = currentSessionOpts.maxTurns ?? 40;
      document.getElementById('allowShellCheck').checked = currentSessionOpts.allowShell !== false;
      document.getElementById('allowVscodeCheck').checked = currentSessionOpts.allowVscode !== false;
      document.getElementById('allowFilesCheck').checked = currentSessionOpts.allowFiles !== false;
      document.getElementById('workspacePromptInput').value = currentSessionOpts.systemPrompt || '';

      const rOpen = document.getElementById('resumeOnOpenCheck');
      if (rOpen) rOpen.checked = currentSessionOpts.resumeOnOpen !== false;
      const pHist = document.getElementById('persistHistoryCheck');
      if (pHist) pHist.checked = currentSessionOpts.persistHistory !== false;
      const uVoice = document.getElementById('unifiedVoiceAndTextCheck');
      if (uVoice) uVoice.checked = currentSessionOpts.unifiedVoiceAndText !== false;
      const mTurns = document.getElementById('maxPersistedTurnsInput');
      if (mTurns) mTurns.value = currentSessionOpts.maxPersistedTurns ?? 50;
    }

    function onTempSlider(val) {
      document.getElementById('tempValueBadge').innerText = val;
    }

    function saveSessionSettings() {
      const rOpen = document.getElementById('resumeOnOpenCheck');
      const pHist = document.getElementById('persistHistoryCheck');
      const uVoice = document.getElementById('unifiedVoiceAndTextCheck');
      const mTurns = document.getElementById('maxPersistedTurnsInput');

      vscode.postMessage({
        command: 'saveSessionOptions',
        temperature: parseFloat(document.getElementById('tempSlider').value),
        maxTokens: parseInt(document.getElementById('maxTokensInput').value, 10),
        maxTurns: parseInt(document.getElementById('maxTurnsInput').value, 10),
        allowShell: document.getElementById('allowShellCheck').checked,
        allowVscode: document.getElementById('allowVscodeCheck').checked,
        allowFiles: document.getElementById('allowFilesCheck').checked,
        systemPrompt: document.getElementById('workspacePromptInput').value.trim(),
        resumeOnOpen: rOpen ? rOpen.checked : true,
        persistHistory: pHist ? pHist.checked : true,
        unifiedVoiceAndText: uVoice ? uVoice.checked : true,
        maxPersistedTurns: mTurns ? parseInt(mTurns.value, 10) : 50
      });
    }

    function startNewSession() {
      vscode.postMessage({ command: 'newSession' });
    }

    function onSwitchSession(sessionId) {
      if (!sessionId) return;
      vscode.postMessage({ command: 'loadSession', sessionId: sessionId });
    }

    function exportActiveSession() {
      vscode.postMessage({ command: 'exportSession' });
    }

    function clearAllSavedSessions() {
      vscode.postMessage({ command: 'clearAllSessions' });
    }

    /* ---------------- TAB 6: CHAT CONSOLE & SERIAL GRAPH ---------------- */

    function setChatMode(mode) {
      currentChatMode = mode;
      const pBtn = document.getElementById('modePipelineBtn');
      const dBtn = document.getElementById('modeDirectBtn');
      const input = document.getElementById('chatMessageInput');
      const gWrap = document.getElementById('chatGraphWrapper');
      const wTitle = document.getElementById('chatWelcomeTitle');
      const wDesc = document.getElementById('chatWelcomeDesc');
      const banner = document.getElementById('chatDirectModeBanner');
      const bannerModel = document.getElementById('chatBannerModelName');
      const modePill = document.getElementById('inputBarModePill');
      const modeModelText = document.getElementById('inputBarModelText');
      const modelNameEl = document.getElementById('inputBarModelName');

      if (pBtn) pBtn.classList.toggle('active', mode === 'pipeline');
      if (dBtn) dBtn.classList.toggle('active', mode === 'direct');

      if (bannerModel) bannerModel.innerText = currentSelectedModel;
      if (modelNameEl) modelNameEl.innerText = currentSelectedModel;

      if (mode === 'pipeline') {
        if (input) input.placeholder = "Type your instruction or goal (e.g. 'Build REST API for products and write unit tests')… [Enter to Send, Shift+Enter for newline]";
        if (gWrap) gWrap.style.opacity = '1';
        if (wTitle) wTitle.innerText = 'Autonomous AI Role Orchestrator';
        if (wDesc) wDesc.innerHTML = 'In <strong>Autonomous Pipeline</strong> mode, enter a requirement to autonomously decompose and execute serial roles with real-time graph updates.';
        if (banner) banner.style.display = 'none';
        if (modePill) {
          modePill.innerText = '⚡ Autonomous Pipeline';
          modePill.style.background = 'rgba(56,189,248,0.15)';
          modePill.style.color = '#38bdf8';
        }
        if (modeModelText) modeModelText.innerText = 'Decomposing into serial specialized roles';
      } else {
        if (input) input.placeholder = "Chat with " + currentSelectedModel + " (normal text mode)… [Enter to Send, Shift+Enter for newline]";
        if (gWrap) gWrap.style.opacity = '0.7';
        if (wTitle) wTitle.innerText = 'Direct Chat with ' + currentSelectedModel;
        if (wDesc) wDesc.innerHTML = 'In <strong>Chat with Selected Model (Text Mode)</strong>, you converse directly with <strong>' + escapeHtml(currentSelectedModel) + '</strong> from 9 Router. You can change your selected model anytime using the dropdown or 9 Router model picker.';
        if (banner) banner.style.display = 'flex';
        if (modePill) {
          modePill.innerText = '💬 Text Mode (Chat with Selected Model)';
          modePill.style.background = 'rgba(34,197,94,0.15)';
          modePill.style.color = '#4ade80';
        }
        if (modeModelText) modeModelText.innerText = '1-on-1 direct conversation with tools';
      }
      if (input) input.focus();
      // keep compact bar in sync
      syncCompactBar(mode, null, null, currentSelectedModel);
    }

    function openChatModelPicker() {
      currentPickerContext = { isChatModel: true, isHub: false };
      document.getElementById('modelPickerTitle').innerText = 'Select Model from 9 Router';
      document.getElementById('modelPickerSubtitle').innerText = 'Pick any model from 2,150 9 Router models to chat with directly';
      document.getElementById('modelSearchInput').value = '';
      const statusEl = document.getElementById('modelCountStatus');
      if (statusEl) statusEl.innerText = 'Loading 9 Router models…';
      document.getElementById('modelPickerModal').classList.add('show');
      onModelSearchInput();
    }

    function renderChatTab(workspacePath, activeDoc) {
      const badge = document.getElementById('chatActiveModelBadge');
      if (badge) badge.innerText = currentSelectedModel;
      renderChatSerialGraph(currentWorkflow);
    }

    function renderChatSerialGraph(wf) {
      const container = document.getElementById('chatSerialGraph');
      const countText = document.getElementById('graphStepCountText');
      const statusPill = document.getElementById('chatWorkflowStatusPill');
      const goalSnippet = document.getElementById('chatGoalSnippet');

      if (!container) return;

      if (!wf || !wf.steps || wf.steps.length === 0) {
        container.innerHTML = '<span style="font-size: 11.5px; color: var(--fg-muted); font-style: italic;">Enter a task below to generate and launch the serial role pipeline…</span>';
        if (countText) countText.innerText = '0 / 0 steps';
        if (statusPill) {
          statusPill.className = 'badge badge-Queued';
          statusPill.innerText = 'Idle';
        }
        if (goalSnippet) goalSnippet.innerText = '(No active task)';
        syncCompactBar(currentChatMode, 'Idle', '(No active task)', null);
        return;
      }

      if (goalSnippet) goalSnippet.innerText = wf.userGoal || 'Untitled Goal';
      if (statusPill) {
        statusPill.className = 'badge badge-' + wf.status;
        statusPill.innerText = wf.status;
      }
      syncCompactBar(currentChatMode, wf.status, wf.userGoal || 'Untitled Goal', null);

      const total = wf.steps.length;
      const completed = wf.steps.filter(function(s) { return s.status === 'Completed'; }).length;
      if (countText) {
        countText.innerText = 'Step ' + (wf.activeStepIndex + 1) + ' of ' + total + ' (' + completed + ' done)';
      }

      container.innerHTML = wf.steps.map(function(step, idx) {
        const isRunning = idx === wf.activeStepIndex && wf.status === 'Running';
        const isCompleted = step.status === 'Completed';
        const isFailed = step.status === 'Failed';

        let nodeClass = 'node-queued';
        if (isRunning) {
          nodeClass = 'node-running';
        } else if (isCompleted) {
          nodeClass = 'node-completed';
        } else if (isFailed) {
          nodeClass = 'node-failed';
        }

        const isLast = idx === wf.steps.length - 1;
        const arrowClass = isCompleted ? 'arrow-completed' : (isRunning ? 'arrow-active' : '');

            "<button class=\"btn btn-secondary\" style=\"padding: 2px 8px; font-size: 11px;\" onclick=\"openStepModal('" + step.id + "')\">Inspect Prompt</button>" +
          '<span class="graph-node-dot"></span>' +
          '<span style="font-weight: 600;">#' + (idx + 1) + ' ' + escapeHtml(step.roleName) + '</span>' +
          '<span style="font-size: 10px; opacity: 0.8; max-width: 105px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">' + escapeHtml(step.assignedModel) + '</span>' +
        '</div>' +
        (!isLast ? '<span class="graph-arrow ' + arrowClass + '">➔</span>' : '');
      }).join('');
    }

    function syncRoleCardsWithWorkflow(wf) {
      if (!wf || !wf.steps || wf.steps.length === 0) return;
      const feed = document.getElementById('chatFeed');
      if (!feed) return;
      const welcome = document.getElementById('chatWelcomeCard');
      if (welcome) welcome.style.display = 'none';

      wf.steps.forEach(function(step, idx) {
        const isRunning = idx === wf.activeStepIndex && wf.status === 'Running';
        const isCompleted = step.status === 'Completed';
        const isFailed = step.status === 'Failed';
        const isQueued = !isRunning && !isCompleted && !isFailed;

        const borderClass = isRunning ? 'role-card-running' : (isCompleted ? 'role-card-completed' : (isFailed ? 'role-card-failed' : 'role-card-pending'));
        const badgeClass = isRunning ? 'badge-Running' : (isCompleted ? 'badge-Completed' : (isFailed ? 'badge-Failed' : 'badge-Queued'));
        const statusLabel = isRunning ? '● Running' : (isCompleted ? '✓ Completed' : (isFailed ? '✕ Failed' : 'Waiting'));

        let descText = step.taskName || '';
        if (isCompleted) {
          descText = step.resultSummary ? (step.resultSummary.slice(0, 160) + '…') : (step.taskName + ' - Completed.');
        } else if (isQueued) {
          const prevRole = idx > 0 ? wf.steps[idx - 1].roleName : '';
          descText = prevRole ? ('Waiting for ' + prevRole + '…') : 'Waiting in queue…';
        }

        const card = document.getElementById('role_card_view_role_step_' + step.id);
        if (card) {
          card.className = 'chat-role-card ' + borderClass;
          const badge = document.getElementById('role_badge_role_step_' + step.id);
          if (badge) {
            badge.className = 'badge ' + badgeClass;
            badge.innerText = statusLabel;
          }
          const descEl = document.getElementById('role_task_desc_role_step_' + step.id);
          if (descEl) {
            descEl.innerText = descText;
          }
        } else {
          appendLiveChatMessage({
            id: 'role_step_' + step.id,
            stepId: step.id,
            taskPrompt: step.taskPrompt,
            sender: 'role',
            roleName: step.roleName,
            roleModel: step.assignedModel,
            taskName: step.taskName,
            content: descText,
            timestamp: new Date().toLocaleTimeString(),
            status: isRunning ? 'Running' : (isCompleted ? 'Completed' : (isFailed ? 'Failed' : 'Queued')),
            logs: isRunning ? ['[' + step.roleName + '] Initialized execution with model ' + step.assignedModel + '…'] : ['Queued: Waiting to execute…']
          });
        }
      });
    }

    function appendLiveChatMessage(msg) {
      const feed = document.getElementById('chatFeed');
      if (!feed) return;
      const welcome = document.getElementById('chatWelcomeCard');
      if (welcome) welcome.style.display = 'none';

      chatMessagesList.push(msg);

      const row = document.createElement('div');
      row.id = 'chat_row_' + msg.id;

      if (msg.sender === 'user') {
        row.className = 'chat-bubble-row user-row';
        row.innerHTML =
          '<div class="chat-bubble-meta">' +
            '<span>You</span>' +
            '<span>•</span>' +
            '<span>' + escapeHtml(msg.timestamp || '') + '</span>' +
          '</div>' +
          '<div class="chat-bubble user-bubble">' + escapeHtml(msg.content) + '</div>';
      } else if (msg.sender === 'voice') {
        const isUserVoice = msg.from === 'user';
        row.className = 'chat-bubble-row ' + (isUserVoice ? 'user-row' : 'ai-row');
        row.innerHTML =
          '<div class="chat-bubble-meta">' +
            '<span>🎙️ ' + (isUserVoice ? 'You (Voice)' : 'Gemini Live') + '</span>' +
            '<span>•</span>' +
            '<span>' + escapeHtml(msg.timestamp || '') + '</span>' +
          '</div>' +
          '<div class="chat-bubble ' + (isUserVoice ? 'user-bubble' : 'ai-bubble') + '" id="voice_content_' + msg.id + '">' + escapeHtml(msg.content) + '</div>';
      } else if (msg.sender === 'role') {
        row.className = 'chat-bubble-row role-row';
        const isRunning = msg.status === 'Running';
        const isCompleted = msg.status === 'Completed';
        const isFailed = msg.status === 'Failed';
        const isQueued = !isRunning && !isCompleted && !isFailed;
        const borderClass = isRunning ? 'role-card-running' : (isCompleted ? 'role-card-completed' : (isFailed ? 'role-card-failed' : 'role-card-pending'));
        const badgeClass = isRunning ? 'badge-Running' : (isCompleted ? 'badge-Completed' : (isFailed ? 'badge-Failed' : 'badge-Queued'));
        const statusLabel = isRunning ? '● Running' : (isCompleted ? '✓ Completed' : (isFailed ? '✕ Failed' : 'Waiting'));
        const logLines = (msg.logs || []).map(function(l) { return escapeHtml(l); }).join('\\n');
        const stepIdForModal = msg.stepId || (msg.id && msg.id.indexOf('role_step_') === 0 ? msg.id.substring('role_step_'.length) : (msg.id || ''));

        row.innerHTML =
          '<div class="chat-role-card ' + borderClass + '" id="role_card_view_' + msg.id + '">' +
            '<div class="chat-role-head">' +
              '<div style="display: flex; align-items: center; gap: 8px;">' +
                '<span style="font-size: 14px;">⚡</span>' +
                '<strong style="font-size: 13px; color: #f8fafc;">' + escapeHtml(msg.roleName || 'Specialized Role') + '</strong>' +
                '<span class="badge" style="background: rgba(59,130,246,0.15); color: #60a5fa; font-size: 10px;">' + escapeHtml(msg.roleModel || '') + '</span>' +
              '</div>' +
              '<div style="display: flex; align-items: center; gap: 6px;">' +
                "<button class=\"btn btn-secondary\" style=\"padding: 2px 8px; font-size: 10.5px; border-radius: 4px; display: inline-flex; align-items: center; gap: 4px; cursor: pointer;\" onclick=\"openStepModal('" + escapeHtml(stepIdForModal) + "')\">🔍 Inspect Prompt</button>" +
                '<span class="badge ' + badgeClass + '" id="role_badge_' + msg.id + '">' + statusLabel + '</span>' +
              '</div>' +
            '</div>' +
            '<div style="font-size: 12px; color: #cbd5e1; margin-bottom: 8px;" id="role_task_desc_' + msg.id + '">' + escapeHtml(msg.content || '') + '</div>' +
            '<div class="chat-role-log-box" id="role_logs_' + msg.id + '">' + logLines + '</div>' +
          '</div>';
      } else {
        row.className = 'chat-bubble-row ai-row';
        row.innerHTML =
          '<div class="chat-bubble-meta">' +
            '<span>' + escapeHtml(msg.roleModel || '9 Router') + '</span>' +
            '<span>•</span>' +
            '<span>' + escapeHtml(msg.timestamp || '') + '</span>' +
          '</div>' +
          '<div class="chat-bubble ai-bubble" id="ai_content_' + msg.id + '">' + escapeHtml(msg.content) + '</div>';
      }

      feed.appendChild(row);
      feed.scrollTop = feed.scrollHeight;
    }

    function appendLiveChatDelta(id, text) {
      const el = document.getElementById('ai_content_' + id) || document.getElementById('voice_content_' + id);
      if (el) {
        el.innerText += text;
        const feed = document.getElementById('chatFeed');
        if (feed) feed.scrollTop = feed.scrollHeight;
      }
    }

    function appendLiveChatLog(line, roleName) {
      const logBoxes = document.querySelectorAll('.chat-role-log-box');
      if (logBoxes.length > 0) {
        const lastBox = logBoxes[logBoxes.length - 1];
        lastBox.innerText += (lastBox.innerText ? '\\n' : '') + line;
        lastBox.scrollTop = lastBox.scrollHeight;
      }
    }

    function updateStepProgressInChat(stepId, state, pct, note) {
      const card = document.getElementById('role_card_view_role_step_' + stepId);
      if (card) {
        const badge = document.getElementById('role_badge_role_step_' + stepId);
        if (badge) {
          badge.innerText = state;
          badge.className = 'badge badge-' + (state === 'Completed' ? 'Completed' : (state === 'Failed' ? 'Failed' : 'Running'));
        }
        if (state === 'Completed') {
          card.classList.remove('role-card-running');
          card.classList.add('role-card-completed');
        } else if (state === 'Failed') {
          card.classList.remove('role-card-running');
          card.classList.add('role-card-failed');
        }
        const logBox = document.getElementById('role_logs_role_step_' + stepId);
        if (logBox && note) {
          logBox.innerText += '\\n[progress] ' + state + (pct ? ' (' + pct + '%)' : '') + ' - ' + note;
          logBox.scrollTop = logBox.scrollHeight;
        }
      }
    }

    function handleVoiceTurnInChat(text, turnComplete, from) {
      const isUser = from === 'user';
      const activeId = isUser ? 'active_live_user_bubble' : 'active_live_ai_bubble';
      const oppositeId = isUser ? 'active_live_ai_bubble' : 'active_live_user_bubble';

      // If turn is complete with no extra text, finalize active bubble
      if (!text && turnComplete) {
        const currentActive = document.getElementById(activeId);
        if (currentActive) currentActive.removeAttribute('id');
        return;
      }
      if (!text) return;

      const feed = document.getElementById('chatFeed');
      if (!feed) return;
      const welcome = document.getElementById('chatWelcomeCard');
      if (welcome) welcome.style.display = 'none';

      // Ensure any lingering opposite speaker bubble is closed so turns never concatenate
      const oppositeBubble = document.getElementById(oppositeId);
      if (oppositeBubble) {
        oppositeBubble.removeAttribute('id');
      }

      let voiceBox = document.getElementById(activeId);
      if (!voiceBox) {
        const row = document.createElement('div');
        row.className = 'chat-bubble-row ' + (isUser ? 'user-row' : 'ai-row');
        row.innerHTML =
          '<div class="chat-bubble-meta">' +
            '<span>' + (isUser ? '🎙️ You (Voice)' : '🎙️ Gemini Live (AI)') + '</span>' +
            '<span>•</span>' +
            '<span>' + new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) + '</span>' +
          '</div>' +
          '<div class="chat-bubble ' + (isUser ? 'user-bubble voice-user-bubble' : 'ai-bubble voice-ai-bubble') + '" id="' + activeId + '">' + escapeHtml(text) + '</div>';
        feed.appendChild(row);
        voiceBox = document.getElementById(activeId);
      } else {
        voiceBox.innerText += text;
      }

      feed.scrollTop = feed.scrollHeight;

      if (turnComplete && voiceBox) {
        voiceBox.removeAttribute('id');
      }
    }

    function submitChatMessage() {
      const input = document.getElementById('chatMessageInput');
      if (!input) return;
      const text = input.value.trim();
      if (!text) return;

      vscode.postMessage({
        command: 'chatSubmit',
        text,
        mode: currentChatMode,
        selectedModel: currentSelectedModel
      });

      input.value = '';
    }

    function onChatInputKeyDown(event) {
      if (event.key === 'Enter' && !event.shiftKey) {
        event.preventDefault();
        submitChatMessage();
      }
    }

    function fillChatPrompt(text) {
      const input = document.getElementById('chatMessageInput');
      if (input) {
        input.value = text;
        input.focus();
        input.scrollTop = input.scrollHeight;
      }
    }

    function clearChatMessages() {
      vscode.postMessage({ command: 'clearChat' });
    }

    function clearChatUI() {
      chatMessagesList = [];
      const feed = document.getElementById('chatFeed');
      if (feed) {
        feed.innerHTML =
          '<div id="chatWelcomeCard" class="card" style="text-align: center; padding: 28px 20px; background: rgba(15,23,42,0.5); border: 1px dashed rgba(255,255,255,0.12);">' +
            '<div style="font-size: 32px; margin-bottom: 8px;">🚀</div>' +
            '<h3 id="chatWelcomeTitle" style="font-size: 15px; font-weight: 600; margin-bottom: 6px;">Autonomous AI Role Orchestrator & Chat</h3>' +
            '<p id="chatWelcomeDesc" style="font-size: 12.5px; color: var(--fg-muted); max-width: 540px; margin: 0 auto 16px auto; line-height: 1.5;">' +
              'In <strong>Autonomous Pipeline</strong> mode, enter a requirement to decompose and execute serial roles with real-time graph updates. Switch to <strong>Chat with Selected Model</strong> to converse directly with your chosen 9 Router model.' +
            '</p>' +
            '<div style="display: flex; gap: 8px; justify-content: center; flex-wrap: wrap;">' +
              "<button class=\"btn btn-secondary\" style=\"font-size: 11.5px; padding: 5px 12px;\" onclick=\"fillChatPrompt('Build authentication system with OAuth2 and JWT tokens')\">🔐 Build Auth & JWT</button>" +
              "<button class=\"btn btn-secondary\" style=\"font-size: 11.5px; padding: 5px 12px;\" onclick=\"fillChatPrompt('Create database schema and REST API endpoints')\">🗄️ DB Schema & API</button>" +
              "<button class=\"btn btn-secondary\" style=\"font-size: 11.5px; padding: 5px 12px;\" onclick=\"fillChatPrompt('Audit codebase for vulnerabilities and write unit tests')\">🛡️ Audit & Write Tests</button>" +
            '</div>' +
          '</div>';
      }
    }

    function toggleDictation() {
      const SpeechRec = window.SpeechRecognition || window.webkitSpeechRecognition;
      const btn = document.getElementById('dictateBtn');
      const btnText = document.getElementById('dictateBtnText');

      if (!SpeechRec) {
        alert('Web Speech API is not available in this environment. You can click "Voice Mode" for direct Gemini Live bidirectional voice streaming.');
        return;
      }

      if (isDictating) {
        if (speechRecognizer) speechRecognizer.stop();
        isDictating = false;
        if (btn) btn.classList.remove('dictating-active');
        if (btnText) btnText.innerText = 'Dictate';
        return;
      }

      try {
        speechRecognizer = new SpeechRec();
        speechRecognizer.continuous = true;
        speechRecognizer.interimResults = true;
        speechRecognizer.lang = 'en-US';

        const input = document.getElementById('chatMessageInput');
        let startingText = input ? input.value : '';
        if (startingText && !startingText.endsWith(' ')) startingText += ' ';

        speechRecognizer.onstart = () => {
          isDictating = true;
          if (btn) btn.classList.add('dictating-active');
          if (btnText) btnText.innerText = 'Listening…';
        };

        speechRecognizer.onresult = (event) => {
          let interim = '';
          let final = '';
          for (let i = event.resultIndex; i < event.results.length; ++i) {
            if (event.results[i].isFinal) {
              final += event.results[i][0].transcript;
            } else {
              interim += event.results[i][0].transcript;
            }
          }
          if (input) {
            input.value = startingText + final + (interim ? ' ' + interim : '');
            input.scrollTop = input.scrollHeight;
          }
        };

        speechRecognizer.onerror = (e) => {
          console.warn('Speech recognition error', e);
          isDictating = false;
          if (btn) btn.classList.remove('dictating-active');
          if (btnText) btnText.innerText = 'Dictate';
        };

        speechRecognizer.onend = () => {
          isDictating = false;
          if (btn) btn.classList.remove('dictating-active');
          if (btnText) btnText.innerText = 'Dictate';
        };

        speechRecognizer.start();
      } catch (err) {
        console.error('Failed to start speech recognition', err);
        isDictating = false;
        if (btn) btn.classList.remove('dictating-active');
        if (btnText) btnText.innerText = 'Dictate';
      }
    }

    function toggleVoiceModeFromChat() {
      vscode.postMessage({ command: 'toggleVoiceMode' });
    }

    /* ---------------- MODEL PICKER POPUP (from roles & chat) ---------------- */
    function openModelPicker(roleId, field) {
      currentPickerContext = { roleId, field, isHub: false, isChatModel: false };
      document.getElementById('modelPickerTitle').innerText = field === 'primary'
        ? 'Select Primary Model (Fuzzy Search)'
        : 'Add Fallback Model (Fuzzy Search)';
      document.getElementById('modelPickerSubtitle').innerText = 'Complete 9 Router Gateway Catalog';
      document.getElementById('modelSearchInput').value = '';
      const statusEl = document.getElementById('modelCountStatus');
      if (statusEl) statusEl.innerText = 'Loading 9 Router models…';
      document.getElementById('modelPickerModal').classList.add('show');
      onModelSearchInput();
    }

    function closeModelPicker() {
      document.getElementById('modelPickerModal').classList.remove('show');
      currentPickerContext = null;
    }

    function onModelSearchInput() {
      const q = document.getElementById('modelSearchInput').value;
      vscode.postMessage({
        command: 'fuzzySearchModels',
        query: q,
        field: currentPickerContext?.field,
        roleId: currentPickerContext?.roleId
      });
    }

    function refreshRouterModels() {
      const btn = document.getElementById('refreshRouterModelsBtn');
      if (btn) btn.innerText = '⟳ Syncing…';
      vscode.postMessage({
        command: 'refreshRouterModels',
        query: document.getElementById('modelSearchInput').value,
        field: currentPickerContext?.field,
        roleId: currentPickerContext?.roleId
      });
    }

    function renderFuzzyResults(msg) {
      const models = msg.models || [];
      const totalCount = msg.totalCount ?? models.length;
      const catalogSize = msg.catalogSize ?? 2150;
      const statusEl = document.getElementById('modelCountStatus');
      if (statusEl) {
        if (msg.query) {
          statusEl.innerText = 'Found ' + totalCount + ' matching model(s) in 9 Router (displaying top ' + models.length + ')';
        } else {
          statusEl.innerText = 'Showing all ' + models.length + ' of ' + catalogSize + ' models from 9 Router';
        }
      }
      const btn = document.getElementById('refreshRouterModelsBtn');
      if (btn) btn.innerText = '⟳ Sync 9 Router';

      const list = document.getElementById('modelList');
      if (!models || !models.length) {
        list.innerHTML = '<div style="padding: 16px; text-align: center; color: var(--fg-muted);">No matching models found in 9 Router.</div>';
        return;
      }

      list.innerHTML = models.map(function(m) {
        const capsList = [];
        if (m.caps && m.caps.tools) capsList.push('tools');
        if (m.caps && m.caps.reasoning) capsList.push('reasoning');
        if (m.caps && m.caps.vision) capsList.push('vision');
        if (m.caps && (m.caps.audioInput || m.caps.audioOutput)) capsList.push('audio');
        const isRouter = m.source === 'router' || m.id.includes('/');
        if (isRouter) capsList.push('9router');
        const capsHtml = capsList.map(function(c) {
          return '<span class="model-cap-tag ' + (c === '9router' ? 'tag-router' : '') + '">' + c + '</span>';
        }).join('');

        return "<div class=\"model-item\" onclick=\"selectModel('" + escapeHtml(m.id) + "')\">" +
          '<div style="flex: 1; min-width: 0; padding-right: 10px;">' +
            '<div style="display: flex; align-items: center; gap: 6px;">' +
              '<strong style="word-break: break-all;">' + escapeHtml(m.id) + '</strong>' +
            '</div>' +
            '<div class="model-detail" style="font-size: 11px; color: var(--fg-muted); margin-top: 2px;">Provider: ' + escapeHtml(m.provider || 'router') + '</div>' +
            (capsHtml ? '<div style="display: flex; gap: 4px; margin-top: 3px; flex-wrap: wrap;">' + capsHtml + '</div>' : '') +
          '</div>' +
          '<button class="btn btn-secondary" style="pointer-events: none; flex-shrink: 0;">Select</button>' +
        '</div>';
      }).join('');
    }

    function selectModel(modelId) {
      if (!currentPickerContext || currentPickerContext.isChatModel) {
        currentSelectedModel = modelId;
        updateHeaderStatus();
        const badge = document.getElementById('chatActiveModelBadge');
        if (badge) badge.innerText = modelId;
        const bannerModel = document.getElementById('chatBannerModelName');
        if (bannerModel) bannerModel.innerText = modelId;
        const barModel = document.getElementById('inputBarModelName');
        if (barModel) barModel.innerText = modelId;

        const qSelect = document.getElementById('chatQuickModelDropdown');
        if (qSelect) {
          let found = false;
          for (let i = 0; i < qSelect.options.length; i++) {
            if (qSelect.options[i].value === modelId) {
              qSelect.selectedIndex = i;
              found = true;
              break;
            }
          }
          if (!found) {
            const opt = document.createElement('option');
            opt.value = modelId;
            opt.innerText = modelId;
            qSelect.insertBefore(opt, qSelect.firstChild);
            qSelect.selectedIndex = 0;
          }
        }

        if (currentChatMode === 'direct') {
          const input = document.getElementById('chatMessageInput');
          if (input) input.placeholder = "Chat with " + modelId + " (normal text mode)… [Enter to Send, Shift+Enter for newline]";
          const wTitle = document.getElementById('chatWelcomeTitle');
          if (wTitle) wTitle.innerText = 'Direct Chat with ' + modelId;
          const wDesc = document.getElementById('chatWelcomeDesc');
          if (wDesc) wDesc.innerHTML = 'In <strong>Chat with Selected Model (Text Mode)</strong>, you converse directly with <strong>' + escapeHtml(modelId) + '</strong> from 9 Router.';
        }
        vscode.postMessage({ command: 'selectActiveModel', modelId });
        closeModelPicker();
        return;
      }

      const { roleId, field } = currentPickerContext;
      if (field === 'primary') {
        const input = document.getElementById('primary_' + roleId);
        if (input) input.value = modelId;
      } else {
        const input = document.getElementById('fallbacks_' + roleId);
        if (input) {
          const curr = input.value.split(',').map(s => s.trim()).filter(Boolean);
          if (!curr.includes(modelId)) curr.push(modelId);
          input.value = curr.join(', ');
        }
      }
      closeModelPicker();
      saveRoleCard(roleId);
    }

    function escapeHtml(str) {
      if (!str) return '';
      return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
    }

    // Attach all interactive functions to window so inline onclick handlers always work
    window.switchTab = switchTab;
    window.openChatInterface = openChatInterface;
    window.openChatWithSelectedModel = openChatWithSelectedModel;
    window.startTaskPrompt = startTaskPrompt;
    window.closeNewTaskModal = closeNewTaskModal;
    window.submitInlineNewTask = submitInlineNewTask;
    window.requestRefresh = requestRefresh;
    window.toggleQuickHub = toggleQuickHub;
    window.toggleChatHeader = toggleChatHeader;
    window.togglePipelineGraph = togglePipelineGraph;
    window.submitChatMessage = submitChatMessage;
    window.onChatInputKeyDown = onChatInputKeyDown;
    window.clearChatMessages = clearChatMessages;
    window.toggleDictation = toggleDictation;
    window.setChatMode = setChatMode;
    window.openChatModelPicker = openChatModelPicker;
    window.closeModelPicker = closeModelPicker;
    window.fillChatPrompt = fillChatPrompt;
    window.closeModal = closeModal;
    window.openStepModal = openStepModal;
    window.toggleVoiceMode = toggleVoiceMode;
    window.toggleVoiceTalk = toggleVoiceTalk;
    window.toggleVoiceMute = toggleVoiceMute;
    window.toggleVoiceModeFromChat = toggleVoiceModeFromChat;
    window.saveSessionSettings = saveSessionSettings;
    window.selectModel = selectModel;
    window.onModelSearchInput = onModelSearchInput;
    window.refreshRouterModels = refreshRouterModels;
    window.syncModelsHub = syncModelsHub;
    window.setHubFilter = setHubFilter;
    window.onHubSearch = onHubSearch;
    window.autoAssignRoles = autoAssignRoles;
    window.openRolesJson = openRolesJson;
    window.filterRoles = filterRoles;
    window.saveRoleCard = saveRoleCard;
    window.toggleRoleEnabled = toggleRoleEnabled;
    window.onChatQuickModelChange = onChatQuickModelChange;
    window.onLiveModelChange = onLiveModelChange;
    window.addGeminiApiKey = addGeminiApiKey;
    window.removeApiKey = removeApiKey;
    window.checkMicLevel = checkMicLevel;
    window.listAudioDevices = listAudioDevices;
    window.copyLatestAudioPath = copyLatestAudioPath;
    window.openRecordingsFolder = openRecordingsFolder;
    window.focusLiveModelSelect = focusLiveModelSelect;
    window.focusApiKeysSection = focusApiKeysSection;
    window.activateModel = activateModel;
    window.toggleHideLive = toggleHideLive;
    window.onTempSlider = onTempSlider;
    window.pauseWorkflow = pauseWorkflow;
    window.resumeWorkflow = resumeWorkflow;
    window.cancelWorkflow = cancelWorkflow;
    window.startNewSession = startNewSession;
    window.onSwitchSession = onSwitchSession;
    window.exportActiveSession = exportActiveSession;
    window.clearAllSavedSessions = clearAllSavedSessions;

    // Universal CSP-safe Event Delegation and Action Dispatcher
    const ACTION_MAP = {
      switchTab: function(arg) { switchTab(arg); },
      openChatInterface: function(arg) { openChatInterface(arg); },
      openChatWithSelectedModel: function() { openChatWithSelectedModel(); },
      setChatMode: function(arg) { setChatMode(arg); },
      openChatModelPicker: function() { openChatModelPicker(); },
      closeModelPicker: function() { closeModelPicker(); },
      refreshRouterModels: function() { refreshRouterModels(); },
      startTaskPrompt: function() { startTaskPrompt(); },
      closeNewTaskModal: function() { closeNewTaskModal(); },
      submitInlineNewTask: function() { submitInlineNewTask(); },
      submitChatMessage: function() { submitChatMessage(); },
      clearChatMessages: function() { clearChatMessages(); },
      startNewSession: function() { startNewSession(); },
      exportActiveSession: function() { exportActiveSession(); },
      clearAllSavedSessions: function() { clearAllSavedSessions(); },
      toggleDictation: function() { toggleDictation(); },
      toggleVoiceModeFromChat: function() { toggleVoiceModeFromChat(); },
      fillChatPrompt: function(arg) { fillChatPrompt(arg); },
      toggleQuickHub: function() { toggleQuickHub(); },
      toggleChatHeader: function() { toggleChatHeader(); },
      togglePipelineGraph: function() { togglePipelineGraph(); },
      requestRefresh: function() { requestRefresh(); },
      openStepModal: function(arg) { openStepModal(arg); },
      closeModal: function() { closeModal(); },
      openRolesJson: function() { openRolesJson(); },
      autoAssignRoles: function(arg) { autoAssignRoles(arg); },
      toggleVoiceMode: function() { toggleVoiceMode(); },
      toggleVoiceTalk: function() { toggleVoiceTalk(); },
      toggleVoiceMute: function() { toggleVoiceMute(); },
      checkMicLevel: function() { checkMicLevel(); },
      copyLatestAudioPath: function() { copyLatestAudioPath(); },
      openRecordingsFolder: function() { openRecordingsFolder(); },
      listAudioDevices: function() { listAudioDevices(); },
      focusLiveModelSelect: function() { focusLiveModelSelect(); },
      focusApiKeysSection: function() { focusApiKeysSection(); },
      saveSessionSettings: function() { saveSessionSettings(); },
      pauseWorkflow: function() { pauseWorkflow(); },
      resumeWorkflow: function() { resumeWorkflow(); },
      cancelWorkflow: function() { cancelWorkflow(); }
    };

    function parseArg(tok, el) {
      tok = (tok || '').trim();
      if (!tok) return undefined;
      if (tok === 'this.checked') return el ? !!el.checked : true;
      if (tok === 'this.value') return el ? el.value : '';
      if (tok.match(/^['"].*['"]$/)) return tok.slice(1, -1);
      if (!isNaN(Number(tok))) return Number(tok);
      if (tok === 'true') return true;
      if (tok === 'false') return false;
      return tok;
    }

    function executeRawOnclick(raw, el) {
      if (!raw) return;
      const clean = raw.trim();
      const match = clean.match(/^\s*([a-zA-Z0-9_$]+)\s*\((.*)\)\s*;?\s*$/);
      if (match) {
        const fnName = match[1];
        const rawArgs = (match[2] || '').trim();
        const args = [];
        if (rawArgs.length > 0) {
          const tokens = rawArgs.split(/\s*,\s*/);
          for (let i = 0; i < tokens.length; i++) {
            args.push(parseArg(tokens[i], el));
          }
        }
        if (typeof window[fnName] === 'function') {
          try {
            window[fnName].apply(window, args);
            return;
          } catch (err) {
            console.warn('[Webview Action]', fnName, err);
          }
        }
        if (ACTION_MAP[fnName]) {
          try {
            ACTION_MAP[fnName].apply(null, args);
            return;
          } catch (err) {
            console.warn('[Webview ActionMap]', fnName, err);
          }
        }
      }
    }

    // Global click listener guarantees execution even if VS Code webview CSP blocks inline onclick
    document.addEventListener('click', function(e) {
      // 1. Data-action
      const actionEl = e.target.closest('[data-action]');
      if (actionEl) {
        const action = actionEl.getAttribute('data-action');
        const param = actionEl.getAttribute('data-param');
        if (ACTION_MAP[action]) {
          ACTION_MAP[action](param, actionEl);
          e.preventDefault();
          return;
        }
      }

      // 2. Data-tab
      const tabEl = e.target.closest('[data-tab]');
      if (tabEl) {
        const tab = tabEl.getAttribute('data-tab');
        switchTab(tab);
        e.preventDefault();
        return;
      }

      // 3. Data-prompt
      const promptEl = e.target.closest('[data-prompt]');
      if (promptEl) {
        fillChatPrompt(promptEl.getAttribute('data-prompt'));
        e.preventDefault();
        return;
      }

      // 4. Inline onclick fallback (safely invoked via JS delegation)
      const onclickEl = e.target.closest('[onclick]');
      if (onclickEl && !actionEl) {
        // If native inline onclick was already fired by browser, do not double-invoke
        if (typeof onclickEl.onclick === 'function') {
          return;
        }
        const raw = onclickEl.getAttribute('onclick');
        if (raw) {
          executeRawOnclick(raw, onclickEl);
        }
      }
    });

    // Delegated change listener (dropdowns & selects)
    document.addEventListener('change', function(e) {
      if (e.target && e.target.id === 'chatQuickModelDropdown') {
        onChatQuickModelChange(e.target.value);
      } else if (e.target && e.target.id === 'liveModelSelect') {
        onLiveModelChange(e.target.value);
      }
    });

    // Delegated input listener (search inputs & range sliders)
    document.addEventListener('input', function(e) {
      if (e.target && e.target.id === 'modelSearchInput') {
        onModelSearchInput();
      } else if (e.target && e.target.id === 'roleFilterInput') {
        filterRoles();
      } else if (e.target && e.target.id === 'tempSlider') {
        onTempSlider(parseFloat(e.target.value));
      }
    });

    // Delegated keydown listener (Enter / Ctrl+Enter)
    document.addEventListener('keydown', function(e) {
      if (e.target && e.target.id === 'chatMessageInput') {
        onChatInputKeyDown(e);
      } else if (e.target && e.target.id === 'newTaskGoalInput' && e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
        submitInlineNewTask();
      }
    });


    // Load initial embedded state immediately so all buttons and UI are active on 1st frame
    try {
      const initScript = document.getElementById('initial-state');
      if (initScript && initScript.textContent) {
        const initData = JSON.parse(initScript.textContent);
        applyState(initData);
      }
    } catch (err) {
      console.warn('[Webview] Could not parse initial state:', err);
    }

    // Handshake: signal to extension that webview is fully ready to receive state
    try {
      vscode.postMessage({ command: 'ready' });
    } catch {
      /* ignore */
    }