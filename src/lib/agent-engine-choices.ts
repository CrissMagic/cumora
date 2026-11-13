import { RUNNABLE_ENGINES } from './engines'
import type { Computer, EngineId } from '../types'

/** Keep installed-but-blocked and missing engines discoverable, without making
 * them assignable. availableEngines remains the sole execution authority. */
export function agentEngineChoices(computer: Pick<Computer, 'availableEngines' | 'detectedEngines'>) {
  return RUNNABLE_ENGINES.map((id) => {
    const detected = computer.detectedEngines?.find((entry) => entry.id === id)
    return {
      id,
      runnable: computer.availableEngines.includes(id as EngineId),
      detected: !!detected,
      reason: detected?.blockedReason ?? null,
    }
  }).sort((a, b) => (a.runnable ? 0 : a.detected ? 1 : 2) - (b.runnable ? 0 : b.detected ? 1 : 2))
}
