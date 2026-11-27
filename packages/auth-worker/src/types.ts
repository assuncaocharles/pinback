/** Types shared by the worker and its browser clients (no Workers APIs here). */

/** Shape the frame client reads from #pp-data. */
export interface FrameConfig {
  allowedOrigins: string;
  allowedRepos: string[];
  apiBase: string;
  /** Whether the worker has an R2 bucket for screenshots. */
  screenshots: boolean;
}

/** Shape the callback client reads from #pp-data. */
export interface CallbackData {
  blob: string;
  returnOrigin: string;
  returnUrl: string;
}

export interface TokenSet {
  accessToken: string;
  refreshToken?: string;
  /** Epoch ms. Absent for non-expiring tokens. */
  expiresAt?: number;
  refreshExpiresAt?: number;
}
