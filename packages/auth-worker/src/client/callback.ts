import type { CallbackData } from '../types.js';

/**
 * OAuth callback page. Hands the sealed blob back to the preview:
 * 1. via window.opener (the popup flow), targeted at the preview's origin only;
 * 2. otherwise by redirecting to the preview with #pp_auth=<blob>.
 * The blob is useless without the frame's secret, so either path is safe
 * even if the host page is compromised. See ADR 7.
 */
const data = JSON.parse(document.getElementById('pp-data')?.textContent ?? 'null') as CallbackData | null;

if (data) {
  const opener = window.opener as Window | null;
  if (opener && !opener.closed) {
    opener.postMessage({ pp: 1, event: 'sealed', blob: data.blob }, data.returnOrigin);
    window.close();
    // Some browsers refuse window.close(); fall through to a visible message.
    document.body.textContent = 'Signed in. You can close this window.';
  } else {
    window.location.replace(`${data.returnUrl}#pp_auth=${data.blob}`);
  }
}
