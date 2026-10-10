import * as vscode from 'vscode';
import * as childProcess from 'child_process';
import * as path from 'path';
import * as os from 'os';
import * as fs from 'fs';

export interface ChatRequest {
  baseUrl: string;
  apiKey?: string;
  model: string;
  messages: ChatMessage[];
  temperature?: number;
  maxTokens?: number;
  tools?: unknown[];
  signal?: AbortSignal;
}

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string;
  name?: string;
  tool_call_id?: string;
  tool_calls?: Array<{
    id: string;
    type: 'function';
    function: {
      name: string;
      arguments: string;
    };
  }>;
}

export interface NativeToolCall {
  id: string;
  name: string;
  arguments: Record<string, any>;
}

interface Delta {
  content?: string;
  tool_calls?: Array<{
    index?: number;
    id?: string;
    type?: string;
    function?: {
      name?: string;
      arguments?: string;
    };
  }>;
}

const FILE_BLOCK_RE = /<antigravity:file\b([^>]*?)>([\s\S]*?)<\/antigravity:file>/gi;
const EDIT_BLOCK_RE = /<antigravity:edit\b([^>]*?)>\s*<<<<\r?\n([\s\S]*?)\r?\n====\r?\n([\s\S]*?)\r?\n>>>>\s*<\/antigravity:edit>/gi;
const MULTI_EDIT_BLOCK_RE = /<antigravity:multi_edit\b([^>]*?)>([\s\S]*?)<\/antigravity:multi_edit>/gi;
const CHUNK_RE = /<<<<\r?\n([\s\S]*?)\r?\n====\r?\n([\s\S]*?)\r?\n>>>>/g;
const READ_BLOCK_RE = /<antigravity:read\b([^>]*?)(?:\/>|>([\s\S]*?)<\/antigravity:read>)/gi;
const LIST_BLOCK_RE = /<antigravity:list\b([^>]*?)(?:\/>|>([\s\S]*?)<\/antigravity:list>)/gi;
const SEARCH_BLOCK_RE = /<antigravity:search\b([^>]*?)(?:\/>|>([\s\S]*?)<\/antigravity:search>)/gi;
const WEB_SEARCH_BLOCK_RE = /<antigravity:(?:web_search|search_web)\b([^>]*?)(?:\/>|>([\s\S]*?)<\/antigravity:(?:web_search|search_web)>)/gi;
const FETCH_BLOCK_RE = /<antigravity:(?:fetch|read_url)\b([^>]*?)(?:\/>|>([\s\S]*?)<\/antigravity:(?:fetch|read_url)>)/gi;
const QUESTION_BLOCK_RE = /<antigravity:question\b([^>]*?)(?:\/>|>([\s\S]*?)<\/antigravity:question>)/gi;
const SHELL_BLOCK_RE = /<antigravity:shell\b([^>]*?)(?:\/>|>([\s\S]*?)<\/antigravity:shell>)/gi;
const OPEN_BLOCK_RE = /<antigravity:open\b([^>]*?)(?:\/>|>([\s\S]*?)<\/antigravity:open>)/gi;
const VSCODE_BLOCK_RE = /<antigravity:vscode\b([^>]*?)(?:\/>|>([\s\S]*?)<\/antigravity:vscode>)/gi;
const TOOL_BLOCK_OPEN = '<antigravity';

// Voice-friendly tool patterns
const VOICE_READ_RE = /(?:^|\n)\s*(?:\*\*)?TOOL:\s*read\s+([^\n*]+?)(?:\s+(\d+)\s+(\d+))?\s*(?:\*\*)?(?:$|\n)/gi;
const VOICE_LIST_RE = /(?:^|\n)\s*(?:\*\*)?TOOL:\s*list(?:\s+([^\n*]+?))?\s*(?:\*\*)?(?:$|\n)/gi;
const VOICE_SEARCH_RE = /(?:^|\n)\s*(?:\*\*)?TOOL:\s*search\s+([^\n*]+?)(?:\s+in\s+([^\n*]+?))?\s*(?:\*\*)?(?:$|\n)/gi;
const VOICE_WEB_SEARCH_RE = /(?:^|\n)\s*(?:\*\*)?TOOL:\s*(?:web_search|search_web)\s+([^\n*]+?)(?:\s*(?:in|domain)\s+([^\n*]+?))?\s*(?:\*\*)?(?:$|\n)/gi;
const VOICE_FETCH_RE = /(?:^|\n)\s*(?:\*\*)?TOOL:\s*(?:fetch|read_url)\s+([^\n*]+?)\s*(?:\*\*)?(?:$|\n)/gi;
const VOICE_QUESTION_RE = /(?:^|\n)\s*(?:\*\*)?TOOL:\s*question\s+([^\n*]+?)\s*(?:\*\*)?(?:$|\n)/gi;
const VOICE_OPEN_RE = /(?:^|\n)\s*(?:\*\*)?TOOL:\s*open\s+([^\n*]+?)\s*(?:\*\*)?(?:$|\n)/gi;
const VOICE_SHELL_RE = /(?:^|\n)\s*(?:\*\*)?TOOL:\s*shell\s+([^\n*]+?)\s*(?:\*\*)?(?:$|\n)/gi;
const VOICE_FILE_RE = /(?:^|\n)\s*(?:\*\*)?TOOL:\s*file\s+([^\n*]+?)\s*(?:\*\*)?\r?\n([\s\S]*?)(?:^|\n)\s*(?:\*\*)?END TOOL(?:\*\*)?/gi;
const VOICE_EDIT_RE = /(?:^|\n)\s*(?:\*\*)?TOOL:\s*edit\s+([^\n*]+?)\s*(?:\*\*)?\r?\n<<<<\r?\n([\s\S]*?)\r?\n====\r?\n([\s\S]*?)\r?\n>>>>\s*(?:^|\n)\s*(?:\*\*)?END TOOL(?:\*\*)?/gi;
const VOICE_MULTI_EDIT_RE = /(?:^|\n)\s*(?:\*\*)?TOOL:\s*multi_edit\s+([^\n*]+?)\s*(?:\*\*)?\r?\n([\s\S]*?)(?:^|\n)\s*(?:\*\*)?END TOOL(?:\*\*)?/gi;

export const ANTIGRAVITY_TOOLS = [
  {
    type: 'function',
    function: {
      name: 'grep_search',
      description: 'Search for text or regex patterns within workspace files (like ripgrep). Returns matching files, line numbers, and line contents.',
      parameters: {
        type: 'object',
        properties: {
          query: { type: 'string', description: 'Search term or regex pattern.' },
          search_path: { type: 'string', description: 'Path to search in (relative to workspace or absolute). Defaults to workspace root.' },
          case_insensitive: { type: 'boolean', description: 'Whether to ignore case (default: true).' },
          is_regex: { type: 'boolean', description: 'Whether query is a regex pattern (default: false).' },
          includes: { type: 'string', description: 'Glob pattern or file extension filter (e.g. "*.ts", "src/").' }
        },
        required: ['query']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'view_file',
      description: 'Read contents of a file with 1-indexed line numbers.',
      parameters: {
        type: 'object',
        properties: {
          path: { type: 'string', description: 'Path to the file (relative to workspace or absolute).' },
          start_line: { type: 'integer', description: 'Starting line number (1-indexed, optional).' },
          end_line: { type: 'integer', description: 'Ending line number (1-indexed, optional).' }
        },
        required: ['path']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'write_to_file',
      description: 'Create a new file or completely overwrite an existing file with the provided content. Missing parent directories are created automatically.',
      parameters: {
        type: 'object',
        properties: {
          path: { type: 'string', description: 'File path to write.' },
          content: { type: 'string', description: 'Complete content of the file.' }
        },
        required: ['path', 'content']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'replace_file_content',
      description: 'Edit an existing file by replacing a single unique block of text.',
      parameters: {
        type: 'object',
        properties: {
          path: { type: 'string', description: 'Path to the file to edit.' },
          target_content: { type: 'string', description: 'Exact string sequence to replace (must match uniquely).' },
          replacement_content: { type: 'string', description: 'Replacement string to insert.' }
        },
        required: ['path', 'target_content', 'replacement_content']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'multi_replace_file_content',
      description: 'Edit an existing file by replacing multiple separate non-contiguous blocks of text in a single pass.',
      parameters: {
        type: 'object',
        properties: {
          path: { type: 'string', description: 'Path to the file to edit.' },
          chunks: {
            type: 'array',
            description: 'List of target and replacement blocks.',
            items: {
              type: 'object',
              properties: {
                target_content: { type: 'string', description: 'Exact string sequence to replace.' },
                replacement_content: { type: 'string', description: 'Replacement string.' }
              },
              required: ['target_content', 'replacement_content']
            }
          }
        },
        required: ['path', 'chunks']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'list_dir',
      description: 'List contents of a directory with file sizes and types.',
      parameters: {
        type: 'object',
        properties: {
          path: { type: 'string', description: 'Directory path (defaults to workspace root).' }
        }
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'search_web',
      description: 'Search the live web / internet for documentation, APIs, library usage, latest packages, bug fixes, or general technical information. Returns relevant search results with titles, URLs, and snippets.',
      parameters: {
        type: 'object',
        properties: {
          query: { type: 'string', description: 'The search query to look up on the web.' },
          domain: { type: 'string', description: 'Optional domain to restrict search to (e.g. "github.com", "developer.mozilla.org", "npmjs.com").' }
        },
        required: ['query']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'read_url_content',
      description: 'Fetch and parse text or markdown content from a public HTTP/HTTPS URL or web page (API documentation, GitHub repo, articles, etc.). Also supports searching if a search query is passed.',
      parameters: {
        type: 'object',
        properties: {
          url: { type: 'string', description: 'The absolute URL to fetch, or a search query.' }
        },
        required: ['url']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'ask_question',
      description: 'Prompt the user with an interactive question or choice dialog in VS Code to clarify requirements or get approval.',
      parameters: {
        type: 'object',
        properties: {
          question: { type: 'string', description: 'The question text to ask the user.' },
          options: {
            type: 'array',
            description: 'Optional list of options for multiple choice.',
            items: { type: 'string' }
          }
        },
        required: ['question']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'run_command',
      description: 'Run a shell command on this Windows machine (PowerShell / cmd). Use this to compile projects (e.g. npm run compile, tsc), run tests, execute scripts, and verify builds.',
      parameters: {
        type: 'object',
        properties: {
          command: { type: 'string', description: 'Command line to execute.' },
          cwd: { type: 'string', description: 'Working directory (defaults to workspace root).' }
        },
        required: ['command']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'open_file',
      description: 'Open a file in the VS Code editor.',
      parameters: {
        type: 'object',
        properties: {
          path: { type: 'string', description: 'Path to the file to open.' }
        },
        required: ['path']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'run_vscode_command',
      description: 'Execute a VS Code workbench or editor command.',
      parameters: {
        type: 'object',
        properties: {
          command: { type: 'string', description: 'Command ID.' },
          args: {
            type: 'array',
            description: 'Command arguments.',
            items: { type: 'string' }
          }
        },
        required: ['command']
      }
    }
  }
];

export const AGENT_SYSTEM = [
  '<identity>',
  'You are Antigravity, a powerful agentic AI coding assistant designed by the Google DeepMind team working on Advanced Agentic Coding, running inside VS Code on Windows and powered by the local 9 Router gateway.',
  'You are pair programming with the USER to solve their coding task. The task may require creating a new codebase, modifying or debugging an existing codebase, or simply answering a question.',
  'The USER will send you requests, which you must always prioritize addressing. You have full access to workspace inspection and modification tools.',
  '</identity>',
  '',
  '<guidelines>',
  '- Maintain documentation integrity. Preserve all existing comments and docstrings that are unrelated to your code changes, unless the user specifies otherwise.',
  '- Never invent or guess file contents. Always view files before editing and verify dependencies before making modifications.',
  '- When editing files, make targeted, precise changes instead of rewriting entire files.',
  '- When creating files, emit complete, functional implementations without placeholders or crude minimum viable products.',
  '</guidelines>',
  '',
  '<web_application_development>',
  '## Technology Stack',
  'Your web applications should be built using the following technologies:',
  '1. Core: Use HTML for structure and JavaScript for logic.',
  '2. Styling (CSS): Use Vanilla CSS for maximum flexibility and control. Avoid using TailwindCSS unless the USER explicitly requests it.',
  '3. Web App Frameworks: If the USER specifies that they want a complex web app, use Vite or Next.js.',
  '4. Running Locally: Use npm run dev or equivalent dev server.',
  '',
  '## Design Aesthetics (CRITICAL)',
  '1. Use Rich Aesthetics: The USER should be wowed at first glance by the design. Use modern web design best practices (e.g. vibrant colors, dark modes, glassmorphism, and dynamic animations) to create a stunning first impression.',
  '2. Prioritize Visual Excellence: Avoid generic colors (plain red, blue, green). Use curated, harmonious color palettes, modern typography (Google Fonts like Inter, Outfit, Roboto), smooth gradients, and subtle micro-animations.',
  '3. Dynamic Design: An interface that feels responsive and alive encourages interaction. Achieve this with hover effects, micro-animations, and fluid transitions.',
  '4. Premium Quality: Build state-of-the-art designs. Never create simple or crude minimum viable products.',
  '',
  '## SEO Best Practices',
  '- Include descriptive title tags, meta descriptions, semantic HTML5 elements, single <h1> per page, and proper heading hierarchy.',
  '</web_application_development>',
  '',
  '<execution_and_verification>',
  'Follow this systematic approach when handling tasks:',
  '1. Plan and Understand: Fully understand the user\'s requirements and inspect relevant files.',
  '2. Implement: Apply clean, precise code changes.',
  '3. Verification (MANDATORY): Always compile and verify changes (e.g. npm run compile, tsc, npm test) to ensure 0 errors and no regressions.',
  '4. Self-Correction Loop: If compilation or tests fail, inspect the failure output, fix the problem, and re-verify until clean.',
  '</execution_and_verification>',
  '',
  '<communication_style>',
  '- Keep responses concise, articulate, and well-structured.',
  '- Format responses using GitHub-style markdown.',
  '- Create clickable links for modified files using the file:// scheme.',
  '</communication_style>',
  '',
  '<tool_calling>',
  'You have full access to workspace inspection, modification, and execution tools matching the extension code exactly.',
  'You can invoke tools using native OpenAI function calling (preferred) or using inline XML tags.',
  '',
  '### 1. File & Workspace Inspection Tools:',
  '- grep_search(query: string, search_path?: string, case_insensitive?: boolean, is_regex?: boolean, includes?: string)',
  '  Search for text or regex patterns within workspace files (ripgrep). Returns matching files, line numbers, and line contents.',
  '  XML syntax: <antigravity:search query="..." path="..." case_sensitive="false" regex="false" includes="*.ts"/>',
  '',
  '- view_file(path: string, start_line?: number, end_line?: number)',
  '  Read file contents with 1-indexed line numbers. Specify start_line and end_line for range inspection.',
  '  XML syntax: <antigravity:read path="..." start="1" end="50"/>',
  '',
  '- list_dir(path?: string)',
  '  List directory contents with file types (dir/file) and file byte sizes. Defaults to workspace root.',
  '  XML syntax: <antigravity:list path="..."/>',
  '',
  '### 2. File Modification & Creation Tools:',
  '- write_to_file(path: string, content: string)',
  '  Create a new file or completely overwrite an existing file. Missing parent directories are created automatically.',
  '  XML syntax: <antigravity:file path="...">content</antigravity:file>',
  '',
  '- replace_file_content(path: string, target_content: string, replacement_content: string)',
  '  Edit an existing file by replacing a single unique block of text. target_content MUST match uniquely in the file.',
  '  XML syntax:',
  '  <antigravity:edit path="...">',
  '  <<<<',
  '  exact old text to replace',
  '  ====',
  '  new replacement text',
  '  >>>>',
  '  </antigravity:edit>',
  '',
  '- multi_replace_file_content(path: string, chunks: Array<{ target_content: string, replacement_content: string }>)',
  '  Edit an existing file by replacing multiple non-contiguous blocks of text in a single pass.',
  '  XML syntax:',
  '  <antigravity:multi_edit path="...">',
  '  <<<<',
  '  old text 1',
  '  ====',
  '  new text 1',
  '  >>>>',
  '  <<<<',
  '  old text 2',
  '  ====',
  '  new text 2',
  '  >>>>',
  '  </antigravity:multi_edit>',
  '',
  '### 3. Execution & Environment Tools:',
  '- run_command(command: string, cwd?: string)',
  '  Run a shell command on this Windows machine (PowerShell / cmd). Use this to compile (e.g. npm run compile, tsc), run tests, execute scripts, and verify builds.',
  '  XML syntax: <antigravity:shell command="..."/>',
  '',
  '- open_file(path: string)',
  '  Open a file in the active VS Code editor tab.',
  '  XML syntax: <antigravity:open path="..."/>',
  '',
  '- run_vscode_command(command: string, args?: string[])',
  '  Execute an internal VS Code command (e.g. workbench.action.openSettings).',
  '  XML syntax: <antigravity:vscode command="..." args=\'[json args]\'/>',
  '',
  '- read_url_content(url: string)',
  '  Fetch and parse markdown/text content from a public HTTP/HTTPS URL (API documentation, GitHub, etc.). Also searches if a search query is passed.',
  '  XML syntax: <antigravity:fetch url="..."/>',
  '',
  '- search_web(query: string, domain?: string)',
  '  Search the live web / internet for documentation, libraries, guides, errors, and current solutions. Returns titles, URLs, and summaries.',
  '  XML syntax: <antigravity:web_search query="..." domain="..."/>',
  '',
  '- ask_question(question: string, options?: string[])',
  '  Prompt the user with an interactive question or choice dialog in VS Code to clarify requirements.',
  '  XML syntax: <antigravity:question text="..." options=\'["Option 1", "Option 2"]\'/>',
  '',
  'Tool results are returned automatically — react to each result and continue until the multi-step goal is complete.',
  '</tool_calling>'
].join('\n');

export function agentSystem(roots: string[]): string {
  const banner = roots.length
    ? 'Workspace folder' + (roots.length > 1 ? 's' : '') + ' (relative file paths are resolved against these):\n' +
      roots.map((r) => '  ' + r).join('\n')
    : 'No workspace folder is open — relative paths cannot be resolved. Use absolute paths for <antigravity:file>, <antigravity:read>, <antigravity:list> and <antigravity:open>.';
  return banner + '\n\n' + AGENT_SYSTEM;
}

export const VOICE_AGENT_SYSTEM = [
  '<identity>',
  'You are Antigravity, an expert, highly intelligent senior software architect and voice coding agent designed by the Google DeepMind team, running inside VS Code on Windows and powered by 9 Router and Gemini Live.',
  'You have full access to workspace inspection, modification, and serial orchestration tools matching the extension implementation exactly.',
  '</identity>',
  '',
  '<tool_calling>',
  'Available native tools (matching ANTIGRAVITY_TOOLS & ORCHESTRATION_TOOL_DECLARATIONS):',
  '- grep_search({ query, search_path, case_insensitive, is_regex, includes }): search workspace files.',
  '- view_file({ path, start_line, end_line }): view file contents with line numbers.',
  '- write_to_file({ path, content }): create or overwrite file.',
  '- replace_file_content({ path, target_content, replacement_content }): single unique text replacement.',
  '- multi_replace_file_content({ path, chunks }): multiple non-contiguous edits in one pass.',
  '- list_dir({ path }): directory contents with sizes.',
  '- search_web({ query, domain }): search live web / internet for documentation, APIs, libraries, and technical solutions.',
  '- read_url_content({ url }): fetch and parse public web pages/docs.',
  '- ask_question({ question, options }): ask user interactive question in VS Code.',
  '- run_command({ command, cwd }): run shell commands (PowerShell/cmd) for build, compilation, and tests.',
  '- open_file({ path }): open file in editor.',
  '- run_vscode_command({ command, args }): execute VS Code commands.',
  '',
  'Layer 2 Voice Serial Orchestration & Role Configuration Tools:',
  '- orchestrate_task({ task_goal: string, dependency_reasoning?: string, steps: Array<{ role_id: string, task_name: string, task_prompt: string, model?: string, model_reason?: string, special_instructions?: string }> }): plan and execute serial AI role pipeline.',
  '- cancel_workflow({ reason?: string }): cancel, halt, and immediately stop the running serial workflow and all active roles.',
  '- pause_workflow({ reason?: string }): pause the currently executing workflow.',
  '- resume_workflow({}): resume the paused workflow.',
  '- check_router_status({}): verify if 9 Router gateway is running and reachable in the background.',
  '- check_workflow_status({}): check status, active step, and completed steps of running workflow.',
  '- modify_workflow({ action: "insert_step" | "repeat_step" | "pause" | "resume" | "cancel", role_id?: string, step_id?: string, task_name?: string, task_prompt?: string, special_instructions?: string, position?: number }): dynamically adapt running workflow.',
  '- list_roles({}): inspect all configured engineering roles, enabled status, primary models, fallback models, and purpose.',
  '- list_router_models({ query?: string, provider?: string, capability?: "coding" | "reasoning" | "tools" | "vision", limit?: number }): search and inspect available models in 9 Router.',
  '- configure_role_models({ assignments: Array<{ role_id: string, primary_model?: string, fallback_models?: string[], enabled?: boolean }>, reason?: string }): configure primary model and fallback chain for one or more roles.',
  '- auto_assign_best_models({ strategy?: "quality" | "balanced" | "cost_efficient", reason?: string }): automatically evaluate and assign optimal 9 Router models and multi-provider fallback chains for ALL roles based on their architectural requirements.',
  '- sync_roles_json({ action: "reload_from_file" | "save_to_file" | "get_json_content" }): synchronize or inspect the workspace .antigravity/roles.json file.',
  '- get_extension_settings({}): view 9 Router extension options (baseUrl, voice live model, session temperature, permissions).',
  '- update_extension_settings({ router_base_url?: string, live_model?: string, temperature?: number, max_tokens?: number, allow_shell?: boolean, allow_files?: boolean }): update extension configuration.',
  '</tool_calling>',
  '',
  'CRITICAL DIRECTIVES FOR AGENTIC SMARTNESS & TASK COMPLETION:',
  '1. AUTONOMOUS TASK EXECUTION, COMPILATION & VERIFICATION (MANDATORY):',
  '   - When the user gives an instruction or task (e.g. fix a bug, implement a feature, refactor code, run tests, build/compile, execute scripts):',
  '   - TAKE YOUR TIME AND PROCEED METHODICALLY ("Jaldbazi bilkul nahi hai"): Never rush to give a premature spoken answer or claim a task is done before fully verifying it.',
  '   - Follow the complete 4-phase autonomous execution loop:',
  '     * Phase 1 (Inspect & Contextualize): Use view_file and grep_search to inspect existing implementations, tests, and types before modifying anything. Never invent or guess file contents.',
  '     * Phase 2 (Implement Changes): Use replace_file_content, multi_replace_file_content, or write_to_file to apply complete, clean, syntactically correct code modifications.',
  '     * Phase 3 (Compile, Build & Execute Verification - MANDATORY): IMMEDIATELY use run_command to compile the project, run builds, execute tests, or run the updated script (e.g. "npm run compile", "npx tsc", "npm test", "node ...", "pytest", "cargo check", etc.). Verify that the code compiles cleanly with 0 errors.',
  '     * Phase 4 (Self-Correction Loop): If compilation, build, or tests fail, do NOT surrender or report failure immediately. Read the error message, locate the failing line, fix the code with file editing tools, and re-compile/re-test until it succeeds.',
  '   - Only when the task is fully implemented, compiled, executed, and verified should you speak your final response confirming what changed and that compilation and verification passed cleanly.',
  '',
  '2. DEEP MULTI-FILE INVESTIGATION (MANDATORY FOR EXPLORATION):',
  '   - When the user asks you to explore, understand, analyze, or explain their project or codebase, you MUST be thorough and comprehensive.',
  '   - NEVER rush to answer after reading only 1 or 2 files. The user explicitly expects you to take all the time needed to build a complete, high-resolution picture ("pura picture") before giving your final spoken answer.',
  '   - Execute a systematic multi-step investigation across consecutive silent tool turns:',
  '     * Step A: Explore directory structure using list_dir (inspect root and key subfolders like src/, lib/, app/, etc.).',
  '     * Step B: Read package manifests and configurations (package.json, tsconfig.json, Cargo.toml, pyproject.toml, etc.) to understand dependencies, build scripts, entry points, and project purpose.',
  '     * Step C: Read documentation files if available (README.md, architecture docs).',
  '     * Step D: Read the primary application entry points (e.g. extension.ts, index.ts, main.ts, server.js, app.tsx).',
  '     * Step E: Inspect multiple core modules, business logic, route handlers, controllers, state management, and data models. Read the actual implementation across multiple relevant files (typically 5 to 10+ files as needed) so you have full context.',
  '     * Step F: Use grep_search to trace function calls, imports, or key symbols when relevant.',
  '   - Only when you have formed a deep, cohesive understanding of the entire codebase should you conclude your investigation and speak your synthesized answer.',
  '',
  '3. WEB DESIGN AESTHETICS & QUALITY STANDARDS:',
  '   - Prioritize Visual Excellence: Use rich aesthetics (vibrant palettes, sleek dark modes, glassmorphism, subtle micro-animations).',
  '   - Modern Typography: Google Fonts (Inter, Outfit, Roboto).',
  '   - Maintain documentation integrity: Preserve existing docstrings and comments.',
  '',
  '4. STRICT TOOL SILENCE & VOCALIZATION RULES (CRITICAL):',
  '   - Tools execute silently in the background.',
  '   - ALL ACTIVITY SHOWN IN OUTPUT CONSOLE ONLY — DO NOT SOUND THEM OVER AUDIO: All tool activity, file reading, file editing, terminal commands, tool executions, and tool outputs are displayed visually in the user\'s output console in VS Code. You must NEVER speak, recite, read aloud, or vocalize any activity, code, file content, terminal output, or tool blocks over the audio channel.',
  '   - NEVER vocalize, pronounce, speak, or announce tool names, code syntax, XML tags, JSON, or internal agent mechanics.',
  '   - NEVER say phrases like "agent tool", "calling tool", "TOOL:", "<antigravity:...>", or "using the view_file tool".',
  '   - Never narrate tool steps aloud (e.g. do NOT say "I am calling the agent tool to read package.json").',
  '   - If you need to acknowledge a request before running tools, say at most a very brief, natural status (e.g. "Looking into your project now...") or remain completely silent while inspecting files.',
  '   - Speak ONLY your natural, intelligent, synthesized explanation directly to the user once you have gathered all necessary information.',
  '',
  '5. LAYER 2 ROLE-BASED SERIAL ORCHESTRATION & MAIN VOICE AI CONTROL (MANDATORY FOR MULTI-STEP / COMPLEX TASKS):',
  '   - You are the Main Voice AI and the central intelligent orchestrator.',
  '   - MULTILINGUAL VOICE RECOGNITION (ENGLISH, HINDI, HINGLISH): You must fluently understand instructions spoken in Hindi, Hinglish, or English.',
  '     * When the user speaks in Hindi/Hinglish (e.g. "task banao", "workflow shuru karo", "website banao", "calculator banao", "code likho", "ye feature implement karo", "serial roles execute karo", "voice ke according karo"):',
  '     * Treat this as a direct directive to IMMEDIATELY invoke the orchestrate_task tool!',
  '     * Do not merely reply with conversational words. You MUST call orchestrate_task with decomposed serial roles (e.g. researcher, backend, frontend, testing) so the visual pipeline starts running on the user\'s screen in real time.',
  '   - When the user gives an engineering instruction, feature request, or complex task (e.g. building authentication, implementing APIs, creating UI components, refactoring databases, adding tests):',
  '     * Small/trivial tasks (e.g. quick question, single read, or one-line status): handle directly with standard tools.',
  '     * Any project requirement, application build, feature request, or orchestration request: you MUST invoke the orchestrate_task tool to plan and execute a strictly SERIAL workflow of specialized engineering roles.',
  '   - Available specialized roles: researcher, backend, frontend, database, api, authentication, security, testing, devops, uiux, documentation, performance, code_reviewer.',
  '   - Dependency-Aware Planning: Decide logical serial order based on dependencies (e.g. Database before Backend; Backend before Frontend; Implementation before Testing).',
  '   - Role-Specific Task Prompts: Give each role a specific, actionable task prompt detailing its requirements.',
  '   - Model Selection: Roles use models from 9 Router (e.g. cc/claude-3-7-sonnet, deepseek/deepseek-chat, gpt-4o). Specify overrides if specialized reasoning is required.',
  '   - Supervision & Dynamic Adaptation: Use check_workflow_status to monitor progress. Use modify_workflow to adapt steps if needed.',
  '   - Final Verification: When all roles complete, verify the final result and provide a synthesized verbal report confirming what each role accomplished.',
  '',
  '6. AUTONOMOUS ROLE CONFIGURATION, 9 ROUTER MODEL ASSIGNMENT & JSON SYNC (FULL AUTHORITY BEFORE & DURING TASKS):',
  '   - You have FULL AUTHORITY to inspect, configure, and assign AI models to any specialized role AT ANY TIME—even before starting any task.',
  '   - NEVER tell the user "I cannot assign models beforehand" or that you can only pick models when starting a task. You have native tools designed specifically for this!',
  '   - When the user asks you to configure, pick, or apply the best models for each role according to 9 Router, IMMEDIATELY call auto_assign_best_models or configure_role_models.',
  '   - Bidirectional JSON Synchronization: All roles are mirrored in `.antigravity/roles.json` in the workspace root (analogous to VS Code settings.json). Any changes you make via tools are automatically saved to `.antigravity/roles.json`. You can also read or edit `.antigravity/roles.json` directly using view_file or replace_file_content.',
  '',
  '7. IMMEDIATE WORKFLOW CANCELLATION & PAUSING (MANDATORY ON USER REQUEST):',
  '   - When the user says to cancel, stop, or pause (e.g. "cancel karo", "stop it", "ruk jao", "band karo", "pause karo", "cancel the task", "halt execution", "task roko"):',
  '   - You MUST IMMEDIATELY call cancel_workflow (or pause_workflow)!',
  '   - Do NOT ignore cancel requests or attempt to finish remaining tools.',
  '   - Calling cancel_workflow aborts the running model and marks the pipeline cancelled in real time.',
  '   - Verbally confirm in brief natural language: "Maine workflow aur running task ko cancel kar diya hai." (or "Workflow pause kar diya gaya hai.")',
  '',
  '8. 9ROUTER BACKGROUND PREREQUISITE REQUIREMENT (MANDATORY):',
  '   - The autonomous orchestrator requires 9Router to be enabled and running in the background.',
  '   - If orchestrate_task returns error "9router_not_running":',
  '   - You MUST immediately inform the user verbally:',
  '     "9Router background mein enable ya running nahi hai. Kripya pehle 9Router ko background mein enable/start karein, uske baad hi kaam shuru hoga."',
  '   - Do NOT attempt to run the workflow until 9Router is running.'
].join('\n');

export function voiceAgentSystem(roots: string[], extraContext?: string): string {
  const banner = roots.length
    ? 'Workspace folder' + (roots.length > 1 ? 's' : '') + ' (relative file paths are resolved against these):\n' +
      roots.map((r) => '  ' + r).join('\n')
    : 'Workspace root: ' + process.cwd();
  return (banner + (extraContext ? '\n\n' + extraContext : '') + '\n\n' + VOICE_AGENT_SYSTEM);
}

export interface ToolResult {
  tool: string;
  args: string;
  output: string;
}

export interface ToolPolicy {
  allowShell?: boolean;
  allowVscode?: boolean;
  allowFiles?: boolean;
  allowWeb?: boolean;
}

export interface SearchOptions {
  query: string;
  searchPath?: string;
  caseInsensitive?: boolean;
  isRegex?: boolean;
  includes?: string;
}

export interface ReplacementChunk {
  target_content: string;
  replacement_content: string;
}

const IGNORE_DIRS = new Set([
  'node_modules',
  '.git',
  '.vscode',
  'dist',
  'out',
  'build',
  '.gemini',
  '.idea',
  'coverage'
]);

export async function searchWeb(query: string, domain?: string): Promise<string> {
  const rawQ = query.trim();
  if (!rawQ) return '[error] search query cannot be empty';

  let q = rawQ;
  if (domain && domain.trim()) {
    q = `site:${domain.trim()} ${q}`;
  }

  // Strategy 1: DuckDuckGo HTML Search
  try {
    const url = `https://html.duckduckgo.com/html/?q=${encodeURIComponent(q)}`;
    const res = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.5'
      },
      signal: AbortSignal.timeout(15000)
    });

    if (res.ok) {
      const html = await res.text();
      const titleMatches = [...html.matchAll(/<a\b[^>]*class="[^"]*result__a[^"]*"[^>]*href="([^"]*)"[^>]*>([\s\S]*?)<\/a>/gi)];
      const snippetMatches = [...html.matchAll(/<a\b[^>]*class="[^"]*result__snippet[^"]*"[^>]*>([\s\S]*?)<\/a>/gi)];

      if (titleMatches.length > 0) {
        const out: string[] = [];
        const limit = Math.min(8, titleMatches.length);
        for (let i = 0; i < limit; i++) {
          const rawUrl = titleMatches[i][1];
          const m = rawUrl.match(/uddg=([^&]+)/);
          const finalUrl = m ? decodeURIComponent(m[1]) : rawUrl;
          const title = titleMatches[i][2]
            .replace(/<[^>]+>/g, '')
            .replace(/&amp;/g, '&')
            .replace(/&quot;/g, '"')
            .replace(/&#39;/g, "'")
            .replace(/&lt;/g, '<')
            .replace(/&gt;/g, '>')
            .replace(/\s+/g, ' ')
            .trim();
          const snippet = (snippetMatches[i] ? snippetMatches[i][1] : '')
            .replace(/<[^>]+>/g, '')
            .replace(/&amp;/g, '&')
            .replace(/&quot;/g, '"')
            .replace(/&#39;/g, "'")
            .replace(/&lt;/g, '<')
            .replace(/&gt;/g, '>')
            .replace(/\s+/g, ' ')
            .trim();
          out.push(`[${i + 1}] ${title}\nURL: ${finalUrl}\nSnippet: ${snippet}`);
        }
        return out.join('\n\n');
      }
    }
  } catch {
    /* fallback to strategy 2 */
  }

  // Strategy 2: DuckDuckGo Lite Search
  try {
    const liteUrl = `https://lite.duckduckgo.com/lite/`;
    const res = await fetch(liteUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
      },
      body: `q=${encodeURIComponent(q)}`,
      signal: AbortSignal.timeout(15000)
    });

    if (res.ok) {
      const html = await res.text();
      const linkMatches = [...html.matchAll(/<a\b[^>]*class="[^"]*result-link[^"]*"[^>]*href="([^"]*)"[^>]*>([\s\S]*?)<\/a>/gi)];
      const snippetMatches = [...html.matchAll(/<td\b[^>]*class="[^"]*result-snippet[^"]*"[^>]*>([\s\S]*?)<\/td>/gi)];

      if (linkMatches.length > 0) {
        const out: string[] = [];
        const limit = Math.min(8, linkMatches.length);
        for (let i = 0; i < limit; i++) {
          const rawUrl = linkMatches[i][1];
          const m = rawUrl.match(/uddg=([^&]+)/);
          const finalUrl = m ? decodeURIComponent(m[1]) : rawUrl;
          const title = linkMatches[i][2].replace(/<[^>]+>/g, '').replace(/&amp;/g, '&').replace(/\s+/g, ' ').trim();
          const snippet = (snippetMatches[i] ? snippetMatches[i][1] : '').replace(/<[^>]+>/g, '').replace(/&amp;/g, '&').replace(/\s+/g, ' ').trim();
          out.push(`[${i + 1}] ${title}\nURL: ${finalUrl}\nSnippet: ${snippet}`);
        }
        return out.join('\n\n');
      }
    }
  } catch {
    /* fallback to strategy 3 */
  }

  // Strategy 3: DuckDuckGo Instant Answer API
  try {
    const apiUrl = `https://api.duckduckgo.com/?q=${encodeURIComponent(q)}&format=json&no_html=1&skip_disambig=1`;
    const res = await fetch(apiUrl, {
      headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Antigravity/1.0' },
      signal: AbortSignal.timeout(10000)
    });
    if (res.ok) {
      const data: any = await res.json();
      const results: string[] = [];
      if (data.Heading && (data.AbstractText || data.AbstractURL)) {
        results.push(`[1] ${data.Heading}\nURL: ${data.AbstractURL || ''}\nSnippet: ${data.AbstractText || ''}`);
      }
      if (Array.isArray(data.RelatedTopics)) {
        for (const topic of data.RelatedTopics) {
          if (topic.Text && topic.FirstURL) {
            results.push(`[${results.length + 1}] ${topic.Text}\nURL: ${topic.FirstURL}`);
          }
          if (results.length >= 6) break;
        }
      }
      if (results.length > 0) {
        return results.join('\n\n');
      }
    }
  } catch {
    /* fall through */
  }

  return `No web search results found for: "${rawQ}". Try refining keywords or specifying a domain.`;
}

export async function fetchUrlContent(targetUrl: string): Promise<string> {
  const u = targetUrl.trim();
  if (!u) return '[error] URL cannot be empty';
  if (!/^https?:\/\//i.test(u)) {
    // If input is not a direct URL, automatically perform a web search!
    return await searchWeb(u);
  }

  try {
    const res = await fetch(u, {
      headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Antigravity/1.0' },
      signal: AbortSignal.timeout(20000)
    });
    if (!res.ok) {
      return `[error] HTTP ${res.status}: ${res.statusText}`;
    }
    const html = await res.text();
    const clean = html
      .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '')
      .replace(/<style\b[^<]*(?:(?!<\/style>)<[^<]*)*<\/style>/gi, '')
      .replace(/<head\b[^<]*(?:(?!<\/head>)<[^<]*)*<\/head>/gi, '')
      .replace(/<nav\b[^<]*(?:(?!<\/nav>)<[^<]*)*<\/nav>/gi, '')
      .replace(/<footer\b[^<]*(?:(?!<\/footer>)<[^<]*)*<\/footer>/gi, '')
      .replace(/<header\b[^<]*(?:(?!<\/header>)<[^<]*)*<\/header>/gi, '')
      .replace(/<noscript\b[^<]*(?:(?!<\/noscript>)<[^<]*)*<\/noscript>/gi, '')
      .replace(/<h1\b[^>]*>(.*?)<\/h1>/gi, '\n# $1\n')
      .replace(/<h2\b[^>]*>(.*?)<\/h2>/gi, '\n## $1\n')
      .replace(/<h3\b[^>]*>(.*?)<\/h3>/gi, '\n### $1\n')
      .replace(/<li\b[^>]*>(.*?)<\/li>/gi, '\n- $1')
      .replace(/<a\b[^>]*href="([^"]*)"[^>]*>(.*?)<\/a>/gi, '[$2]($1)')
      .replace(/<br\s*\/?>/gi, '\n')
      .replace(/<[^>]+>/g, ' ')
      .replace(/&nbsp;/g, ' ')
      .replace(/&amp;/g, '&')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&quot;/g, '"')
      .replace(/&#39;/g, "'")
      .replace(/[ \t]+/g, ' ')
      .replace(/\r?\n\s*\r?\n+/g, '\n\n')
      .trim();
    return clean.length ? clean.slice(0, 30000) : '(empty page)';
  } catch (err) {
    return `[error] fetch failed: ${err instanceof Error ? err.message : String(err)}`;
  }
}

export async function askUserQuestion(question: string, options?: string[]): Promise<string> {
  const q = question.trim();
  if (!q) return '[error] question cannot be empty';

  if (options && options.length > 0) {
    const pick = await vscode.window.showQuickPick(options, {
      placeHolder: q,
      ignoreFocusOut: true,
      title: 'Antigravity Agent Question'
    });
    return pick !== undefined ? pick : '[user dismissed question]';
  }

  const input = await vscode.window.showInputBox({
    prompt: q,
    ignoreFocusOut: true,
    title: 'Antigravity Agent Question'
  });
  return input !== undefined ? input : '[user dismissed question]';
}

export async function searchWorkspace(options: SearchOptions, roots: string[]): Promise<string> {
  const query = options.query;
  if (!query) return '[error] search query cannot be empty';

  const caseInsensitive = options.caseInsensitive !== false;
  let re: RegExp;
  try {
    if (options.isRegex) {
      re = new RegExp(query, caseInsensitive ? 'i' : '');
    } else {
      const escaped = query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      re = new RegExp(escaped, caseInsensitive ? 'i' : '');
    }
  } catch (err) {
    return `[error] invalid regex: ${err instanceof Error ? err.message : String(err)}`;
  }

  const targetPath = options.searchPath ? resolvePath(options.searchPath, roots) : roots[0];
  if (!targetPath || !fs.existsSync(targetPath)) {
    return `[error] search path not found: ${options.searchPath || '(no workspace folder open)'}`;
  }

  const matches: Array<{ file: string; line: number; text: string }> = [];
  const maxMatches = 50;
  let fileCount = 0;

  function walk(current: string) {
    if (matches.length >= maxMatches) return;
    try {
      const stat = fs.statSync(current);
      if (stat.isDirectory()) {
        const base = path.basename(current);
        if (IGNORE_DIRS.has(base)) return;
        const entries = fs.readdirSync(current);
        for (const e of entries) {
          walk(path.join(current, e));
          if (matches.length >= maxMatches) break;
        }
      } else if (stat.isFile()) {
        if (options.includes) {
          const filter = options.includes.trim().toLowerCase();
          const base = path.basename(current).toLowerCase();
          if (filter.startsWith('*.')) {
            const ext = filter.slice(1);
            if (!base.endsWith(ext)) return;
          } else if (!base.includes(filter)) {
            return;
          }
        }
        if (stat.size > 2 * 1024 * 1024) return;
        fileCount++;
        const content = fs.readFileSync(current, 'utf8');
        const lines = content.split(/\r?\n/);
        for (let i = 0; i < lines.length; i++) {
          if (re.test(lines[i])) {
            const rel = roots[0] ? path.relative(roots[0], current) : current;
            matches.push({ file: rel, line: i + 1, text: lines[i].trim() });
            if (matches.length >= maxMatches) break;
          }
        }
      }
    } catch {
      /* ignore unreadable entries */
    }
  }

  walk(targetPath);

  if (matches.length === 0) {
    return `No matches found for "${query}" (searched ${fileCount} files)`;
  }

  const matchLines = matches.map((m) => `${m.file}:${m.line}: ${m.text}`).join('\n');
  const capNotice = matches.length >= maxMatches ? ` (capped at ${maxMatches} matches)` : '';
  return `Found ${matches.length} matches across ${fileCount} scanned files${capNotice}:\n${matchLines}`;
}

export async function executeMultiEdit(filePath: string, chunks: ReplacementChunk[], roots: string[]): Promise<string> {
  const p = resolvePath(filePath, roots);
  if (!p) return `[error] path could not be resolved: ${filePath}`;
  if (!chunks || chunks.length === 0) return `[error] no replacement chunks provided`;

  try {
    const textBytes = await vscode.workspace.fs.readFile(vscode.Uri.file(p));
    let currentText = Buffer.from(textBytes).toString('utf8').replace(/\r\n/g, '\n');

    for (let i = 0; i < chunks.length; i++) {
      const oldNorm = chunks[i].target_content.replace(/\r\n/g, '\n');
      const count = currentText.split(oldNorm).length - 1;
      if (count === 0) {
        return `[error] chunk #${i + 1} target content not found in file: ${JSON.stringify(oldNorm.slice(0, 80))}`;
      }
      if (count > 1) {
        return `[error] chunk #${i + 1} target content found ${count} times; please provide more surrounding lines to make it unique`;
      }
    }

    for (const chunk of chunks) {
      const oldNorm = chunk.target_content.replace(/\r\n/g, '\n');
      const newNorm = chunk.replacement_content.replace(/\r\n/g, '\n');
      currentText = currentText.replace(oldNorm, newNorm);
    }

    await vscode.workspace.fs.writeFile(vscode.Uri.file(p), Buffer.from(currentText, 'utf8'));
    return `successfully applied ${chunks.length} replacement(s) to ${p}`;
  } catch (err) {
    return `[error] ${err instanceof Error ? err.message : String(err)}`;
  }
}

function stripAll(content: string): string {
  return content
    .replace(FILE_BLOCK_RE, '')
    .replace(EDIT_BLOCK_RE, '')
    .replace(MULTI_EDIT_BLOCK_RE, '')
    .replace(READ_BLOCK_RE, '')
    .replace(LIST_BLOCK_RE, '')
    .replace(SEARCH_BLOCK_RE, '')
    .replace(WEB_SEARCH_BLOCK_RE, '')
    .replace(FETCH_BLOCK_RE, '')
    .replace(QUESTION_BLOCK_RE, '')
    .replace(SHELL_BLOCK_RE, '')
    .replace(OPEN_BLOCK_RE, '')
    .replace(VSCODE_BLOCK_RE, '')
    .replace(VOICE_FILE_RE, '')
    .replace(VOICE_EDIT_RE, '')
    .replace(VOICE_MULTI_EDIT_RE, '')
    .replace(VOICE_READ_RE, '')
    .replace(VOICE_LIST_RE, '')
    .replace(VOICE_SEARCH_RE, '')
    .replace(VOICE_WEB_SEARCH_RE, '')
    .replace(VOICE_FETCH_RE, '')
    .replace(VOICE_QUESTION_RE, '')
    .replace(VOICE_SHELL_RE, '')
    .replace(VOICE_OPEN_RE, '')
    .replace(/^\n+|\n+$/g, '')
    .replace(/\n{2,}/g, '\n')
    .trim();
}

export function stripToolBlocks(content: string): string {
  return stripAll(content);
}

export function parseFileBlocks(content: string): Array<{ path: string; text: string }> {
  const out: Array<{ path: string; text: string }> = [];
  for (const m of content.matchAll(FILE_BLOCK_RE)) {
    const p = extractAttr(m[1], 'path') || m[1].trim();
    if (p) {
      out.push({ path: p, text: m[2].replace(/^\r?\n|\r?\n$/g, '') });
    }
  }
  for (const m of content.matchAll(VOICE_FILE_RE)) {
    out.push({ path: m[1].trim(), text: m[2].replace(/^\r?\n|\r?\n$/g, '') });
  }
  return out;
}

export function hasToolBlocks(content: string): boolean {
  return content.includes(TOOL_BLOCK_OPEN) || /TOOL:\s*(read|list|open|shell|file|edit|search|multi_edit|fetch|question|web_search|search_web)/i.test(content);
}

export async function executeTools(
  content: string,
  roots: string[],
  policy?: ToolPolicy,
  nativeCalls?: NativeToolCall[]
): Promise<ToolResult[]> {
  const results: ToolResult[] = [];
  const shellCwd = roots[0] ?? os.homedir();
  const toolEnabled = (tool: string): boolean => {
    if (!policy) return true;
    if (tool === 'shell') return policy.allowShell !== false;
    if (tool === 'vscode') return policy.allowVscode !== false;
    if (tool === 'files') return policy.allowFiles !== false;
    if (tool === 'web') return policy.allowWeb !== false;
    return true;
  };

  // 1. Execute native OpenAI function calling tool calls if present
  if (nativeCalls && nativeCalls.length > 0) {
    for (const call of nativeCalls) {
      const name = call.name;
      const args = call.arguments || {};

      if (name === 'run_command' || name === 'shell') {
        if (!toolEnabled('shell')) {
          results.push({ tool: name, args: String(args.command || ''), output: '[error] shell commands are disabled in session options' });
          continue;
        }
        const cmd = String(args.command || '');
        const cwd = args.cwd ? resolvePath(String(args.cwd), roots) : shellCwd;
        results.push({ tool: 'run_command', args: cmd, output: await runShell(cmd, cwd) });
      } else if (name === 'run_vscode_command' || name === 'vscode') {
        if (!toolEnabled('vscode')) {
          results.push({ tool: name, args: String(args.command || ''), output: '[error] VS Code commands are disabled in session options' });
          continue;
        }
        const cmd = String(args.command || '');
        const argv = Array.isArray(args.args) ? args.args : [];
        try {
          const val = await vscode.commands.executeCommand(cmd, ...argv);
          results.push({ tool: 'run_vscode_command', args: cmd, output: val === undefined ? `ran ${cmd}` : `ran ${cmd} -> ${safeStringify(val)}` });
        } catch (err) {
          results.push({ tool: 'run_vscode_command', args: cmd, output: `[error] ${err instanceof Error ? err.message : String(err)}` });
        }
      } else if (name === 'search_web' || name === 'web_search') {
        if (!toolEnabled('web')) {
          results.push({ tool: name, args: String(args.query || ''), output: '[error] web access is disabled in session options' });
          continue;
        }
        const query = String(args.query || '');
        const domain = args.domain ? String(args.domain) : undefined;
        const out = await searchWeb(query, domain);
        results.push({ tool: 'search_web', args: domain ? `${query} (domain: ${domain})` : query, output: out });
      } else if (name === 'read_url_content' || name === 'fetch' || name === 'web_fetch' || name === 'fetch_web_page') {
        if (!toolEnabled('web')) {
          results.push({ tool: name, args: String(args.url || args.query || ''), output: '[error] web access is disabled in session options' });
          continue;
        }
        const target = String(args.url || args.query || '');
        const out = await fetchUrlContent(target);
        results.push({ tool: 'read_url_content', args: target, output: out });
      } else if (name === 'ask_question' || name === 'question') {
        const q = String(args.question || '');
        const opts = Array.isArray(args.options) ? args.options.map(String) : undefined;
        const out = await askUserQuestion(q, opts);
        results.push({ tool: 'ask_question', args: q, output: out });
      } else if (toolEnabled('files')) {
        if (name === 'grep_search' || name === 'search') {
          const query = String(args.query || '');
          const out = await searchWorkspace(
            {
              query,
              searchPath: args.search_path ? String(args.search_path) : undefined,
              caseInsensitive: args.case_insensitive !== false,
              isRegex: !!args.is_regex,
              includes: args.includes ? String(args.includes) : undefined
            },
            roots
          );
          results.push({ tool: 'grep_search', args: query, output: out });
        } else if (name === 'view_file' || name === 'read') {
          const target = String(args.path || '');
          const p = resolvePath(target, roots);
          if (!p) {
            results.push({ tool: 'view_file', args: target, output: '[error] path could not be resolved' });
            continue;
          }
          try {
            const textBytes = await vscode.workspace.fs.readFile(vscode.Uri.file(p));
            const text = Buffer.from(textBytes).toString('utf8');
            const lines = text.split(/\r?\n/);
            const total = lines.length;
            const start = typeof args.start_line === 'number' ? Math.max(1, args.start_line) : 1;
            const defaultSpan = 250;
            const end = typeof args.end_line === 'number' ? Math.min(total, args.end_line) : Math.min(total, start + defaultSpan - 1);
            const slice = lines.slice(start - 1, end);
            const numbered = slice.map((l, i) => `${start + i}: ${l}`).join('\n');
            const truncatedNote = end < total ? `\n... [${total - end} remaining lines omitted; specify start_line and end_line to inspect further]` : '';
            let out = `File: ${p} (Total lines: ${total}, showing ${start} to ${end}):\n${numbered}${truncatedNote}`;
            if (out.length > 25000) {
              out = out.slice(0, 25000) + '\n... [output truncated for real-time channel]';
            }
            results.push({ tool: 'view_file', args: target, output: out });
          } catch (err) {
            results.push({ tool: 'view_file', args: target, output: `[error] ${err instanceof Error ? err.message : String(err)}` });
          }
        } else if (name === 'write_to_file' || name === 'file') {
          const target = String(args.path || '');
          const p = resolvePath(target, roots);
          const msg = p ? await writeFile(p, String(args.content ?? '')) : `[error] path could not be resolved ${target}`;
          results.push({ tool: 'write_to_file', args: target, output: msg });
        } else if (name === 'replace_file_content' || name === 'edit') {
          const target = String(args.path || '');
          const p = resolvePath(target, roots);
          if (!p) {
            results.push({ tool: 'replace_file_content', args: target, output: '[error] path could not be resolved' });
            continue;
          }
          try {
            const textBytes = await vscode.workspace.fs.readFile(vscode.Uri.file(p));
            const currentText = Buffer.from(textBytes).toString('utf8').replace(/\r\n/g, '\n');
            const oldNorm = String(args.target_content || '').replace(/\r\n/g, '\n');
            const newNorm = String(args.replacement_content || '').replace(/\r\n/g, '\n');
            const count = currentText.split(oldNorm).length - 1;
            if (count === 0) {
              results.push({ tool: 'replace_file_content', args: target, output: '[error] target content not found in file' });
            } else if (count > 1) {
              results.push({ tool: 'replace_file_content', args: target, output: `[error] target content found ${count} times; provide unique context` });
            } else {
              const updated = currentText.replace(oldNorm, newNorm);
              await vscode.workspace.fs.writeFile(vscode.Uri.file(p), Buffer.from(updated, 'utf8'));
              results.push({ tool: 'replace_file_content', args: target, output: `successfully edited ${p}` });
            }
          } catch (err) {
            results.push({ tool: 'replace_file_content', args: target, output: `[error] ${err instanceof Error ? err.message : String(err)}` });
          }
        } else if (name === 'multi_replace_file_content' || name === 'multi_edit') {
          const target = String(args.path || '');
          const chunks = (args.chunks as ReplacementChunk[]) || [];
          const out = await executeMultiEdit(target, chunks, roots);
          results.push({ tool: 'multi_replace_file_content', args: target, output: out });
        } else if (name === 'list_dir' || name === 'list') {
          const target = String(args.path || '');
          const p = resolvePath(target, roots) ?? roots[0];
          if (!p) {
            results.push({ tool: 'list_dir', args: target, output: '[error] path could not be resolved' });
            continue;
          }
          try {
            const entries = await vscode.workspace.fs.readDirectory(vscode.Uri.file(p));
            let dirCount = 0;
            let fileCount = 0;
            const lines = entries
              .sort((a, b) => a[0].localeCompare(b[0]))
              .map(([entryName, type]) => {
                if (type === 2) {
                  dirCount++;
                  return `[dir]  ${entryName}`;
                }
                fileCount++;
                let sizeStr = '';
                try {
                  const s = fs.statSync(path.join(p, entryName));
                  sizeStr = ` (${s.size.toLocaleString()} bytes)`;
                } catch {
                  /* ignore */
                }
                return `[file] ${entryName}${sizeStr}`;
              })
              .join('\n');
            const summary = `Directory: ${p} (${entries.length} items: ${dirCount} dirs, ${fileCount} files)\n${lines}`;
            results.push({ tool: 'list_dir', args: target, output: entries.length ? summary : '(empty directory)' });
          } catch (err) {
            results.push({ tool: 'list_dir', args: target, output: `[error] ${err instanceof Error ? err.message : String(err)}` });
          }
        } else if (name === 'open_file' || name === 'open') {
          const target = String(args.path || '');
          const p = resolvePath(target, roots);
          if (!p) {
            results.push({ tool: 'open_file', args: target, output: '[error] path could not be resolved' });
            continue;
          }
          try {
            const doc = await vscode.workspace.openTextDocument(vscode.Uri.file(p));
            await vscode.window.showTextDocument(doc, { preview: false });
            results.push({ tool: 'open_file', args: target, output: `opened ${p}` });
          } catch (err) {
            results.push({ tool: 'open_file', args: target, output: `[error] ${err instanceof Error ? err.message : String(err)}` });
          }
        }
      }
    }
  }

  // 2. Execute XML / Voice blocks in content
  if (toolEnabled('shell')) {
    for (const m of content.matchAll(SHELL_BLOCK_RE)) {
      const command = extractAttr(m[1], 'command') || (m[2] ? m[2].trim() : '') || (m[1] && !m[1].includes('=') ? m[1].trim() : '');
      if (!command) continue;
      results.push({ tool: 'shell', args: command, output: await runShell(command, shellCwd) });
    }
    for (const m of content.matchAll(VOICE_SHELL_RE)) {
      const command = m[1].trim();
      if (!command) continue;
      results.push({ tool: 'shell', args: command, output: await runShell(command, shellCwd) });
    }
  }

  // Web search tool (<antigravity:web_search> and VOICE_WEB_SEARCH_RE)
  if (toolEnabled('web')) {
    for (const m of content.matchAll(WEB_SEARCH_BLOCK_RE)) {
      const query = extractAttr(m[1], 'query') || (m[2] ? m[2].trim() : '') || (m[1] && !m[1].includes('=') ? m[1].trim() : '');
      const domain = extractAttr(m[1], 'domain');
      if (!query) continue;
      const out = await searchWeb(query, domain);
      results.push({ tool: 'search_web', args: domain ? `${query} (domain: ${domain})` : query, output: out });
    }
    for (const m of content.matchAll(VOICE_WEB_SEARCH_RE)) {
      const query = m[1].trim();
      const domain = m[2] ? m[2].trim() : undefined;
      if (!query) continue;
      const out = await searchWeb(query, domain);
      results.push({ tool: 'search_web', args: domain ? `${query} (domain: ${domain})` : query, output: out });
    }

    // Fetch tool (<antigravity:fetch> and VOICE_FETCH_RE)
    for (const m of content.matchAll(FETCH_BLOCK_RE)) {
      const url = extractAttr(m[1], 'url') || (m[2] ? m[2].trim() : '') || (m[1] && !m[1].includes('=') ? m[1].trim() : '');
      if (!url) continue;
      const out = await fetchUrlContent(url);
      results.push({ tool: 'fetch', args: url, output: out });
    }
    for (const m of content.matchAll(VOICE_FETCH_RE)) {
      const url = m[1].trim();
      if (!url) continue;
      const out = await fetchUrlContent(url);
      results.push({ tool: 'fetch', args: url, output: out });
    }
  }

  // Question tool (<antigravity:question> and VOICE_QUESTION_RE)
  for (const m of content.matchAll(QUESTION_BLOCK_RE)) {
    const prompt = extractAttr(m[1], 'text') || extractAttr(m[1], 'prompt') || (m[2] ? m[2].trim() : '') || (m[1] && !m[1].includes('=') ? m[1].trim() : '');
    if (!prompt) continue;
    let options: string[] | undefined;
    const optsAttr = extractAttr(m[1], 'options');
    if (optsAttr) {
      try {
        const parsed = JSON.parse(optsAttr);
        if (Array.isArray(parsed)) options = parsed.map(String);
      } catch {
        /* ignore parse error */
      }
    }
    const out = await askUserQuestion(prompt, options);
    results.push({ tool: 'question', args: prompt, output: out });
  }
  for (const m of content.matchAll(VOICE_QUESTION_RE)) {
    const prompt = m[1].trim();
    if (!prompt) continue;
    const out = await askUserQuestion(prompt);
    results.push({ tool: 'question', args: prompt, output: out });
  }

  if (toolEnabled('files')) {
    // Search tool (<antigravity:search> and VOICE_SEARCH_RE)
    for (const m of content.matchAll(SEARCH_BLOCK_RE)) {
      const rawAttrs = m[1];
      const query = extractAttr(rawAttrs, 'query') || (m[2] ? m[2].trim() : '') || (rawAttrs && !rawAttrs.includes('=') ? rawAttrs.trim() : '');
      if (!query) continue;
      const searchPath = extractAttr(rawAttrs, 'path') || undefined;
      const caseSens = extractAttr(rawAttrs, 'case_sensitive');
      const isRegex = extractAttr(rawAttrs, 'regex');
      const includes = extractAttr(rawAttrs, 'includes') || undefined;
      const out = await searchWorkspace(
        {
          query,
          searchPath,
          caseInsensitive: caseSens ? caseSens === 'false' : true,
          isRegex: isRegex === 'true',
          includes
        },
        roots
      );
      results.push({ tool: 'search', args: query, output: out });
    }
    for (const m of content.matchAll(VOICE_SEARCH_RE)) {
      const query = m[1].trim();
      const searchPath = m[2]?.trim() || undefined;
      const out = await searchWorkspace({ query, searchPath }, roots);
      results.push({ tool: 'search', args: query, output: out });
    }

    // Read tool (<antigravity:read> and VOICE_READ_RE)
    for (const m of content.matchAll(READ_BLOCK_RE)) {
      const target = extractAttr(m[1], 'path') || extractAttr(m[1], 'file') || (m[2] ? m[2].trim() : '') || (m[1] && !m[1].includes('=') ? m[1].trim() : '');
      if (!target) continue;
      const p = resolvePath(target, roots);
      try {
        const textBytes = await vscode.workspace.fs.readFile(vscode.Uri.file(p));
        const text = Buffer.from(textBytes).toString('utf8');
        const lines = text.split(/\r?\n/);
        const total = lines.length;
        const startAttr = extractAttr(m[1], 'start') || extractAttr(m[1], 'start_line');
        const endAttr = extractAttr(m[1], 'end') || extractAttr(m[1], 'end_line');
        const start = startAttr ? Math.max(1, parseInt(startAttr, 10)) : 1;
        const end = endAttr ? Math.min(total, parseInt(endAttr, 10)) : Math.min(total, 800);
        const slice = lines.slice(start - 1, end);
        const numbered = slice.map((l, i) => `${start + i}: ${l}`).join('\n');
        const out = `File: ${p} (Total lines: ${total}, showing ${start} to ${end}):\n${numbered}`;
        results.push({ tool: 'read', args: target, output: out });
      } catch (err) {
        results.push({ tool: 'read', args: target, output: `[error] ${err instanceof Error ? err.message : String(err)}` });
      }
    }
    for (const m of content.matchAll(VOICE_READ_RE)) {
      const target = m[1].trim();
      if (!target) continue;
      const p = resolvePath(target, roots);
      try {
        const textBytes = await vscode.workspace.fs.readFile(vscode.Uri.file(p));
        const text = Buffer.from(textBytes).toString('utf8');
        const lines = text.split(/\r?\n/);
        const total = lines.length;
        const start = m[2] ? Math.max(1, parseInt(m[2], 10)) : 1;
        const end = m[3] ? Math.min(total, parseInt(m[3], 10)) : Math.min(total, 800);
        const slice = lines.slice(start - 1, end);
        const numbered = slice.map((l, i) => `${start + i}: ${l}`).join('\n');
        const out = `File: ${p} (Total lines: ${total}, showing ${start} to ${end}):\n${numbered}`;
        results.push({ tool: 'read', args: target, output: out });
      } catch (err) {
        results.push({ tool: 'read', args: target, output: `[error] ${err instanceof Error ? err.message : String(err)}` });
      }
    }

    // List tool (<antigravity:list> and VOICE_LIST_RE)
    for (const m of content.matchAll(LIST_BLOCK_RE)) {
      const target = extractAttr(m[1], 'path') || extractAttr(m[1], 'dir') || (m[2] ? m[2].trim() : '') || (m[1] && !m[1].includes('=') ? m[1].trim() : '') || '.';
      const p = resolvePath(target, roots);
      try {
        const entries = await vscode.workspace.fs.readDirectory(vscode.Uri.file(p));
        let dirCount = 0;
        let fileCount = 0;
        const lines = entries
          .sort((a, b) => a[0].localeCompare(b[0]))
          .map(([entryName, type]) => {
            if (type === 2) {
              dirCount++;
              return `[dir]  ${entryName}`;
            }
            fileCount++;
            let sizeStr = '';
            try {
              const s = fs.statSync(path.join(p, entryName));
              sizeStr = ` (${s.size.toLocaleString()} bytes)`;
            } catch {
              /* ignore */
            }
            return `[file] ${entryName}${sizeStr}`;
          })
          .join('\n');
        const summary = `Directory: ${p} (${entries.length} items: ${dirCount} dirs, ${fileCount} files)\n${lines}`;
        results.push({
          tool: 'list',
          args: target,
          output: entries.length ? summary : '(empty directory)'
        });
      } catch (err) {
        results.push({ tool: 'list', args: target, output: `[error] ${err instanceof Error ? err.message : String(err)}` });
      }
    }
    for (const m of content.matchAll(VOICE_LIST_RE)) {
      const target = m[1]?.trim() || '.';
      const p = resolvePath(target, roots);
      try {
        const entries = await vscode.workspace.fs.readDirectory(vscode.Uri.file(p));
        let dirCount = 0;
        let fileCount = 0;
        const lines = entries
          .sort((a, b) => a[0].localeCompare(b[0]))
          .map(([entryName, type]) => {
            if (type === 2) {
              dirCount++;
              return `[dir]  ${entryName}`;
            }
            fileCount++;
            let sizeStr = '';
            try {
              const s = fs.statSync(path.join(p, entryName));
              sizeStr = ` (${s.size.toLocaleString()} bytes)`;
            } catch {
              /* ignore */
            }
            return `[file] ${entryName}${sizeStr}`;
          })
          .join('\n');
        const summary = `Directory: ${p} (${entries.length} items: ${dirCount} dirs, ${fileCount} files)\n${lines}`;
        results.push({
          tool: 'list',
          args: target,
          output: entries.length ? summary : '(empty directory)'
        });
      } catch (err) {
        results.push({ tool: 'list', args: target, output: `[error] ${err instanceof Error ? err.message : String(err)}` });
      }
    }

    // Open tool
    for (const m of content.matchAll(OPEN_BLOCK_RE)) {
      const target = extractAttr(m[1], 'path') || (m[2] ? m[2].trim() : '') || (m[1] && !m[1].includes('=') ? m[1].trim() : '');
      if (!target) continue;
      const p = resolvePath(target, roots);
      try {
        const doc = await vscode.workspace.openTextDocument(vscode.Uri.file(p));
        await vscode.window.showTextDocument(doc, { preview: false });
        results.push({ tool: 'open', args: target, output: `opened ${p}` });
      } catch (err) {
        results.push({ tool: 'open', args: target, output: `[error] ${err instanceof Error ? err.message : String(err)}` });
      }
    }
    for (const m of content.matchAll(VOICE_OPEN_RE)) {
      const target = m[1].trim();
      if (!target) continue;
      const p = resolvePath(target, roots);
      try {
        const doc = await vscode.workspace.openTextDocument(vscode.Uri.file(p));
        await vscode.window.showTextDocument(doc, { preview: false });
        results.push({ tool: 'open', args: target, output: `opened ${p}` });
      } catch (err) {
        results.push({ tool: 'open', args: target, output: `[error] ${err instanceof Error ? err.message : String(err)}` });
      }
    }

    // File creation blocks
    for (const block2 of parseFileBlocks(content)) {
      const p = resolvePath(block2.path, roots);
      const msg = await writeFile(p, block2.text);
      results.push({ tool: 'file', args: block2.path, output: msg });
    }

    // Single Edit blocks
    const editMatches = [...content.matchAll(EDIT_BLOCK_RE), ...content.matchAll(VOICE_EDIT_RE)];
    for (const m of editMatches) {
      const pathArg = extractAttr(m[1], 'path') || m[1].trim();
      const oldText = m[2];
      const newText = m[3];
      const p = resolvePath(pathArg, roots);

      try {
        const textBytes = await vscode.workspace.fs.readFile(vscode.Uri.file(p));
        const currentText = Buffer.from(textBytes).toString('utf8').replace(/\r\n/g, '\n');
        const normalizedOld = oldText.replace(/\r\n/g, '\n');
        const normalizedNew = newText.replace(/\r\n/g, '\n');

        const count = currentText.split(normalizedOld).length - 1;
        if (count === 0) {
          results.push({ tool: 'edit', args: pathArg, output: '[error] old text block not found in file exactly as specified' });
        } else if (count > 1) {
          results.push({ tool: 'edit', args: pathArg, output: '[error] old text block found multiple times, please provide a more unique block' });
        } else {
          const updatedText = currentText.replace(normalizedOld, normalizedNew);
          await vscode.workspace.fs.writeFile(vscode.Uri.file(p), Buffer.from(updatedText, 'utf8'));
          results.push({ tool: 'edit', args: pathArg, output: `successfully edited ${p}` });
        }
      } catch (err) {
        results.push({ tool: 'edit', args: pathArg, output: `[error] ${err instanceof Error ? err.message : String(err)}` });
      }
    }

    // Multi-edit blocks (<antigravity:multi_edit> and VOICE_MULTI_EDIT_RE)
    const multiEditMatches = [...content.matchAll(MULTI_EDIT_BLOCK_RE), ...content.matchAll(VOICE_MULTI_EDIT_RE)];
    for (const m of multiEditMatches) {
      const pathArg = extractAttr(m[1], 'path') || m[1].trim();
      const body = m[2];
      const chunks: ReplacementChunk[] = [];
      for (const cm of body.matchAll(CHUNK_RE)) {
        chunks.push({ target_content: cm[1], replacement_content: cm[2] });
      }
      const out = await executeMultiEdit(pathArg, chunks, roots);
      results.push({ tool: 'multi_edit', args: pathArg, output: out });
    }
  }

  if (toolEnabled('vscode')) {
    for (const m of content.matchAll(VSCODE_BLOCK_RE)) {
      const command = extractAttr(m[1], 'command') || (m[2] ? m[2].trim() : '') || (m[1] && !m[1].includes('=') ? m[1].trim() : '');
      if (!command) {
        results.push({ tool: 'vscode', args: m[0], output: '[error] missing command attribute' });
        continue;
      }
      let argv: unknown[] = [];
      const argsAttr = extractAttr(m[1], 'args');
      if (argsAttr) {
        try {
          const parsed = JSON.parse(argsAttr);
          argv = Array.isArray(parsed) ? parsed : [parsed];
        } catch {
          results.push({ tool: 'vscode', args: command, output: '[error] args must be a JSON array (or JSON value)' });
          continue;
        }
      }
      try {
        const value = await vscode.commands.executeCommand(command, ...argv);
        results.push({
          tool: 'vscode',
          args: command,
          output: value === undefined ? `ran ${command}` : `ran ${command} -> ${safeStringify(value)}`
        });
      } catch (err) {
        results.push({ tool: 'vscode', args: command, output: `[error] ${err instanceof Error ? err.message : String(err)}` });
      }
    }
  }

  return results;
}

function safeStringify(value: unknown): string {
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

function extractAttr(attrs: string, name: string): string {
  const m = new RegExp(`(?:^|[\\s])${name}=(["'])(.*?)\\1`).exec(attrs);
  return m?.[2] ?? '';
}

function resolvePath(p: string, roots: string[]): string {
  const effectiveRoots = roots && roots.length > 0
    ? roots
    : [(vscode.workspace.workspaceFolders?.[0]?.uri.fsPath ?? process.cwd() ?? os.homedir())];
  const target = (!p || p === '.' || p === './' || p === '.\\') ? effectiveRoots[0] : p.trim();
  if (path.isAbsolute(target)) return target;
  for (const r of effectiveRoots) {
    const c = path.join(r, target);
    if (fs.existsSync(c)) return c;
  }
  return path.join(effectiveRoots[0], target);
}

async function writeFile(target: string, text: string): Promise<string> {
  try {
    await vscode.workspace.fs.createDirectory(vscode.Uri.file(path.dirname(target)));
    await vscode.workspace.fs.writeFile(vscode.Uri.file(target), Buffer.from(text, 'utf8'));
    let size = Buffer.byteLength(text, 'utf8');
    try {
      size = fs.statSync(target).size;
    } catch (_) {
      /* fall back to byteLength */
    }
    return `created ${target} (${size} bytes)`;
  } catch (err) {
    return `[error] ${err instanceof Error ? err.message : String(err)}`;
  }
}

export function runShell(command: string, cwd?: string): Promise<string> {
  return new Promise((resolve) => {
    childProcess.exec(
      command,
      { cwd, shell: process.env.ComSpec || 'cmd.exe', timeout: 45000, maxBuffer: 8 * 1024 * 1024 },
      (err, stdout, stderr) => {
        const out = (stdout || '') + (stderr ? `\n[stderr] ${stderr}` : '');
        if (err && !out.trim()) resolve(`[error] ${err.message}`);
        else resolve(out.trim() || (err ? `[done] exit ${err.code ?? '?'}` : '[no output]'));
      }
    );
  });
}

export async function streamCompletion(
  req: ChatRequest,
  onDelta: (text: string) => void
): Promise<{ content: string; toolCalls: NativeToolCall[] }> {
  const url = `${req.baseUrl.replace(/\/+$/, '')}/chat/completions`;
  const buildPayload = (includeTools: boolean): Record<string, unknown> => {
    const payload: Record<string, unknown> = {
      model: req.model,
      messages: req.messages,
      stream: true
    };
    if (typeof req.temperature === 'number') payload.temperature = req.temperature;
    if (typeof req.maxTokens === 'number') payload.max_tokens = req.maxTokens;
    if (includeTools && req.tools && req.tools.length) payload.tools = req.tools;
    return payload;
  };

  const timeoutSig = AbortSignal.timeout(300000);
  const effectiveSignal = req.signal
    ? ((AbortSignal as any).any ? (AbortSignal as any).any([req.signal, timeoutSig]) : req.signal)
    : timeoutSig;

  let res = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(req.apiKey ? { Authorization: `Bearer ${req.apiKey}` } : {})
    },
    body: JSON.stringify(buildPayload(true)),
    signal: effectiveSignal
  });

  // If 400 Bad Request and tools were included, retry once without tools (defensive fallback for models without tool support)
  if (!res.ok && res.status === 400 && req.tools && req.tools.length) {
    res = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(req.apiKey ? { Authorization: `Bearer ${req.apiKey}` } : {})
      },
      body: JSON.stringify(buildPayload(false)),
      signal: effectiveSignal
    });
  }

  if (!res.ok) {
    const errBody = await res.text().catch(() => '');
    throw new Error(`9 Router HTTP ${res.status}: ${errBody.slice(0, 500)}`);
  }
  if (!res.body) return { content: '', toolCalls: [] };

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let content = '';
  const accToolCalls: Record<number, { id: string; name: string; arguments: string }> = {};

  try {
    for (;;) {
      if (req.signal?.aborted) {
        throw new Error('AbortError: Stream aborted by user');
      }
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      let idx: number;
      while ((idx = buffer.indexOf('\n')) >= 0) {
        const line = buffer.slice(0, idx).trim();
        buffer = buffer.slice(idx + 1);
        if (!line.startsWith('data:')) continue;
        const data = line.slice(5).trim();
        if (data === '[DONE]') break;
        let parsed: any;
        try {
          parsed = JSON.parse(data);
        } catch {
          /* skip malformed SSE lines */
          continue;
        }

        if (parsed?.error) {
          const errDetail = parsed.error.message || JSON.stringify(parsed.error);
          throw new Error(`9 Router upstream error: ${errDetail}`);
        }

        try {
          const delta = parsed.choices?.[0]?.delta;
          const piece = delta?.content ?? '';
          if (piece) {
            content += piece;
            onDelta(piece);
          }
          if (delta?.tool_calls) {
            for (const tc of delta.tool_calls) {
              const callIdx = tc.index ?? 0;
              if (!accToolCalls[callIdx]) {
                accToolCalls[callIdx] = {
                  id: tc.id || `call_${callIdx}_${Date.now()}`,
                  name: tc.function?.name || '',
                  arguments: ''
                };
              }
              if (tc.id) accToolCalls[callIdx].id = tc.id;
              if (tc.function?.name) accToolCalls[callIdx].name = tc.function.name;
              if (tc.function?.arguments) accToolCalls[callIdx].arguments += tc.function.arguments;
            }
          }
        } catch {
          /* skip malformed choices */
        }
      }
    }
  } finally {
    reader.releaseLock();
  }

  const toolCalls: NativeToolCall[] = Object.values(accToolCalls).map((tc) => {
    let parsedArgs: Record<string, unknown> = {};
    try {
      parsedArgs = tc.arguments ? JSON.parse(tc.arguments) : {};
    } catch {
      parsedArgs = { raw: tc.arguments };
    }
    return {
      id: tc.id,
      name: tc.name,
      arguments: parsedArgs
    };
  });

  return { content, toolCalls };
}

/**
 * Appender that suppresses <antigravity:...> tool blocks from the visible stream
 * while still forwarding everything else. Returns a function bound to `emit`.
 */
export function toolBlockAwareAppender(emit: (text: string) => void): (text: string) => void {
  let skipped = '';
  let inBlock = false;
  return (delta: string) => {
    let rest = delta;
    while (rest.length) {
      if (inBlock) {
        skipped += rest;
        const gt = skipped.indexOf('>');
        if (gt < 0) {
          rest = '';
          continue;
        }
        const before = skipped.slice(0, gt);
        if (/\/\s*$/.test(before)) {
          inBlock = false;
          const tail = skipped.slice(gt + 1);
          skipped = '';
          rest = tail;
          continue;
        }
        const vc = skipped.indexOf('</antigravity', gt);
        if (vc < 0) {
          rest = '';
          continue;
        }
        const ce = skipped.indexOf('>', vc);
        if (ce < 0) {
          rest = '';
          continue;
        }
        inBlock = false;
        const tail = skipped.slice(ce + 1);
        skipped = '';
        if (tail) rest = tail; else rest = '';
        continue;
      }
      const i = rest.indexOf('<antigravity');
      if (i < 0) {
        emit(rest);
        rest = '';
      } else {
        if (i > 0) emit(rest.slice(0, i));
        skipped = rest.slice(i);
        inBlock = true;
        rest = '';
      }
    }
  };
}
