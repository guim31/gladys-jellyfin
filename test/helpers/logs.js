// -----------------------------------------------------------------------------
// Capture the lines written by the SDK logger (console.log for debug/info,
// console.error for warn/error), every level included, for the duration of a
// test.
// -----------------------------------------------------------------------------

/**
 * @param {import('node:test').TestContext} t
 * @returns {{ lines: string[], at: (level: string) => string[], loud: () => string[], clear: () => void }}
 */
export function captureLogs(t) {
  const previousLevel = process.env.LOG_LEVEL;
  process.env.LOG_LEVEL = 'debug';
  t.after(() => {
    if (previousLevel === undefined) {
      delete process.env.LOG_LEVEL;
    } else {
      process.env.LOG_LEVEL = previousLevel;
    }
  });
  const lines = [];
  const grab = (...args) => lines.push(args.map(String).join(' '));
  t.mock.method(console, 'log', grab);
  t.mock.method(console, 'error', grab);
  return {
    lines,
    /** Lines of one level: 'DEBUG', 'INFO', 'WARN' or 'ERROR'. */
    at: (level) => lines.filter((line) => line.includes(`[${level}]`)),
    /** Lines above debug. */
    loud: () => lines.filter((line) => !line.includes('[DEBUG]')),
    clear: () => {
      lines.length = 0;
    },
  };
}
