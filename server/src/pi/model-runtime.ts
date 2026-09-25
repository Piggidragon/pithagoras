/**
 * Keeping a pi ModelRuntime in step with what Settings changes.
 *
 * pi builds its runtime once and does not look again on its own: a key added
 * to auth.json since, or a provider an installed package brings, is not in it.
 */

/**
 * Read models.json and auth.json again. pi's refresh() reads only models.json:
 * the keys are read once, when the runtime is made, into a store pi keeps to
 * itself and does not export — so it is reached through, and a key saved in
 * Settings reaches an open chat's model menu.
 */
export async function rereadConfig(runtime: any): Promise<void> {
  runtime?.credentials?.store?.reload?.();
  await runtime?.refresh?.({ allowNetwork: false });
}

/**
 * The providers installed packages bring, registered on a runtime made
 * outside any conversation — as a session does when it binds its extensions.
 * Without them a provider from a package was in every chat's model menu but
 * not in Settings, nor in the setup assistant waiting for a first model.
 *
 * Only the extensions are loaded, not skills or prompts, and none of them is
 * started: registering a provider is all they do when loaded.
 */
export async function addExtensionProviders(pi: any, runtime: any, cwd: string): Promise<void> {
  const loader = new pi.DefaultResourceLoader({
    cwd, agentDir: pi.getAgentDir(),
    noSkills: true, noPromptTemplates: true, noThemes: true, noContextFiles: true,
  });
  await loader.reload();
  const loaded = loader.getExtensions()?.runtime;
  // One package that fails to register is left out; the rest still are.
  for (const { name, config } of loaded?.pendingProviderRegistrations ?? []) {
    try { runtime.registerProvider(name, config); } catch { /* left out */ }
  }
  for (const { provider } of loaded?.pendingNativeProviderRegistrations ?? []) {
    try { runtime.registerNativeProvider(provider); } catch { /* left out */ }
  }
  await runtime.refresh({ allowNetwork: false });
}
