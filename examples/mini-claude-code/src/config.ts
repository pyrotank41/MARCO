// mini-claude-code — user-level config at ~/.marco/config.json.

import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { homedir } from 'node:os'

export type ModelEntry = {
  id: string
  label: string
  provider: 'anthropic'
}

export type MarcoConfig = {
  selected_model: string
  available_models: ModelEntry[]
}

export const DEFAULT_MODEL_ID = 'claude-sonnet-4-6'

export const DEFAULT_AVAILABLE_MODELS: ModelEntry[] = [
  { id: 'claude-sonnet-4-6', label: 'Claude Sonnet 4.6 (default)', provider: 'anthropic' },
  { id: 'claude-opus-4-7', label: 'Claude Opus 4.7', provider: 'anthropic' },
  { id: 'claude-haiku-4-5-20251001', label: 'Claude Haiku 4.5', provider: 'anthropic' },
]

export const DEFAULT_CONFIG_PATH = join(homedir(), '.marco', 'config.json')

export function loadConfig(path: string = DEFAULT_CONFIG_PATH): MarcoConfig {
  if (!existsSync(path)) {
    const fresh: MarcoConfig = {
      selected_model: DEFAULT_MODEL_ID,
      available_models: DEFAULT_AVAILABLE_MODELS,
    }
    writeConfig(path, fresh)
    return fresh
  }
  const raw = readFileSync(path, 'utf8')
  let parsed: MarcoConfig
  try {
    parsed = JSON.parse(raw) as MarcoConfig
  } catch {
    const fresh: MarcoConfig = {
      selected_model: DEFAULT_MODEL_ID,
      available_models: DEFAULT_AVAILABLE_MODELS,
    }
    writeConfig(path, fresh)
    return fresh
  }
  const isKnown = parsed.available_models?.some((m) => m.id === parsed.selected_model)
  if (!isKnown) {
    parsed.selected_model = DEFAULT_MODEL_ID
  }
  return parsed
}

export function setSelectedModel(path: string, id: string): MarcoConfig {
  const cfg = loadConfig(path)
  const known = cfg.available_models.some((m) => m.id === id)
  if (!known) {
    throw new Error(`Model "${id}" is not in available models`)
  }
  cfg.selected_model = id
  writeConfig(path, cfg)
  return cfg
}

export function resetConfig(path: string): MarcoConfig {
  const fresh: MarcoConfig = {
    selected_model: DEFAULT_MODEL_ID,
    available_models: DEFAULT_AVAILABLE_MODELS,
  }
  writeConfig(path, fresh)
  return fresh
}

function writeConfig(path: string, cfg: MarcoConfig): void {
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, JSON.stringify(cfg, null, 2) + '\n')
}
