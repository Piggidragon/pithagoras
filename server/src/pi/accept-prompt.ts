/**
 * Resolve at SDK acceptance while retaining a handler for failures during the run.
 * `over`, when given, is called once the run is finished with — after
 * `failedAfterAcceptance` when it failed.
 */
export function acceptPrompt(
  run: (preflight: (success: boolean) => void) => Promise<void>,
  failedAfterAcceptance: (error: unknown) => void,
  over?: () => void,
): Promise<void> {
  return new Promise((resolve, reject) => {
    let accepted = false;
    try {
      void run(success => { if (success) { accepted = true; resolve(); } }).then(
        () => {
          resolve();
          over?.();
        },
        error => {
          if (accepted) failedAfterAcceptance(error);
          else reject(error);
          over?.();
        },
      );
    } catch (error) {
      reject(error);
      over?.();
    }
  });
}
