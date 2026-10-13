/** Call only after the server has confirmed the workspace cookie change. */
export async function refreshSelectedWorkspace(input: {
  refreshRoute: () => void;
  refreshAccount: () => Promise<void>;
}) {
  // The route is authoritative. Optional account chrome must never delay it.
  input.refreshRoute();
  try {
    await input.refreshAccount();
  } catch {
    // The selection succeeded; fresh route/account reads can recover the chrome.
  }
}
