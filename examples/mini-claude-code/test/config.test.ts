import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, rmSync, existsSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import {
  loadConfig, setSelectedModel, resetConfig,
  DEFAULT_MODEL_ID, DEFAULT_AVAILABLE_MODELS,
} from '../src/config.js'

let dir: string
let configPath: string

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'marco-cfg-'))
  configPath = join(dir, 'config.json')
})
afterEach(() => {
  rmSync(dir, { recursive: true, force: true })
})

describe('config', () => {
  it('creates config with defaults when missing', () => {
    const cfg = loadConfig(configPath)
    expect(cfg.selected_model).toBe(DEFAULT_MODEL_ID)
    expect(cfg.available_models).toEqual(DEFAULT_AVAILABLE_MODELS)
    expect(existsSync(configPath)).toBe(true)
  })

  it('reads existing config', () => {
    writeFileSync(configPath, JSON.stringify({
      selected_model: 'claude-opus-4-7',
      available_models: DEFAULT_AVAILABLE_MODELS,
    }))
    const cfg = loadConfig(configPath)
    expect(cfg.selected_model).toBe('claude-opus-4-7')
  })

  it('falls back to default when selected_model is not in available_models', () => {
    writeFileSync(configPath, JSON.stringify({
      selected_model: 'nonexistent-model',
      available_models: DEFAULT_AVAILABLE_MODELS,
    }))
    const cfg = loadConfig(configPath)
    expect(cfg.selected_model).toBe(DEFAULT_MODEL_ID)
  })

  it('setSelectedModel persists and returns new config', () => {
    loadConfig(configPath)
    const updated = setSelectedModel(configPath, 'claude-opus-4-7')
    expect(updated.selected_model).toBe('claude-opus-4-7')
    const reloaded = loadConfig(configPath)
    expect(reloaded.selected_model).toBe('claude-opus-4-7')
  })

  it('setSelectedModel throws for unknown id', () => {
    loadConfig(configPath)
    expect(() => setSelectedModel(configPath, 'bogus')).toThrow(/not in available models/)
  })

  it('resetConfig reverts to default', () => {
    loadConfig(configPath)
    setSelectedModel(configPath, 'claude-opus-4-7')
    const reset = resetConfig(configPath)
    expect(reset.selected_model).toBe(DEFAULT_MODEL_ID)
  })
})
