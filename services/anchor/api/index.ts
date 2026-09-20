/**
 * The anchor as a serverless function.
 *
 * The same Express app the local server runs. What differs is only what
 * turns the payout crank: with no process left alive between requests,
 * WORKER_MODE=request makes the requests themselves do it.
 */
export { app as default } from "../src/app.js";
