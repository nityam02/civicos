import type { AgentManifest, Capability, Syscall, SyscallKind } from '../types.js';
import { globMatch, globSpecificity } from '../util/glob.js';

export interface CapabilityCheck {
  granted: boolean;
  capability?: Capability;
  reason: string;
}

/**
 * Capability check. This runs *before* policy and cannot be widened by it.
 *
 * Policy is the negotiable layer - it changes with context, jurisdiction and
 * the day's risk appetite. Capabilities are the non-negotiable one: an agent
 * whose manifest never mentions `publish` cannot publish, however a policy file
 * is edited. Two independent gates means a mistake in either one is not enough
 * on its own to cause harm.
 */
export function checkCapability(manifest: AgentManifest, syscall: Syscall): CapabilityCheck {
  const candidates = manifest.capabilities
    .filter((c) => c.actions.includes(syscall.kind))
    .filter((c) => globMatch(c.resource, syscall.resource))
    .sort((a, b) => globSpecificity(b.resource) - globSpecificity(a.resource));

  const capability = candidates[0];
  if (!capability) {
    const kinds = [...new Set(manifest.capabilities.flatMap((c) => c.actions))];
    return {
      granted: false,
      reason: kinds.includes(syscall.kind)
        ? `agent "${manifest.id}" may perform ${syscall.kind} but not on resource "${syscall.resource}"`
        : `agent "${manifest.id}" holds no capability for ${syscall.kind}`,
    };
  }
  return { granted: true, capability, reason: `granted by capability ${capability.resource}` };
}

export interface ManifestIssue {
  level: 'error' | 'warning';
  message: string;
}

export function validateManifest(manifest: AgentManifest): ManifestIssue[] {
  const issues: ManifestIssue[] = [];
  const error = (message: string) => issues.push({ level: 'error', message });
  const warn = (message: string) => issues.push({ level: 'warning', message });

  if (!/^[a-z0-9][a-z0-9-]*$/.test(manifest.id)) error(`agent id "${manifest.id}" must be kebab-case`);
  if (!manifest.purpose || manifest.purpose.length < 20) {
    error('manifest.purpose must be a plain-language sentence of at least 20 characters');
  }
  if (!manifest.owner || !manifest.contact) error('manifest must name an owner and a contact');
  if (manifest.capabilities.length === 0) warn('agent declares no capabilities and can do nothing');
  if (manifest.policies.length === 0) error('agent declares no policy packs');
  if (manifest.riskTier === 'high' && !manifest.humanOversight.required) {
    error('a high-risk agent must declare humanOversight.required: true');
  }
  if (manifest.humanOversight.required && manifest.humanOversight.roles.length === 0) {
    error('humanOversight.required is true but no approving roles are named');
  }
  for (const capability of manifest.capabilities) {
    if (capability.resource === '**' || capability.resource === '*') {
      warn(`capability grants the whole resource namespace ("${capability.resource}"); narrow it`);
    }
    for (const action of capability.actions) {
      if (!isSyscallKind(action)) error(`capability declares unknown action "${action}"`);
    }
  }
  if (manifest.dataCategories.includes('personal_data') && manifest.riskTier === 'minimal') {
    warn('agent handles personal data but declares the minimal risk tier');
  }
  return issues;
}

function isSyscallKind(value: string): value is SyscallKind {
  return [
    'model.complete', 'data.read', 'data.write', 'net.fetch',
    'agent.spawn', 'message.send', 'tool.invoke', 'publish',
  ].includes(value);
}

export function assertManifestValid(manifest: AgentManifest): void {
  const errors = validateManifest(manifest).filter((i) => i.level === 'error');
  if (errors.length > 0) {
    throw new Error(
      `agent manifest "${manifest.id}" is invalid:\n${errors.map((e) => `  - ${e.message}`).join('\n')}`,
    );
  }
}
