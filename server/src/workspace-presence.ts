import { redis } from './redis.js'

const LEASE_MS = 75_000
const key = (userId: string, companyId: string) => `cumora:workspace-view:${encodeURIComponent(userId)}:${encodeURIComponent(companyId)}`

/** Socket-specific leases work across replicas and multiple tabs/devices.
 * They do not change the user's global roster presence. */
export async function recordWorkspaceView(userId: string, companyId: string, connectionId: string, now = Date.now()): Promise<void> {
  const k = key(userId, companyId)
  const results = await redis.multi().zremrangebyscore(k, '-inf', now)
    .zadd(k, now + LEASE_MS, connectionId).pexpire(k, LEASE_MS).exec()
  if (!results || results.some(([error]) => error)) throw new Error('workspace presence write failed')
}

export async function removeWorkspaceView(userId: string, companyId: string, connectionId: string): Promise<void> {
  await redis.zrem(key(userId, companyId), connectionId)
}

/** Redis failure allows notifications through; a stale global online marker
 * must never silence a message in a different workspace. */
export async function usersNotViewingWorkspace(userIds: string[], companyId: string, now = Date.now()): Promise<string[]> {
  if (!userIds.length) return []
  try {
    const batch = redis.pipeline()
    for (const userId of userIds) batch.zcount(key(userId, companyId), `(${now}`, '+inf')
    const result = await batch.exec()
    if (!result) return userIds
    return userIds.filter((_, i) => !result[i] || result[i][0] || Number(result[i][1]) === 0)
  } catch { return userIds }
}
