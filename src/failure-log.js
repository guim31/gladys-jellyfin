// -----------------------------------------------------------------------------
// Deduplicated logging of a repeated failure.
//
// A loop that fails every 15 s (server switched off for the night, network
// down...) must not write a line per attempt: one warning at the first
// failure, the next ones in debug only, and one info line when it works again.
// -----------------------------------------------------------------------------

export class FailureLog {
  /**
   * @param {{ debug: Function, info: Function, warn: Function }} logger
   * @param {string} what - What fails, e.g. "Session refresh".
   */
  constructor(logger, what) {
    this.logger = logger;
    this.what = what;
    this.failing = false;
  }

  /**
   * Report one failed attempt.
   * @param {string} reason
   */
  fail(reason) {
    if (this.failing) {
      this.logger.debug(`${this.what} still failing: ${reason}`);
      return;
    }
    this.failing = true;
    this.logger.warn(`${this.what} failed: ${reason} (next failures in debug only)`);
  }

  /** Report a successful attempt. */
  ok() {
    if (!this.failing) {
      return;
    }
    this.failing = false;
    this.logger.info(`${this.what} works again`);
  }
}
