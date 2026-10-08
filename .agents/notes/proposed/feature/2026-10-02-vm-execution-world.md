# Agent Note: VM execution world

Status: proposed

English | [中文](2026-10-02-vm-execution-world.zh.md)

## Problem

The [sandbox seam](../../implemented/feature/2026-07-06-sandbox.md) confines subprocesses that share the host's filesystem and kernel, and the [SSH family](../../implemented/architecture/2026-09-11-posix-ssh-runtime.md) delivers a remote POSIX world — but only onto a host the deployment already owns, with a manually installed helper and digest pinning. Nothing provisions an isolated machine for a task: create, snapshot, restore, pause, dispose. Workloads where the agent should not touch any host at all — untrusted-code evaluation, throwaway demo environments, multi-tenant serving — have no path, and parity targets offer VM-backed execution for exactly these.

## Proposal

A VM world follows the replacement rule the sandbox note already states: it is **not** a `ctx.sandbox` backend. It supplies an environment-coherent provider group that replaces the Service Providers for `ctx.shell`, `ctx.fs`, `ctx.subprocess`, `ctx.terminals`, and the sandbox seam inside one live world — the group the existing note names as the only legitimate integration shape.

New family `packages/vm/`: a `vm` seam owning lifecycle vocabulary — provision a world, snapshot, restore, dispose, lease with keepalive, report status — plus one `vm-<backend>` provider per host technology and a world assembly that wires the VM's providers into a composition for a Session. The first backend is an open question between a QEMU-class microVM and OCI containers; the seam's vocabulary must not assume either. Model-visible tools are unchanged: bash, fs, and terminal tools transparently target the active world, and an agent cannot tell a VM world from a local one by tool surface.

Snapshots are the VM family's own durable state, outside the Session log; a Session references its world by a branded id and records the world's loss without inventing recovery. The filesystem seams (`ctx.browserUse`, attachments, deliverables) that live on the Host stay on the Host — a VM world replaces the execution group, not the whole application.

### Lifecycle and ownership

One world per Session is the default ownership; a shared pool of pre-warmed worlds is a later optimization behind the same seam. Lease expiry disposes the world exactly as Session disposal does, and a restore always yields a fresh world with the snapshotted filesystem and no inherited processes or network state beyond the snapshot.

## Alternatives considered

**Make the VM a `ctx.sandbox` backend.** Rejected — the split-worlds rule: bash confined in a VM while fs tools write the host is exactly the incoherence the sandbox note rules out.

**OCI containers only.** Rejected as the seam's definition: containers share the host kernel, so a seam that assumes them cannot later gain a microVM backend. Containers remain a first-backend candidate.

**Extend the SSH family with provisioning.** Rejected: SSH assumes a pre-existing host by design — deployment-owned alias, digest-pinned helper — and auto-provisioning would put a different trust model behind the same configuration surface.

**Adopt a remote-executor service API.** Rejected as the seam: those services sandbox individual commands, not an environment-coherent world that owns shell, fs, and terminal together. A compliant service could at most become a backend provider.

## Acceptance criteria

- A composition can run a Session whose bash, fs, and terminal tools all observe the VM's filesystem; host files never appear in the VM world and VM files never appear on the host.
- Disposal and lease expiry tear the world down, and the Session records the world's loss instead of retrying into it.
- Restoring a snapshot yields a fresh world with the snapshotted filesystem and no inherited processes.
- A deployment with no VM configuration is unchanged, and every existing provider remains selectable.

## Risks

Cold-start latency and per-world cost bound how aggressively Sessions can claim worlds, and snapshot storage grows without a retention policy. Network egress control inside the VM is a promise the seam must not overclaim — the sandbox note's file-effects-only honesty applies to whole worlds. The Windows host as the machine running VMs is an unsolved backend question, and there is no automatic reconnect or replay, aligning with SSH semantics.
