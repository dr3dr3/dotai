# Installed-state Codex startup fixture

This is a separate credential-free acceptance gate. The trusted TypeScript
runner checks the registered source and native Codex 0.157.1 ELF pins, the
Docker engine/image, and the exact installed `roe-role-pilot-state-v1` volume.
It creates one disposable local clone volume and copies the reviewed Pilot
directory from the installed volume mounted **read-only**. It refuses a
non-empty role home before copying. The installed volume is never mounted
writable by this fixture.

The clone is sealed to the same `0711` root mode. A UID 1000 process then
starts the pinned native Codex app-server behind the generated nono profile
and sends only `initialize` and `initialized` over stdio. The container has
`--network=none`, a read-only root, no host bind, no shared HOME/workspace,
no Docker/Herdr socket, no credentials, no model call, zero capabilities,
no-new-privileges and pinned pidfd-only seccomp. The fixture verifies the
initialization response, protected/sibling read denials and clean EOF exit.
It does not create a thread or rollout. On success it proves exact container
and clone-volume removal, and confirms the installed volume still has the
expected labels. On any failure it retains the exact clone and Firstmate
reservation for reconciliation; it never forces cleanup or retries.

Plan and bundle modes are offline. `--execute` refuses without an active
Firstmate reservation. This runner is not the role launcher and does not
enable `roe-role run`. Native transcript resume, provider authentication and
inference, Herdr restore, and Claude/Pi adapter acceptance remain separate.
