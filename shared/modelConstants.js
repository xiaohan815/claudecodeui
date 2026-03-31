/**
 * Centralized Model Definitions
 * Single source of truth for all supported AI models
 */

/**
 * Claude (Anthropic) Models
 *
 * Note: Claude uses two different formats:
 * - SDK format ('sonnet', 'opus') - used by the UI and claude-sdk.js
 * - API format ('claude-sonnet-4.5') - used by slash commands for display
 */
export const CLAUDE_MODELS = {
  // Models in SDK format (what the actual SDK accepts)
  OPTIONS: [
    { value: "sonnet", label: "Sonnet" },
    { value: "opus", label: "Opus" },
    { value: "haiku", label: "Haiku" },
    { value: "opusplan", label: "Opus Plan" },
    { value: "sonnet[1m]", label: "Sonnet [1M]" },
  ],

  DEFAULT: "sonnet",
};

/**
 * Cursor Models
 */
export const CURSOR_MODELS = {
  OPTIONS: [
    // Claude 4.6 Models
    { value: "claude-4.6-sonnet-medium", label: "Claude 4.6 Sonnet" },
    { value: "claude-4.6-sonnet-medium-thinking", label: "Claude 4.6 Sonnet (Thinking)" },
    { value: "claude-4.6-opus-high", label: "Claude 4.6 Opus" },
    { value: "claude-4.6-opus-high-thinking", label: "Claude 4.6 Opus (Thinking)" },
    { value: "claude-4.6-opus-max", label: "Claude 4.6 Opus Max" },
    { value: "claude-4.6-opus-max-thinking", label: "Claude 4.6 Opus Max (Thinking)" },
    // GPT Models
    { value: "gpt-5.4-high", label: "GPT-5.4 High" },
    { value: "gpt-5.4-medium", label: "GPT-5.4 Medium" },
    { value: "gpt-5.3-codex", label: "GPT-5.3 Codex" },
    { value: "gpt-5.3-codex-high", label: "GPT-5.3 Codex High" },
    { value: "gpt-5.2-high", label: "GPT-5.2 High" },
    { value: "gpt-5.2", label: "GPT-5.2" },
    { value: "gpt-5.1", label: "GPT-5.1" },
    { value: "gpt-5.1-high", label: "GPT-5.1 High" },
    // Claude 4.5 Models
    { value: "claude-4.5-sonnet", label: "Claude 4.5 Sonnet" },
    { value: "claude-4.5-sonnet-thinking", label: "Claude 4.5 Sonnet (Thinking)" },
    { value: "claude-4.5-opus-high", label: "Claude 4.5 Opus" },
    { value: "claude-4.5-opus-high-thinking", label: "Claude 4.5 Opus (Thinking)" },
    // Codex Models
    { value: "gpt-5.2-codex", label: "GPT-5.2 Codex" },
    { value: "gpt-5.2-codex-high", label: "GPT-5.2 Codex High" },
    { value: "gpt-5.1-codex-max", label: "GPT-5.1 Codex Max" },
    { value: "gpt-5.1-codex-max-high", label: "GPT-5.1 Codex Max High" },
    // Gemini Models
    { value: "gemini-3.1-pro", label: "Gemini 3.1 Pro" },
    { value: "gemini-3-flash", label: "Gemini 3 Flash" },
    // Other
    { value: "composer-2", label: "Composer 2" },
    { value: "grok-4-20", label: "Grok 4" },
    { value: "auto", label: "Auto" },
  ],

  DEFAULT: "gpt-5.3-codex",
};

/**
 * Codex (OpenAI) Models
 */
export const CODEX_MODELS = {
  OPTIONS: [
    { value: "gpt-5.4", label: "GPT-5.4" },
    { value: "gpt-5.3-codex", label: "GPT-5.3 Codex" },
    { value: "gpt-5.2-codex", label: "GPT-5.2 Codex" },
    { value: "gpt-5.2", label: "GPT-5.2" },
    { value: "gpt-5.1-codex-max", label: "GPT-5.1 Codex Max" },
    { value: "o3", label: "O3" },
    { value: "o4-mini", label: "O4-mini" },
  ],

  DEFAULT: "gpt-5.4",
};

/**
 * Gemini Models
 */
export const GEMINI_MODELS = {
  OPTIONS: [
    { value: "gemini-3.1-pro-preview", label: "Gemini 3.1 Pro Preview" },
    { value: "gemini-3-pro-preview", label: "Gemini 3 Pro Preview" },
    { value: "gemini-3-flash-preview", label: "Gemini 3 Flash Preview" },
    { value: "gemini-2.5-flash", label: "Gemini 2.5 Flash" },
    { value: "gemini-2.5-pro", label: "Gemini 2.5 Pro" },
    { value: "gemini-2.0-flash-lite", label: "Gemini 2.0 Flash Lite" },
    { value: "gemini-2.0-flash", label: "Gemini 2.0 Flash" },
    { value: "gemini-2.0-pro-exp", label: "Gemini 2.0 Pro Experimental" },
    {
      value: "gemini-2.0-flash-thinking-exp",
      label: "Gemini 2.0 Flash Thinking",
    },
  ],

  DEFAULT: "gemini-2.5-flash",
};
